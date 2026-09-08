import { create } from 'zustand'
import type { AgentState, AgentEvent, Message, ToolCall, TokenUsage } from '@/types'

interface AgentsStore {
  agents: Record<string, AgentState>
  focused: string
  setFocused: (id: string) => void
  hydrate: (list: AgentState[]) => void
  addAgent: (agent: AgentState) => void
  removeAgent: (id: string) => void
  applyEvent: (event: AgentEvent) => void
}

function emptyAgent(id: string): AgentState {
  return { id, status: 'idle', task: null, branch: null, worktreePath: null, messages: [] }
}

export const useAgents = create<AgentsStore>((set) => ({
  agents: {},
  focused: 'agent-1',
  setFocused: (id) => set({ focused: id }),
  hydrate: (list) => set(state => {
    const next = { ...state.agents }
    for (const a of list) next[a.id] = a
    return { agents: next }
  }),
  addAgent: (agent) => set(state => ({ agents: { ...state.agents, [agent.id]: agent } })),
  removeAgent: (id) => set(state => {
    const next = { ...state.agents }
    delete next[id]
    return { agents: next, focused: state.focused === id ? '' : state.focused }
  }),
  applyEvent: (event) => set(state => {
    // Ignore events for agents that have been closed/removed.
    // Otherwise a late status/stream event from the still-winding-down loop
    // would resurrect the deleted agent in the UI.
    const a = state.agents[event.agentId]
    if (!a) return state
    const updated: AgentState = { ...a, messages: [...a.messages] }

    switch (event.type) {
      case 'status': {
        const data = event.data as string | { status: string; branch?: string; worktreePath?: string }
        if (typeof data === 'string') {
          updated.status = data as AgentState['status']
        } else {
          updated.status = data.status as AgentState['status']
          if (data.branch) updated.branch = data.branch
          if (data.worktreePath) updated.worktreePath = data.worktreePath
        }
        break
      }
      case 'message': {
        updated.messages.push(event.data as Message)
        break
      }
      case 'stream_start': {
        // Push a placeholder assistant message we'll append to as deltas arrive
        updated.messages.push({ role: 'assistant', content: '', servedBy: undefined })
        break
      }
      case 'stream_delta': {
        const lastIdx = updated.messages.length - 1
        const last = updated.messages[lastIdx]
        if (last && last.role === 'assistant') {
          updated.messages[lastIdx] = {
            ...last,
            content: (last.content ?? '') + (event.data as string)
          }
        }
        break
      }
      case 'stream_end': {
        // Replace the streaming placeholder with the final fully-parsed message
        const final = event.data as Message
        const lastIdx = updated.messages.length - 1
        if (lastIdx >= 0 && updated.messages[lastIdx].role === 'assistant') {
          updated.messages[lastIdx] = final
        } else {
          updated.messages.push(final)
        }
        break
      }
      case 'tool_call':
        // Rendering handled via the assistant message that included it
        break
      case 'tool_result': {
        const { call, result } = event.data as { call: ToolCall; result: string }
        updated.messages.push({
          role: 'tool',
          content: result,
          toolCallId: call.id,
          name: call.name
        })
        break
      }
      case 'error':
        updated.error = event.data as string
        updated.status = 'error'
        break
      case 'usage':
        updated.usage = event.data as TokenUsage
        break
      case 'step': {
        const s = event.data as { step: number; max: number }
        updated.step = s.step
        updated.maxSteps = s.max
        break
      }
      case 'done':
        break
    }

    return { agents: { ...state.agents, [event.agentId]: updated } }
  })
}))
