// Context condenser (compaction). Long-running agents accumulate huge tool
// transcripts (file reads, list_files, replace_in_file outputs) that quickly
// dwarf what's useful. This module compresses the OLD middle of the transcript
// into a single summary message while preserving:
//   - The system prompt at index 0 (cache-stable prefix)
//   - The first user message (the original task, also cache-stable)
//   - The last K turns (recent working memory)
// Anthropic prompt caching benefits: the head stays byte-identical across
// turns, so cache hits keep working after compaction.

import type { Message } from './types'
import { shortCompletion, type ProviderKeys } from './providers'

// Rough token estimate — 4 chars/token is a decent enough heuristic for gating.
export function estimateTokens(messages: Message[]): number {
  let chars = 0
  for (const m of messages) {
    chars += (m.content ?? '').length
    if (m.toolCalls) {
      for (const tc of m.toolCalls) chars += tc.name.length + JSON.stringify(tc.arguments).length
    }
  }
  return Math.ceil(chars / 4)
}

// Find a "safe cut" — index at or after `preferred` where the message begins a
// clean turn (role='user', or assistant with no pending toolCalls awaiting
// results). Never leaves orphan tool_call/tool_result pairs.
export function findSafeCut(messages: Message[], preferred: number): number {
  for (let i = preferred; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user') return i
    if (m.role === 'system' && i !== 0) return i
  }
  return messages.length
}

// Format a compact transcript for the summarizer prompt.
function renderRange(messages: Message[]): string {
  const parts: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      parts.push(`USER: ${(m.content ?? '').slice(0, 2000)}`)
    } else if (m.role === 'assistant') {
      if (m.content) parts.push(`ASSISTANT: ${m.content.slice(0, 2000)}`)
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          parts.push(`TOOL_CALL ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 400)})`)
        }
      }
    } else if (m.role === 'tool') {
      parts.push(`TOOL_RESULT ${m.name}: ${(m.content ?? '').slice(0, 800)}`)
    } else if (m.role === 'system') {
      parts.push(`SYSTEM: ${(m.content ?? '').slice(0, 500)}`)
    }
  }
  return parts.join('\n')
}

export interface CondenseOptions {
  keys: ProviderKeys
  model: string           // model slug chain (uses primary)
  tokenBudget?: number    // trigger threshold (default 60_000)
  keepRecent?: number     // preserve last K messages (default 20)
  maxSummaryTokens?: number
  // Injectable summarizer for tests; defaults to shortCompletion().
  summarize?: (systemPrompt: string, userPrompt: string, maxTokens: number) => Promise<string>
}

// Returns a NEW compacted messages array, or the original if no compaction was
// needed / possible. Never mutates input.
export async function condenseIfNeeded(messages: Message[], opts: CondenseOptions): Promise<{ messages: Message[]; compacted: boolean }> {
  const budget = opts.tokenBudget ?? 60_000
  const keepRecent = opts.keepRecent ?? 20
  const est = estimateTokens(messages)
  if (est < budget) return { messages, compacted: false }

  // Need: system (idx 0) + first user (idx 1) + [compacted summary] + recent tail.
  // Skip if there aren't enough messages to meaningfully compact.
  if (messages.length < keepRecent + 6) return { messages, compacted: false }

  const preferredCutStart = 2                                  // after system + first user
  const preferredCutEnd = messages.length - keepRecent          // start of preserved tail
  const cutEnd = findSafeCut(messages, preferredCutEnd)
  if (cutEnd - preferredCutStart < 4) return { messages, compacted: false }

  const compressed = messages.slice(preferredCutStart, cutEnd)
  const transcript = renderRange(compressed)

  const summarizerSystemPrompt = `You are a context summarizer for a coding agent. The agent has been working on a long task and its conversation history needs compaction. Summarize the following transcript into a dense, structured recap so the agent can continue seamlessly.

Include:
- What has been ATTEMPTED and what the OUTCOMES were (successes, failures, errors)
- Files READ or MODIFIED and their key contents/roles
- Key DECISIONS made and any open QUESTIONS
- Any USER FEEDBACK or corrections given
- Current STATE / what to do next

Be terse but concrete. Preserve exact file paths, function names, error messages. Use bullet points. Aim for 300-800 words.`
  const maxTokens = opts.maxSummaryTokens ?? 1500
  const summarize = opts.summarize ?? ((sys, user, mt) => shortCompletion(opts.keys, opts.model, sys, user, mt))

  let summary: string
  try {
    summary = await summarize(summarizerSystemPrompt, transcript, maxTokens)
  } catch (e) {
    console.warn('[vibe] condenser failed to summarize, keeping original:', (e as Error).message)
    return { messages, compacted: false }
  }

  const summaryMsg: Message = {
    role: 'system',
    content: `[Compacted ${compressed.length} earlier turns to save context]\n\n${summary}`
  }

  const next = [
    ...messages.slice(0, preferredCutStart),
    summaryMsg,
    ...messages.slice(cutEnd)
  ]
  return { messages: next, compacted: true }
}
