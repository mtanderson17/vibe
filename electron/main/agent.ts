import type { WebContents } from 'electron'
import type { AgentEvent, AgentState, Message } from './types'
import { chatCompletion, shortCompletion } from './providers'
import { executeTool, killAgentProcesses, TOOL_SCHEMAS } from './tools'
import { executeToolCalls, accumulateUsage, pinnedModelFor } from './tool-loop'
import { createWorktree, commitAll } from './git'
import { readContext, readAgentsGuide, readSummary } from './context'
import { getConfig } from './config'
import { saveAgent, loadAgents } from './persistence'
import { siblingsSummary, buildSystemPrompt } from './agent-prompt'
import { appendLedgerEntry, estimateCost } from './ledger'
import { getPricing } from './pricing'

const agents = new Map<string, AgentState>()
const agentAborts = new Map<string, AbortController>()
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
  // Find the next available agent-N id
  const existing = Array.from(agents.keys())
  let n = 1
  while (existing.includes(`agent-${n}`)) n++
  const id = `agent-${n}`
  const a: AgentState = { id, status: 'idle', task: null, branch: null, worktreePath: null, messages: [] }
  agents.set(id, a)
  persist(a)
  return a
}

export function setAgentModel(id: string, modelOverride: string | null): void {
  const agent = agents.get(id)
  if (!agent) return
  agent.modelOverride = modelOverride ?? undefined
  // Reset pin so the next turn uses the new model. Otherwise the previous
  // pinned slug (which may not match the new provider) would keep being used.
  agent.pinnedModel = undefined
  persist(agent)
  emit({ agentId: id, type: 'status', data: agent.status })
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
      'You turn task descriptions into concise git branch slugs. Output ONLY the slug, no explanation. Format: 2-5 lowercase words joined by hyphens. Examples: "add-pause", "fix-clear-lines-bug", "scaffold-api", "write-tests".',
      task
    )
    const cleaned = slugify(raw.trim())
    if (cleaned.length >= 2 && cleaned.length <= 40) return cleaned
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
  emit({ agentId: agent.id, type: 'status', data: agent.status })

  let steps = agent.step ?? 0
  let calledFinish = false
  let stoppedForInput = false
  let killed = false

  try {
    while (steps < cfg.maxSteps && !calledFinish && !stoppedForInput) {
      if (abort.signal.aborted) { killed = true; break }
      steps++
      agent.step = steps
      emit({ agentId: agent.id, type: 'step', data: { step: steps, max: cfg.maxSteps } })

      // Priority: pinnedModel (from first served response) > per-agent override > global config
      const modelForCall = agent.pinnedModel ?? agent.modelOverride ?? cfg.model

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
        tools: TOOL_SCHEMAS as unknown as Array<Record<string, unknown>>,
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
    agent.status = 'awaiting_input'
    agent.messages.push({ role: 'system', content: '[Agent was interrupted by user]' })
  } else if (calledFinish) {
    await commitAll(agent.worktreePath, `vibe: agent ${agent.id} — ${(agent.task ?? '').slice(0, 60)}`)
    agent.status = 'awaiting_merge'
  } else {
    agent.status = 'awaiting_input'
  }

  emit({ agentId: agent.id, type: 'status', data: agent.status })
  emit({ agentId: agent.id, type: 'done', data: { steps, killed } })
  persist(agent)
}

export function killAgent(id: string): void {
  const agent = agents.get(id)
  const abort = agentAborts.get(id)
  if (abort) abort.abort()
  killAgentProcesses(id)
  // Immediately reflect the killed state so the UI feels instant, instead of
  // waiting for the runLoop's current fetch to detect the abort (can be 1-3s).
  if (agent && agent.status === 'running') {
    agent.status = 'awaiting_input'
    emit({ agentId: id, type: 'status', data: 'awaiting_input' })
  }
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
    agent.error = (e as Error).message
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
    agent.error = (e as Error).message
    emit({ agentId: id, type: 'error', data: agent.error })
    emit({ agentId: id, type: 'status', data: agent.status })
  }
}
