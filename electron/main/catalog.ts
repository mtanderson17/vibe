// Per-provider model catalogs. Each provider exposes some form of /v1/models
// (Anthropic, OpenAI, Groq, xAI) or an equivalent. Returns normalized slug list
// prefixed with the provider ("anthropic/claude-…", "groq/llama-…").
//
// Cached in memory with a 6-hour TTL. On error, fall back to a small curated list
// so the UI is never empty.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface CacheEntry { fetchedAt: number; models: string[] }
const cache = new Map<string, CacheEntry>()

const CURATED: Record<string, string[]> = {
  anthropic: [
    'anthropic/claude-opus-4-7',
    'anthropic/claude-opus-4-6',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-sonnet-4-5',
    'anthropic/claude-haiku-4-5'
  ],
  openai: ['openai/gpt-5', 'openai/gpt-5-mini', 'openai/gpt-5-nano'],
  gemini: ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
  groq: ['groq/llama-3.3-70b-versatile', 'groq/deepseek-r1-distill-llama-70b', 'groq/qwen-2.5-coder-32b'],
  xai: ['xai/grok-4', 'xai/grok-4-mini']
}

export async function listProviderModels(
  provider: 'anthropic' | 'openai' | 'gemini' | 'groq' | 'xai',
  apiKey: string
): Promise<string[]> {
  if (!apiKey) return CURATED[provider] ?? []
  const cacheKey = `${provider}:${apiKey.slice(0, 8)}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.models

  try {
    const models = await fetchProviderModels(provider, apiKey)
    if (models.length > 0) {
      cache.set(cacheKey, { fetchedAt: Date.now(), models })
      return models
    }
  } catch (e) {
    console.warn(`[vibe] listProviderModels ${provider} failed, using curated`, e)
  }
  return CURATED[provider] ?? []
}

async function fetchProviderModels(
  provider: 'anthropic' | 'openai' | 'gemini' | 'groq' | 'xai',
  apiKey: string
): Promise<string[]> {
  switch (provider) {
    case 'anthropic': {
      // Anthropic's OpenAI-compat endpoint doesn't expose /models, but native does.
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      })
      if (!res.ok) throw new Error(`Anthropic ${res.status}`)
      const data = await res.json() as { data?: Array<{ id: string }> }
      return (data.data ?? []).map(m => `anthropic/${m.id}`)
    }
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
      if (!res.ok) throw new Error(`OpenAI ${res.status}`)
      const data = await res.json() as { data?: Array<{ id: string }> }
      // Filter to chat-capable models (heuristic: exclude image/audio/embedding-only ids)
      return (data.data ?? [])
        .map(m => m.id)
        .filter(id => !id.includes('embedding') && !id.includes('whisper') && !id.includes('tts') && !id.includes('dall-e') && !id.includes('davinci') && !id.includes('babbage'))
        .map(id => `openai/${id}`)
        .sort()
    }
    case 'gemini': {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
      if (!res.ok) throw new Error(`Gemini ${res.status}`)
      const data = await res.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }
      return (data.models ?? [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => `google/${m.name.replace(/^models\//, '')}`)
        .sort()
    }
    case 'groq': {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
      if (!res.ok) throw new Error(`Groq ${res.status}`)
      const data = await res.json() as { data?: Array<{ id: string }> }
      return (data.data ?? []).map(m => `groq/${m.id}`).sort()
    }
    case 'xai': {
      const res = await fetch('https://api.x.ai/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
      if (!res.ok) throw new Error(`xAI ${res.status}`)
      const data = await res.json() as { data?: Array<{ id: string }> }
      return (data.data ?? []).map(m => `xai/${m.id}`).sort()
    }
  }
}
