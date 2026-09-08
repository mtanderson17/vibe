import type { Message } from '../types'
import type { CompletionResult, StreamChunk } from './types'

interface PartialToolCall {
  id: string
  name: string
  argsBuffer: string
}

// Consume an OpenAI-format SSE stream (works for OpenRouter, Ollama's OpenAI-compat,
// and Anthropic's OpenAI-compat endpoint). Accumulates content deltas and tool-call
// argument fragments, returning a fully-parsed message when the stream ends.
export async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<CompletionResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const toolCalls = new Map<number, PartialToolCall>()
  let servedBy: string | undefined
  let usage: CompletionResult['usage']

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue

        let chunk: StreamChunk
        try { chunk = JSON.parse(payload) } catch { continue }

        if (chunk.model && !servedBy) servedBy = chunk.model
        if (chunk.usage) usage = chunk.usage

        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        if (delta.content) {
          content += delta.content
          onDelta(delta.content)
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCalls.get(tc.index) ?? { id: '', name: '', argsBuffer: '' }
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name += tc.function.name
            if (tc.function?.arguments) existing.argsBuffer += tc.function.arguments
            toolCalls.set(tc.index, existing)
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* noop */ }
  }

  const finalToolCalls = Array.from(toolCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.argsBuffer || '{}') }
      catch { args = { _raw: tc.argsBuffer } }
      return { id: tc.id, name: tc.name, arguments: args }
    })

  const message: Message = {
    role: 'assistant',
    content: content || null,
    toolCalls: finalToolCalls.length ? finalToolCalls : undefined,
    servedBy
  }

  return { message, usage }
}
