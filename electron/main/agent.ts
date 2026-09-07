import type { WebContents } from 'electron'
import type { AgentEvent, AgentState, Message } from './types'
import { chatCompletion } from './openrouter'
import { executeTool, killAgentProcesses } from './tools'
import { createWorktree, commitAll } from './git'
import { readContext, readAgentsGuide } from './context'
import { getConfig } from './config'

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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'task'
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
  agentId: string,
  worktreePath: string
): string {
  return `${agentsGuide}

---

# Project Context
${sharedContext}

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
  emit({ agentId: agent.id, type: 'status', data: agent.status })

  let steps = 0
  let calledFinish = false
  let stoppedForInput = false
  let killed = false

  try {
    while (steps < cfg.maxSteps && !calledFinish && !stoppedForInput) {
      if (abort.signal.aborted) { killed = true; break }
      steps++

      // Use pinned model if set (from first successful response), else the configured chain
      const modelForCall = agent.pinnedModel ?? cfg.model
      const { message } = await chatCompletion(cfg.openrouterApiKey, modelForCall, agent.messages, abort.signal)
      agent.messages.push(message)
      emit({ agentId: agent.id, type: 'message', data: message })

      // Pin the model to whichever one actually served the first turn
      if (!agent.pinnedModel && message.servedBy) {
        agent.pinnedModel = message.servedBy
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
  agent.status = 'running'
  emit({ agentId: id, type: 'status', data: agent.status })

  try {
    const slug = slugify(task)
    const { worktreePath, branch } = await createWorktree(cfg.workspacePath, id, slug)
    agent.worktreePath = worktreePath
    agent.branch = branch
    emit({ agentId: id, type: 'status', data: { status: agent.status, branch, worktreePath } })

    const [sharedContext, agentsGuide] = await Promise.all([
      readContext(cfg.workspacePath),
      readAgentsGuide(cfg.workspacePath)
    ])
    const systemMsg: Message = {
      role: 'system',
      content: buildSystemPrompt(agentsGuide, sharedContext, id, worktreePath)
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
  if (agent.status !== 'awaiting_input') {
    throw new Error(`Agent ${id} is not awaiting input (status: ${agent.status})`)
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
