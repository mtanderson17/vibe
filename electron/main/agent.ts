import type { WebContents } from 'electron'
import type { AgentEvent, AgentState, Message } from './types'
import { chatCompletion, shortCompletion, formatProviderError } from './providers'
import { executeTool, killAgentProcesses, allToolSchemas } from './tools'
import { executeToolCalls, accumulateUsage, pinnedModelFor } from './tool-loop'
import { createWorktree, commitAll } from './git'
import { readContext, readAgentsGuide, readSummary } from './context'
import { getConfig } from './config'
import { saveAgent, loadAgents } from './persistence'
import { siblingsSummary, buildSystemPrompt } from './agent-prompt'
import { appendLedgerEntry, estimateCost } from './ledger'
import { getPricing } from './pricing'
import { condenseIfNeeded } from './condenser'

const agents = new Map<string, AgentState>()
const agentAborts = new Map<string, AbortController>()
// Ids currently being torn down (git worktree remove / branch delete in progress).
// Reserved from spawn so we don't hand the same id to a new agent while the
// old agent's cleanup is still running against its worktree directory.
const closingIds = new Set<string>()
let sender: WebContents | null = null

export function bindSender(webContents: WebContents): void {
  sender = webContents
}

export function emit(event: AgentEvent): void {
  sender?.send('agent:event', event)
}

export function getAgent(id: string): AgentState | undefined {
  return agents.get(id)
}

export function listAgents(): AgentState[] {
  return Array.from(agents.values())
}

export function ensureAgent(id: string): AgentState {
  let a = agents.get(id)
  if (!a) {
    a = { id, status: 'idle', task: null, branch: null, worktreePath: null, messages: [] }
    agents.set(id, a)
  }
  return a
}

// Best-effort persistence — errors are logged, not thrown, so persistence
// never blocks the agent loop.
function persist(agent: AgentState): void {
  const cfg = getConfig()
  if (!cfg.workspacePath) return
  saveAgent(cfg.workspacePath, agent).catch(err => console.error('[vibe] persist failed', err))
}

export async function hydrateAgentsFromWorkspace(workspacePath: string): Promise<AgentState[]> {
  agents.clear()
  const loaded = await loadAgents(workspacePath)
  for (const a of loaded) agents.set(a.id, a)
  return Array.from(agents.values())
}

export function spawnAgent(): AgentState {
  // Find the next available agent-N id, skipping any ids that are still tearing down.
  const existing = new Set([...agents.keys(), ...closingIds])
  let n = 1
  while (existing.has(`agent-${n}`)) n++
  const id = `agent-${n}`
  const a: AgentState = { id, status: 'idle', task: null, branch: null, worktreePath: null, messages: [] }
  agents.set(id, a)
  persist(a)
  return a
}

export function markClosing(id: string): void { closingIds.add(id) }
export function markClosed(id: string): void { closingIds.delete(id) }

// Ensure the agent exists in memory even if the user has never started it —
// otherwise renames from the tab/tile silently do nothing when Vibe first opens.
function ensureAgentForSideChannel(id: string): AgentState {
  return ensureAgent(id)
}

export function setAgentName(id: string, displayName: string | null): void {
  const agent = ensureAgentForSideChannel(id)
  agent.displayName = displayName?.trim() || undefined
  persist(agent)
  emit({ agentId: id, type: 'sync', data: agent })
}

export function setAgentModel(id: string, modelOverride: string | null): void {
  const agent = ensureAgentForSideChannel(id)
  agent.modelOverride = modelOverride ?? undefined
  // Reset pin so the next turn uses the new model. Otherwise the previous
  // pinned slug (which may not match the new provider) would keep being used.
  agent.pinnedModel = undefined
  persist(agent)
  emit({ agentId: id, type: 'sync', data: agent })
}

export function closeAgent(id: string): void {
  const a = agents.get(id)
  if (!a) return
  agents.delete(id)
  // Kill any active loop first
  const abort = agentAborts.get(id)
  if (abort) abort.abort()
  killAgentProcesses(id)
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'task'
}

// Reject slugs that clearly echo the instruction or are too long/verbose to
// be a real slug (weak models sometimes reply "the slug is: ..." or paraphrase
// the prompt itself). A real slug is 2-5 hyphenated tokens.
function looksLikeValidSlug(s: string): boolean {
  if (!/^[a-z0-9-]+$/.test(s)) return false
  const tokens = s.split('-').filter(Boolean)
  if (tokens.length < 1 || tokens.length > 6) return false
  // Reject if it contains obvious instruction-echo tokens
  const bad = /\b(slug|lowercase|hyphen|word|output|format|example|task-description)\b/
  if (bad.test(s)) return false
  return true
}

function hasAnyProviderKey(cfg: ReturnType<typeof getConfig>): boolean {
  return !!(cfg.openrouterApiKey || cfg.anthropicApiKey || cfg.openaiApiKey || cfg.geminiApiKey || cfg.groqApiKey || cfg.xaiApiKey)
}

async function generateSlug(cfg: ReturnType<typeof getConfig>, task: string): Promise<string> {
  try {
    const raw = await shortCompletion(
      {
        openrouter: cfg.openrouterApiKey,
        anthropic: cfg.anthropicApiKey,
        openai: cfg.openaiApiKey,
        gemini: cfg.geminiApiKey,
        groq: cfg.groqApiKey,
        xai: cfg.xaiApiKey
      },
      cfg.model,
      'Emit a short git branch slug for the task. Slug format: 2-5 lowercase words joined by hyphens, no punctuation, no quotes. Reply with ONLY the slug on a single line — no preamble, no explanation. Example replies: add-pause | fix-clear-lines-bug | scaffold-api',
      task
    )
    // Weak/free-tier models sometimes reply with "Sure! Here's the slug: ..."
    // or echo the prompt. Take only the first line and strip common preambles.
    const firstLine = raw.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? ''
    const stripped = firstLine.replace(/^["'`]|["'`]$/g, '').replace(/^slug[:\s-]*/i, '')
    const cleaned = slugify(stripped)
    if (looksLikeValidSlug(cleaned)) return cleaned
  } catch { /* fall through to naive slug */ }
  return slugify(task)
}

// siblingsSummary + buildSystemPrompt are now in ./agent-prompt for testability.

async function runLoop(agent: AgentState): Promise<void> {
  const cfg = getConfig()
  if (!agent.worktreePath) throw new Error('Agent has no worktree')

  const abort = new AbortController()
  agentAborts.set(agent.id, abort)

  agent.status = 'running'
  agent.maxSteps = cfg.maxSteps
  // Each runLoop invocation gets a fresh step budget. Otherwise hitting the
  // limit would freeze the agent — subsequent continues would start at maxSteps.
  agent.step = 0
  emit({ agentId: agent.id, type: 'status', data: agent.status })

  let steps = 0
  let calledFinish = false
  let stoppedForInput = false
  let killed = false
  let hitLimit = false

  try {
    while (steps < cfg.maxSteps && !calledFinish && !stoppedForInput) {
      if (abort.signal.aborted) { killed = true; break }
      steps++
      agent.step = steps
      emit({ agentId: agent.id, type: 'step', data: { step: steps, max: cfg.maxSteps } })

      // Priority: pinnedModel (from first served response) > per-agent override > global config
      const modelForCall = agent.pinnedModel ?? agent.modelOverride ?? cfg.model

      // Condense (compact) long transcripts before sending. Preserves the
      // cache-stable prefix (system + first user) so Anthropic prompt caching
      // keeps working after compaction.
      const condensed = await condenseIfNeeded(agent.messages, {
        keys: {
          openrouter: cfg.openrouterApiKey,
          anthropic: cfg.anthropicApiKey,
          openai: cfg.openaiApiKey,
          gemini: cfg.geminiApiKey,
          groq: cfg.groqApiKey,
          xai: cfg.xaiApiKey
        },
        model: modelForCall
      })
      if (condensed.compacted) {
        agent.messages = condensed.messages
        emit({ agentId: agent.id, type: 'sync', data: agent })
      }

      emit({ agentId: agent.id, type: 'stream_start', data: null })
      const { message, usage } = await chatCompletion({
        keys: {
        openrouter: cfg.openrouterApiKey,
        anthropic: cfg.anthropicApiKey,
        openai: cfg.openaiApiKey,
        gemini: cfg.geminiApiKey,
        groq: cfg.groqApiKey,
        xai: cfg.xaiApiKey
      },
        model: modelForCall,
        messages: agent.messages,
        tools: allToolSchemas(),
        signal: abort.signal,
        onDelta: (delta) => emit({ agentId: agent.id, type: 'stream_delta', data: delta })
      })
      emit({ agentId: agent.id, type: 'stream_end', data: message })

      agent.messages.push(message)

      agent.pinnedModel = pinnedModelFor(agent.pinnedModel, agent.modelOverride ?? cfg.model, message.servedBy)

      const nextUsage = accumulateUsage(agent.usage, usage)
      if (nextUsage !== agent.usage) {
        agent.usage = nextUsage
        emit({ agentId: agent.id, type: 'usage', data: agent.usage })
      }

      // Log this turn to the persistent cost ledger (fire-and-forget)
      if (usage && cfg.workspacePath) {
        const modelForLedger = agent.pinnedModel ?? modelForCall.split(',')[0].trim()
        getPricing().then(pricing => {
          const cost = estimateCost(modelForLedger, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, pricing)
          return appendLedgerEntry(cfg.workspacePath!, {
            timestamp: new Date().toISOString(),
            source: agent.id,
            model: modelForLedger,
            branch: agent.branch,
            task: agent.task,
            prompt_tokens: usage.prompt_tokens ?? 0,
            completion_tokens: usage.completion_tokens ?? 0,
            total_tokens: usage.total_tokens ?? 0,
            cost_usd: cost
          })
        }).catch(err => console.error('[vibe] ledger write failed', err))
      }

      if (!message.toolCalls || message.toolCalls.length === 0) {
        // Model returned no tool calls. If it also returned no content, that's a
        // model failure (common with weak free-tier models mid-turn). Surface it.
        if (!message.content || !message.content.trim()) {
          agent.messages.push({
            role: 'system',
            content: '[Model returned empty response — click Continue to retry, or send guidance to redirect.]'
          })
        }
        stoppedForInput = true
        break
      }

      const result = await executeToolCalls({
        toolCalls: message.toolCalls,
        execute: (name, args) => executeTool(agent.worktreePath!, name, args, agent.id),
        onToolCall: (call) => emit({ agentId: agent.id, type: 'tool_call', data: call }),
        onToolResult: (call, res) => emit({ agentId: agent.id, type: 'tool_result', data: { call, result: res } }),
        abortSignal: abort.signal
      })
      agent.messages.push(...result.messages)
      if (result.calledFinish) calledFinish = true
      if (result.stoppedForInput) stoppedForInput = true
      if (result.aborted) { killed = true; break }
    }
    if (steps >= cfg.maxSteps && !calledFinish && !stoppedForInput && !killed) {
      hitLimit = true
    }
  } catch (e) {
    if (abort.signal.aborted) {
      killed = true
    } else {
      throw e
    }
  } finally {
    agentAborts.delete(agent.id)
  }

  if (killed) {
    // killAgent already set status + pushed the interrupted marker synchronously.
    // Don't duplicate. Just make sure status is settled.
    agent.status = 'awaiting_input'
  } else if (calledFinish) {
    await commitAll(agent.worktreePath, `vibe: agent ${agent.id} — ${(agent.task ?? '').slice(0, 60)}`)
    agent.status = 'awaiting_merge'
  } else {
    agent.status = 'awaiting_input'
    if (hitLimit) {
      agent.messages.push({
        role: 'system',
        content: `[Reached step limit (${cfg.maxSteps}). Click Continue to add another ${cfg.maxSteps} steps, or send a new instruction to redirect.]`
      })
    }
  }

  emit({ agentId: agent.id, type: 'status', data: agent.status })
  emit({ agentId: agent.id, type: 'done', data: { steps, killed, hitLimit } })
  persist(agent)
}

export function killAgent(id: string): void {
  console.log(`[vibe] killAgent(${id})`)
  const agent = agents.get(id)
  const abort = agentAborts.get(id)
  if (abort) abort.abort()
  agentAborts.delete(id)  // free the map slot even if runLoop hasn't unwound yet
  killAgentProcesses(id)

  if (!agent) return

  // Trim a stale empty streaming placeholder that will never receive its stream_end.
  const last = agent.messages[agent.messages.length - 1]
  if (last && last.role === 'assistant' && !last.content && !last.toolCalls?.length) {
    agent.messages.pop()
  }

  // Push the interrupted marker synchronously so the UI has final state instantly,
  // regardless of when the runLoop's own post-code finishes unwinding.
  const alreadyMarked = agent.messages[agent.messages.length - 1]
  if (!(alreadyMarked && alreadyMarked.role === 'system' && (alreadyMarked.content ?? '').includes('interrupted'))) {
    agent.messages.push({ role: 'system', content: '[Agent was interrupted by user]' })
  }

  agent.status = 'awaiting_input'
  agent.step = undefined
  persist(agent)
  // Full sync so renderer replaces state — avoids any lingering 'running' / placeholder in the UI.
  emit({ agentId: id, type: 'sync', data: agent })
}

export async function startAgent(id: string, task: string): Promise<void> {
  const cfg = getConfig()
  if (!cfg.workspacePath) throw new Error('Workspace not set')
  if (!hasAnyProviderKey(cfg) && !cfg.model.startsWith('ollama/')) {
    throw new Error('No API key configured (need OpenRouter, Anthropic, OpenAI, Gemini, Groq, xAI, or Ollama model)')
  }

  const agent = ensureAgent(id)
  if (agent.status === 'running') throw new Error(`Agent ${id} already running`)

  agent.task = task
  agent.messages = []
  agent.error = undefined
  agent.pinnedModel = undefined
  agent.usage = undefined
  agent.status = 'running'
  emit({ agentId: id, type: 'status', data: agent.status })

  try {
    const slug = await generateSlug(cfg, task)
    const { worktreePath, branch } = await createWorktree(cfg.workspacePath, id, slug)
    agent.worktreePath = worktreePath
    agent.branch = branch
    emit({ agentId: id, type: 'status', data: { status: agent.status, branch, worktreePath } })

    const [sharedContext, agentsGuide, summary] = await Promise.all([
      readContext(cfg.workspacePath),
      readAgentsGuide(cfg.workspacePath),
      readSummary(cfg.workspacePath)
    ])
    const systemMsg: Message = {
      role: 'system',
      content: buildSystemPrompt({
        agentsGuide,
        sharedContext,
        summary,
        agentId: id,
        worktreePath,
        siblings: siblingsSummary(id, agents.values())
      })
    }
    const userMsg: Message = { role: 'user', content: task }
    agent.messages.push(systemMsg, userMsg)
    emit({ agentId: id, type: 'message', data: userMsg })

    await runLoop(agent)
  } catch (e) {
    agent.status = 'error'
    agent.error = formatProviderError(e)
    emit({ agentId: id, type: 'error', data: agent.error })
    emit({ agentId: id, type: 'status', data: agent.status })
  }
}

export async function continueAgent(id: string, userInput: string): Promise<void> {
  const agent = ensureAgent(id)
  if (agent.status !== 'awaiting_input' && agent.status !== 'awaiting_merge') {
    throw new Error(`Agent ${id} cannot accept follow-up (status: ${agent.status})`)
  }
  const cfg = getConfig()

  // Refresh the system message with current sibling/context/summary state.
  // Only done here (on human re-engagement), not on every internal loop turn,
  // to keep token cost bounded while still avoiding hours-stale prompts.
  if (cfg.workspacePath && agent.worktreePath) {
    try {
      const [sharedContext, agentsGuide, summary] = await Promise.all([
        readContext(cfg.workspacePath),
        readAgentsGuide(cfg.workspacePath),
        readSummary(cfg.workspacePath)
      ])
      const freshSystem: Message = {
        role: 'system',
        content: buildSystemPrompt({
          agentsGuide,
          sharedContext,
          summary,
          agentId: id,
          worktreePath: agent.worktreePath,
          siblings: siblingsSummary(id, agents.values())
        })
      }
      // Replace the initial system message in place (must be at index 0).
      if (agent.messages[0]?.role === 'system') {
        agent.messages[0] = freshSystem
      } else {
        agent.messages.unshift(freshSystem)
      }
    } catch (e) {
      console.warn('[vibe] failed to refresh system prompt on continue', e)
    }
  }

  const userMsg: Message = { role: 'user', content: userInput }
  agent.messages.push(userMsg)
  emit({ agentId: id, type: 'message', data: userMsg })

  try {
    await runLoop(agent)
  } catch (e) {
    agent.status = 'error'
    agent.error = formatProviderError(e)
    emit({ agentId: id, type: 'error', data: agent.error })
    emit({ agentId: id, type: 'status', data: agent.status })
  }
}
