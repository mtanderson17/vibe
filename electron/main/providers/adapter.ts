// Generic OpenAI-compatible chat completion adapter.
// Handles OpenRouter, Ollama's /v1/openai endpoint, and Anthropic's /v1/openai endpoint.
// Auth style, headers, and base URL vary; wire format is identical.

import type { Message } from '../types'
import type { CompletionResult, OpenAIRawResponse, ProviderInfo } from './types'
import { toApiMessages, parseToolCalls } from './serialize'
import { consumeStream } from './stream'

export function providerFor(slug: string, keys: ProviderKeys): ProviderInfo & { apiKey: string | null } {
  if (slug.startsWith('ollama/')) {
    return {
      baseUrl: 'http://localhost:11434/v1',
      model: slug.slice('ollama/'.length),
      needsAuth: false,
      label: 'Ollama',
      apiKey: null
    }
  }
  // anthropic/* routes to Anthropic direct ONLY if an Anthropic key is configured.
  // Otherwise the same slug is a valid OpenRouter slug (they use the same format),
  // so we fall through to OpenRouter — matching what users copy from OpenRouter's site.
  if (slug.startsWith('anthropic/') && keys.anthropic) {
    return {
      baseUrl: 'https://api.anthropic.com/v1',
      model: slug.slice('anthropic/'.length),
      needsAuth: true,
      label: 'Anthropic',
      apiKey: keys.anthropic
    }
  }
  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: slug,
    needsAuth: true,
    label: 'OpenRouter',
    apiKey: keys.openrouter ?? null
  }
}

export interface ProviderKeys {
  openrouter?: string | null
  anthropic?: string | null
}

export interface CompletionOptions {
  provider: ProviderInfo & { apiKey: string | null }
  modelInBody: string        // may be a comma-joined list for OpenRouter `models` fallback
  useModelsArray?: boolean   // true → send `models: [...]` instead of `model: "..."`
  messages: Message[]
  tools?: Array<Record<string, unknown>>
  maxTokens?: number
  stream?: boolean
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

// One HTTP call to one provider. Returns a normalized message + usage.
export async function completion(opts: CompletionOptions): Promise<CompletionResult> {
  const { provider, modelInBody, useModelsArray, messages, tools, maxTokens, stream, onDelta, signal } = opts

  const body: Record<string, unknown> = {
    messages: toApiMessages(messages)
  }
  if (useModelsArray) body.models = modelInBody.split(',').map(s => s.trim()).filter(Boolean)
  else body.model = modelInBody
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  if (maxTokens) body.max_tokens = maxTokens
  if (stream) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.label === 'Anthropic') {
    if (!provider.apiKey) throw new Error('Anthropic API key not set')
    headers['x-api-key'] = provider.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (provider.needsAuth) {
    if (!provider.apiKey) throw new Error(`${provider.label} API key not set`)
    headers['Authorization'] = `Bearer ${provider.apiKey}`
    headers['HTTP-Referer'] = 'https://github.com/vibe-ide/vibe'
    headers['X-Title'] = 'Vibe'
  }

  // Anthropic's OpenAI-compat endpoint lives under /v1/chat/completions like the others
  const url = provider.label === 'Anthropic'
    ? 'https://api.anthropic.com/v1/chat/completions'
    : `${provider.baseUrl}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ProviderError(`${provider.label} ${res.status}: ${text}`, res.status, provider.label)
  }

  if (stream && res.body) {
    return consumeStream(res.body, onDelta ?? (() => {}))
  }

  const data = (await res.json()) as OpenAIRawResponse
  const choice = data.choices?.[0]
  if (!choice) throw new Error('No choices returned from model')

  return {
    message: {
      role: 'assistant',
      content: choice.message.content,
      toolCalls: parseToolCalls(choice),
      servedBy: data.model
    },
    usage: data.usage
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public provider: ProviderInfo['label']
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
