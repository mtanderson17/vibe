import { create } from 'zustand'
import type { AgentState, AgentEvent, Message, ToolCall } from '@/types'

interface AgentsStore {
  agents: Record<string, AgentState>
  focused: string
  setFocused: (id: string) => void
  hydrate: (list: AgentState[]) => void
  applyEvent: (event: AgentEvent) => void
}

function emptyAgent(id: string): AgentState {
  return { id, status: 'idle', task: null, branch: null, worktreePath: null, messages: [] }
}

export const useAgents = create<AgentsStore>((set) => ({
  agents: { 'agent-1': emptyAgent('agent-1'), 'agent-2': emptyAgent('agent-2') },
  focused: 'agent-1',
  setFocused: (id) => set({ focused: id }),
  hydrate: (list) => set(state => {
    const next = { ...state.agents }
    for (const a of list) next[a.id] = a
    return { agents: next }
  }),
  applyEvent: (event) => set(state => {
    const a = state.agents[event.agentId] ?? emptyAgent(event.agentId)
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
      case 'done':
        break
    }

    return { agents: { ...state.agents, [event.agentId]: updated } }
  })
}))
