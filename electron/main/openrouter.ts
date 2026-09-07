import type { Message } from './types'
import { TOOL_SCHEMAS } from './tools'

interface OpenRouterToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenRouterChoice {
  message: {
    role: 'assistant'
    content: string | null
    tool_calls?: OpenRouterToolCall[]
  }
  finish_reason: string
}

interface OpenRouterResponse {
  model?: string
  choices: OpenRouterChoice[]
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

function buildRequestBody(model: string, messages: Message[]): Record<string, unknown> {
  const slugs = model.split(',').map(s => s.trim()).filter(Boolean)
  const body: Record<string, unknown> = {
    messages: toApiMessages(messages),
    tools: TOOL_SCHEMAS,
    tool_choice: 'auto'
  }
  if (slugs.length > 1) body.models = slugs
  else body.model = slugs[0] ?? model
  return body
}

// Simple single-call completion (no tools) — for utility tasks like slug generation.
export async function shortCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const slugs = model.split(',').map(s => s.trim()).filter(Boolean)
  const body: Record<string, unknown> = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 30
  }
  if (slugs.length > 1) body.models = slugs
  else body.model = slugs[0] ?? model

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/vibe-ide/vibe',
      'X-Title': 'Vibe'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) throw new Error(`shortCompletion ${res.status}`)
  const data = (await res.json()) as OpenRouterResponse
  return data.choices?.[0]?.message?.content ?? ''
}

function toApiMessages(messages: Message[]): unknown[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content ?? '',
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      }
    }
    return { role: m.role, content: m.content ?? '' }
  })
}

function providerFor(slug: string): { baseUrl: string; model: string; needsAuth: boolean; label: string } {
  if (slug.startsWith('ollama/')) {
    return { baseUrl: 'http://localhost:11434/v1', model: slug.slice(7), needsAuth: false, label: 'Ollama' }
  }
  return { baseUrl: 'https://openrouter.ai/api/v1', model: slug, needsAuth: true, label: 'OpenRouter' }
}

export async function chatCompletion(
  apiKey: string,
  model: string,
  messages: Message[],
  signal?: AbortSignal,
  onDelta?: (text: string) => void
): Promise<{ message: Message; usage?: OpenRouterResponse['usage'] }> {
  const slugs = model.split(',').map(s => s.trim()).filter(Boolean)
  const streaming = !!onDelta
  let lastError = ''

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]
    const provider = providerFor(slug)

    // OpenRouter supports server-side fallback via `models` array. Ollama doesn't.
    // So for Ollama slugs, send one at a time; for OpenRouter slugs, chain the rest.
    let attemptModel: string
    if (provider.label === 'Ollama') {
      attemptModel = provider.model
    } else {
      // Collect the OpenRouter-family slugs from this position onward
      const chain = slugs.slice(i).filter(s => !s.startsWith('ollama/'))
      attemptModel = chain.length > 1 ? chain.join(',') : chain[0]
    }

    const body = buildRequestBody(attemptModel, messages)
    if (streaming) {
      body.stream = true
      body.stream_options = { include_usage: true }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (provider.needsAuth) {
      headers['Authorization'] = `Bearer ${apiKey}`
      headers['HTTP-Referer'] = 'https://github.com/vibe-ide/vibe'
      headers['X-Title'] = 'Vibe'
    }

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })

    if (res.ok) {
      if (streaming && res.body) {
        return await consumeStream(res.body, onDelta!)
      }
      const data = (await res.json()) as OpenRouterResponse
      return finalizeResponse(data)
    }

    lastError = `${provider.label} ${res.status}: ${await res.text().catch(() => '')}`
    if (![400, 402, 404, 429, 503].includes(res.status)) break
    console.warn(`[vibe] ${slug} failed (${res.status}), trying next fallback`)

    // If this was a chained OpenRouter attempt, the whole chain already tried on the server side —
    // skip forward past all remaining OpenRouter slugs to any Ollama fallback
    if (provider.label === 'OpenRouter') {
      while (i + 1 < slugs.length && !slugs[i + 1].startsWith('ollama/')) i++
    }
  }

  throw new Error(lastError || 'No providers available')
}

interface PartialToolCall {
  id: string
  name: string
  argsBuffer: string
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<{ message: Message; usage?: OpenRouterResponse['usage'] }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const toolCalls = new Map<number, PartialToolCall>()
  let servedBy: string | undefined
  let usage: OpenRouterResponse['usage']

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) continue // SSE comment or blank
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue

        let chunk: {
          model?: string
          choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }>
          usage?: OpenRouterResponse['usage']
        }
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

  return {
    message: {
      role: 'assistant',
      content: content || null,
      toolCalls: finalToolCalls.length ? finalToolCalls : undefined,
      servedBy
    },
    usage
  }
}

function finalizeResponse(
  data: OpenRouterResponse
): { message: Message; usage?: OpenRouterResponse['usage'] } {
  const choice = data.choices?.[0]
  if (!choice) throw new Error('No choices returned from model')

  const toolCalls = choice.message.tool_calls?.map(tc => {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments || '{}')
    } catch {
      args = { _raw: tc.function.arguments }
    }
    return { id: tc.id, name: tc.function.name, arguments: args }
  })

  return {
    message: {
      role: 'assistant',
      content: choice.message.content,
      toolCalls,
      servedBy: data.model
    },
    usage: data.usage
  }
}
