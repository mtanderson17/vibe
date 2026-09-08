// Fallback-chain wrapper around the generic OpenAI-compat adapter.
// Handles: mixed-provider chains, OpenRouter's server-side `models` fallback, and
// client-side failover on transient/depleted-model errors.

import type { Message } from '../types'
import type { CompletionResult } from './types'
import { completion, providerFor, ProviderError, type ProviderKeys } from './adapter'

// HTTP statuses where we transparently try the next slug in the chain.
const RETRYABLE = new Set([400, 402, 404, 429, 503])

export interface ChainOptions {
  model: string                     // comma-separated slug chain
  keys: ProviderKeys
  messages: Message[]
  tools?: Array<Record<string, unknown>>
  maxTokens?: number
  signal?: AbortSignal
  onDelta?: (text: string) => void  // presence enables streaming
}

export async function chatCompletion(opts: ChainOptions): Promise<CompletionResult> {
  const slugs = opts.model.split(',').map(s => s.trim()).filter(Boolean)
  if (!slugs.length) throw new Error('No model configured')

  const streaming = !!opts.onDelta
  let lastError = ''

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]
    const provider = providerFor(slug, opts.keys)

    // Only OpenRouter supports server-side `models` fallback. Direct BYOK providers
    // (Anthropic/OpenAI/Gemini/Groq/xAI/Ollama) get called one at a time.
    let modelInBody: string
    let useModelsArray = false
    if (provider.label === 'OpenRouter') {
      const chain = slugs.slice(i).filter(s => !isDirectProviderSlug(s))
      modelInBody = chain.length > 1 ? chain.join(',') : chain[0]
      useModelsArray = chain.length > 1
    } else {
      modelInBody = provider.model
    }

    try {
      return await completion({
        provider,
        modelInBody,
        useModelsArray,
        messages: opts.messages,
        tools: opts.tools,
        maxTokens: opts.maxTokens,
        stream: streaming,
        onDelta: opts.onDelta,
        signal: opts.signal
      })
    } catch (e) {
      if (opts.signal?.aborted) throw e
      if (!(e instanceof ProviderError) || !RETRYABLE.has(e.status)) throw e

      lastError = e.message
      console.warn(`[vibe] ${slug} failed (${e.status}), trying next fallback`)

      // Already tried the whole OpenRouter batch on the server side — skip
      // forward past all remaining OpenRouter slugs to any direct-provider fallback.
      if (provider.label === 'OpenRouter') {
        while (i + 1 < slugs.length && !isDirectProviderSlug(slugs[i + 1])) i++
      }
    }
  }

  throw new Error(lastError || 'No providers available')
}

const DIRECT_PROVIDER_PREFIXES = ['ollama/', 'anthropic/', 'openai/', 'google/', 'gemini/', 'groq/', 'xai/', 'x-ai/']

function isDirectProviderSlug(slug: string): boolean {
  return DIRECT_PROVIDER_PREFIXES.some(p => slug.startsWith(p))
}
