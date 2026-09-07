export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface Message {
  role: Role
  content: string | null
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
  servedBy?: string
}

export type AgentStatus = 'idle' | 'running' | 'awaiting_input' | 'awaiting_merge' | 'merged' | 'error'

export interface AgentState {
  id: string
  status: AgentStatus
  task: string | null
  branch: string | null
  worktreePath: string | null
  messages: Message[]
  error?: string
  pinnedModel?: string
}

export interface Config {
  workspacePath: string | null
  openrouterApiKey: string | null
  model: string
  maxSteps: number
}

export interface AgentEvent {
  agentId: string
  type: 'status' | 'message' | 'tool_call' | 'tool_result' | 'error' | 'done'
  data: unknown
}

declare global {
  interface Window {
    vibe: {
      config: {
        get: () => Promise<Config>
        set: (p: Partial<Config>) => Promise<Config>
      }
      workspace: { pick: () => Promise<string | null> }
      context: {
        read: () => Promise<string>
        write: (content: string) => Promise<void>
      }
      agents: {
        list: () => Promise<AgentState[]>
        get: (id: string) => Promise<AgentState | undefined>
        ensure: (id: string) => Promise<AgentState>
        start: (id: string, task: string) => Promise<{ ok: boolean }>
        continue: (id: string, input: string) => Promise<{ ok: boolean }>
        kill: (id: string) => Promise<{ ok: boolean }>
        merge: (id: string) => Promise<{ ok: boolean; conflicts: string[]; output: string }>
        abortMerge: () => Promise<void>
        resolveConflicts: (id: string, files: string[]) => Promise<{
          files: Array<{ path: string; originalConflict: string; resolved: string }>
          servedBy?: string
          error?: string
        }>
        acceptResolution: (id: string, files: Array<{ path: string; originalConflict: string; resolved: string }>) => Promise<{ ok: boolean }>
      }
      onAgentEvent: (cb: (event: AgentEvent) => void) => () => void
    }
  }
}
