import type { WebContents } from 'electron'
import type { AgentEvent, AgentState, Message } from './types'
import { chatCompletion, shortCompletion } from './openrouter'
import { executeTool, killAgentProcesses } from './tools'
import { createWorktree, commitAll } from './git'
import { readContext, readAgentsGuide, readSummary } from './context'
import { getConfig } from './config'
import { saveAgent, loadAgents } from './persistence'

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

async function generateSlug(apiKey: string, model: string, task: string): Promise<string> {
  try {
    const raw = await shortCompletion(
      apiKey,
      model,
      'You turn task descriptions into concise git branch slugs. Output ONLY the slug, no explanation. Format: 2-5 lowercase words joined by hyphens. Examples: "add-pause", "fix-clear-lines-bug", "scaffold-api", "write-tests".',
      task
    )
    const cleaned = slugify(raw.trim())
    if (cleaned.length >= 2 && cleaned.length <= 40) return cleaned
  } catch { /* fall through to naive slug */ }
  return slugify(task)
}

function siblingsSummary(currentId: string): string {
  const others = Array.from(agents.values()).filter(a =>
    a.id !== currentId &&
    (a.status === 'running' || a.status === 'awaiting_input' || a.status === 'awaiting_merge')
  )
  if (others.length === 0) return '(no other agents active)'
  return others.map(a => `- ${a.id} [${a.status}] on branch \`${a.branch ?? '?'}\`: ${a.task ?? '(no task)'}`).join('\n')
}

function buildSystemPrompt(
  agentsGuide: string,
  sharedContext: string,
  summary: string,
  agentId: string,
  worktreePath: string
): string {
  return `${agentsGuide}

---

# Project Context
${sharedContext}

---

# Recent Project State (maintained by PM agent)
${summary}

---

# Concurrent Agents
Other agents may be working on this same codebase in parallel branches. Be mindful
if your changes might overlap with theirs — you'll get merge conflicts otherwise.
${siblingsSummary(agentId)}

---

# Your Session
- You are agent: ${agentId}
- Your worktree root: ${worktreePath}`
}

async function runLoop(agent: AgentState): Promise<void> {
  const cfg = getConfig()
  if (!cfg.openrouterApiKey) throw new Error('OpenRouter API key not set')
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

      // Use pinned model if set (from first successful response), else the configured chain
      const modelForCall = agent.pinnedModel ?? cfg.model

      emit({ agentId: agent.id, type: 'stream_start', data: null })
      const { message, usage } = await chatCompletion(
        cfg.openrouterApiKey,
        modelForCall,
        agent.messages,
        abort.signal,
        (delta) => emit({ agentId: agent.id, type: 'stream_delta', data: delta })
      )
      emit({ agentId: agent.id, type: 'stream_end', data: message })

      agent.messages.push(message)

      // Pin the model to whichever one actually served the first turn.
      // Only pin for multi-slug (fallback chain) configs — single-slug configs are
      // already unambiguous and pinning would strip provider prefixes (e.g. "ollama/").
      const slugs = cfg.model.split(',').map(s => s.trim()).filter(Boolean)
      if (!agent.pinnedModel && message.servedBy && slugs.length > 1) {
        // Prefer the matching configured slug (preserves ollama/ prefix, :free suffix, etc.)
        const match = slugs.find(s => s === message.servedBy || s.endsWith('/' + message.servedBy))
        agent.pinnedModel = match ?? message.servedBy
      }

      // Accumulate token usage for the current task
      if (usage) {
        const prev = agent.usage ?? { prompt: 0, completion: 0, total: 0 }
        agent.usage = {
          prompt: prev.prompt + (usage.prompt_tokens ?? 0),
          completion: prev.completion + (usage.completion_tokens ?? 0),
          total: prev.total + (usage.total_tokens ?? 0)
        }
        emit({ agentId: agent.id, type: 'usage', data: agent.usage })
      }

      if (!message.toolCalls || message.toolCalls.length === 0) {
        stoppedForInput = true
        break
      }

      for (const call of message.toolCalls) {
        if (abort.signal.aborted) { killed = true; break }
        emit({ agentId: agent.id, type: 'tool_call', data: call })
        let result: string
        try {
          result = await executeTool(agent.worktreePath, call.name, call.arguments, agent.id)
        } catch (e) {
          result = `[error] ${(e as Error).message}`
        }
        const toolMsg: Message = {
          role: 'tool',
          content: result,
          toolCallId: call.id,
          name: call.name
        }
        agent.messages.push(toolMsg)
        emit({ agentId: agent.id, type: 'tool_result', data: { call, result } })

        if (call.name === 'finish') calledFinish = true
        if (call.name === 'ask_human') { stoppedForInput = true; break }
      }
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
  const abort = agentAborts.get(id)
  if (abort) abort.abort()
  killAgentProcesses(id)
}

export async function startAgent(id: string, task: string): Promise<void> {
  const cfg = getConfig()
  if (!cfg.workspacePath) throw new Error('Workspace not set')
  if (!cfg.openrouterApiKey) throw new Error('OpenRouter API key not set')

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
    const slug = await generateSlug(cfg.openrouterApiKey, cfg.model, task)
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
      content: buildSystemPrompt(agentsGuide, sharedContext, summary, id, worktreePath)
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
