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

export async function chatCompletion(
  apiKey: string,
  model: string,
  messages: Message[],
  signal?: AbortSignal
): Promise<{ message: Message; usage?: OpenRouterResponse['usage'] }> {
  const slugs = model.split(',').map(s => s.trim()).filter(Boolean)
  let lastError = ''

  for (let i = 0; i < slugs.length; i++) {
    const attempt = slugs.slice(i).join(',')
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/vibe-ide/vibe',
        'X-Title': 'Vibe'
      },
      body: JSON.stringify(buildRequestBody(attempt, messages)),
      signal
    })

    if (res.ok) {
      const data = (await res.json()) as OpenRouterResponse
      return finalizeResponse(data)
    }

    lastError = `${res.status}: ${await res.text().catch(() => '')}`
    // Only fall through on router-empty / rate-limit / unavailable errors
    if (![400, 402, 404, 429, 503].includes(res.status)) break
    console.warn(`[vibe] ${slugs[i]} failed (${res.status}), trying next fallback`)
  }

  throw new Error(`OpenRouter ${lastError}`)
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
