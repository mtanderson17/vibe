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

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface LedgerTotals {
  prompt: number
  completion: number
  total: number
  cost: number
}

export interface AgentState {
  id: string
  displayName?: string
  status: AgentStatus
  task: string | null
  branch: string | null
  worktreePath: string | null
  messages: Message[]
  error?: string
  pinnedModel?: string
  modelOverride?: string
  usage?: TokenUsage
  step?: number
  maxSteps?: number
}

export interface Config {
  workspacePath: string | null
  recentWorkspaces: string[]
  openrouterApiKey: string | null
  anthropicApiKey: string | null
  openaiApiKey: string | null
  geminiApiKey: string | null
  groqApiKey: string | null
  xaiApiKey: string | null
  model: string
  pmModel: string | null
  maxSteps: number
  agentCount: number
}

export interface AgentEvent {
  agentId: string
  type: 'status' | 'message' | 'tool_call' | 'tool_result' | 'error' | 'done' | 'usage' | 'stream_start' | 'stream_delta' | 'stream_end' | 'step' | 'sync'
  data: unknown
}

declare global {
  interface Window {
    vibe: {
      config: {
        get: () => Promise<Config>
        set: (p: Partial<Config>) => Promise<Config>
      }
      probe: {
        openrouter: (apiKey: string) => Promise<Array<{
          slug: string
          status: 'ok' | 'rate_limited' | 'paid_only' | 'unavailable' | 'error'
          message?: string
          contextLength?: number
        }>>
        ollama: () => Promise<{
          available: boolean
          baseUrl: string
          models: Array<{ name: string; size?: number }>
          error?: string
        }>
      }
      models: {
        pricing: () => Promise<Record<string, { prompt: number; completion: number }>>
        listProvider: (provider: 'anthropic' | 'openai' | 'gemini' | 'groq' | 'xai') => Promise<string[]>
      }
      ledger: {
        summary: () => Promise<{
          totals: { all: LedgerTotals; today: LedgerTotals; last7d: LedgerTotals }
          bySource: Array<{ source: string; totals: LedgerTotals }>
          byModel: Array<{ model: string; totals: LedgerTotals }>
          byDay: Array<{ date: string; totals: LedgerTotals }>
          entryCount: number
        } | null>
      }
      tasks: {
        list: () => Promise<Array<{ id: string; title: string; description?: string; status: string; assignedTo?: string | null; branch?: string | null; proposed?: boolean; proposedBy?: string; createdAt: string; updatedAt: string }>>
        create: (title: string, description?: string) => Promise<{ id: string }>
        update: (id: string, patch: Record<string, unknown>) => Promise<unknown>
        delete: (id: string) => Promise<void>
        assignToAgent: (taskId: string, agentId: string) => Promise<{ ok: boolean }>
      }
      pm: {
        state: () => Promise<{ status: 'idle' | 'running' | 'error'; lastRun: string | null; lastTrigger: 'merge' | 'manual' | 'chat' | null; messages: Message[]; error?: string; usage?: TokenUsage; pinnedModel?: string }>
        run: (trigger: 'manual' | 'chat', userInput?: string) => Promise<{ ok: boolean }>
        clear: () => Promise<{ ok: boolean }>
        kill: () => Promise<{ ok: boolean; message: string }>
        readSummary: () => Promise<string>
        lastModified: () => Promise<string | null>
      }
      onPmEvent: (cb: (event: { type: string; data: unknown }) => void) => () => void
      approval: {
        respond: (id: string, approved: boolean) => Promise<void>
      }
      onApprovalRequest: (cb: (req: { id: string; agentId: string; command: string; reason: string }) => void) => () => void
      onMenuCommand: (cb: (channel: string, ...args: unknown[]) => void) => () => void
      workspace: {
        pick: () => Promise<string | null>
        switch: (path?: string) => Promise<string | null>
      }
      onWorkspaceSwitched: (cb: (path: string) => void) => () => void
      context: {
        read: () => Promise<string>
        write: (content: string) => Promise<void>
      }
      agents: {
        list: () => Promise<AgentState[]>
        get: (id: string) => Promise<AgentState | undefined>
        ensure: (id: string) => Promise<AgentState>
        spawn: () => Promise<AgentState>
        close: (id: string) => Promise<{ ok: boolean }>
        start: (id: string, task: string) => Promise<{ ok: boolean }>
        continue: (id: string, input: string) => Promise<{ ok: boolean }>
        kill: (id: string) => Promise<{ ok: boolean }>
        setModel: (id: string, model: string | null) => Promise<{ ok: boolean }>
        setName: (id: string, name: string | null) => Promise<{ ok: boolean }>
        checkOverlap: (id: string) => Promise<{ own: string[]; overlaps: Record<string, string[]> }>
        previewDiff: (id: string) => Promise<{
          files: Array<{ path: string; addedLines: number; removedLines: number; diff: string }>
          totalAdded: number
          totalRemoved: number
        }>
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
