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

export interface AgentEvent {
  agentId: string
  type: 'status' | 'message' | 'tool_call' | 'tool_result' | 'error' | 'done' | 'usage' | 'stream_start' | 'stream_delta' | 'stream_end' | 'step'
  data: unknown
}

export type AgentStatus = 'idle' | 'running' | 'awaiting_input' | 'awaiting_merge' | 'merged' | 'error'

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface AgentState {
  id: string
  displayName?: string     // user-editable label; falls back to id if unset
  status: AgentStatus
  task: string | null
  branch: string | null
  worktreePath: string | null
  messages: Message[]
  error?: string
  pinnedModel?: string
  modelOverride?: string   // optional per-agent model, overrides global cfg.model
  usage?: TokenUsage
  step?: number
  maxSteps?: number
}

export interface Config {
  workspacePath: string | null
  openrouterApiKey: string | null
  anthropicApiKey: string | null
  openaiApiKey: string | null
  geminiApiKey: string | null
  groqApiKey: string | null
  xaiApiKey: string | null
  model: string
  pmModel: string | null   // optional PM-specific model; falls back to global model if null/empty
  maxSteps: number
  agentCount: number
}
