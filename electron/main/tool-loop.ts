// Small utilities shared by every agent loop (regular agent, PM agent, future
// specialized agents). Deliberately narrow — the outer loops differ enough that
// full unification would hurt more than it helps.

import type { Message, TokenUsage, ToolCall } from './types'
import type { Usage } from './providers'

// Execute a batch of tool calls, capture results as tool messages, and emit
// events. Returns whether the loop should stop (finish/ask_human called).
export interface ExecuteToolCallsOptions {
  toolCalls: ToolCall[]
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
  onToolCall?: (call: ToolCall) => void
  onToolResult?: (call: ToolCall, result: string) => void
  abortSignal?: AbortSignal
}

export interface ExecuteToolCallsResult {
  messages: Message[]
  calledFinish: boolean
  stoppedForInput: boolean
  aborted: boolean
}

export async function executeToolCalls(opts: ExecuteToolCallsOptions): Promise<ExecuteToolCallsResult> {
  const messages: Message[] = []
  let calledFinish = false
  let stoppedForInput = false
  let aborted = false

  for (const call of opts.toolCalls) {
    if (opts.abortSignal?.aborted) { aborted = true; break }
    opts.onToolCall?.(call)

    let result: string
    try {
      result = await opts.execute(call.name, call.arguments)
    } catch (e) {
      result = `[error] ${(e as Error).message}`
    }

    const toolMsg: Message = {
      role: 'tool',
      content: result,
      toolCallId: call.id,
      name: call.name
    }
    messages.push(toolMsg)
    opts.onToolResult?.(call, result)

    if (call.name === 'finish') calledFinish = true
    if (call.name === 'ask_human' || call.name === 'ask_human_choice') {
      stoppedForInput = true
      break
    }
  }

  return { messages, calledFinish, stoppedForInput, aborted }
}

// Accumulate token usage into a running total. Returns the new total.
export function accumulateUsage(prev: TokenUsage | undefined, incoming: Usage | undefined): TokenUsage | undefined {
  if (!incoming) return prev
  const base = prev ?? { prompt: 0, completion: 0, total: 0 }
  return {
    prompt: base.prompt + (incoming.prompt_tokens ?? 0),
    completion: base.completion + (incoming.completion_tokens ?? 0),
    total: base.total + (incoming.total_tokens ?? 0)
  }
}

// Pick a stable slug to pin the model to for the duration of a task, given the
// configured slug chain and whichever provider actually served the first turn.
// Only pins for multi-slug chains — single-slug configs are already unambiguous.
export function pinnedModelFor(
  currentPin: string | undefined,
  configuredModel: string,
  servedBy: string | undefined
): string | undefined {
  if (currentPin) return currentPin
  const slugs = configuredModel.split(',').map(s => s.trim()).filter(Boolean)
  if (slugs.length === 0) return undefined
  // Single-slug configs pin to the configured slug directly (preserves provider prefixes).
  if (slugs.length === 1) return slugs[0]
  // Multi-slug chains: pin to whichever configured slug matches what actually served.
  if (!servedBy) return undefined
  return slugs.find(s => s === servedBy || s.endsWith('/' + servedBy)) ?? servedBy
}
