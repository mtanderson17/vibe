// Discover which free-tier OpenRouter models actually work for a user's account,
// and detect a local Ollama install. Used by the Setup screen to make onboarding
// bulletproof against OpenRouter's rotating free-tier catalog.

export interface ModelProbeResult {
  slug: string
  status: 'ok' | 'rate_limited' | 'paid_only' | 'unavailable' | 'error'
  message?: string
  contextLength?: number
}

interface OpenRouterModel {
  id: string
  context_length?: number
  supported_parameters?: string[]
}

async function fetchFreeToolModels(): Promise<OpenRouterModel[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    if (!res.ok) return []
    const data = (await res.json()) as { data: OpenRouterModel[] }
    return data.data.filter(m =>
      m.id.endsWith(':free') &&
      Array.isArray(m.supported_parameters) &&
      m.supported_parameters.includes('tools')
    )
  } catch {
    return []
  }
}

async function pingModel(apiKey: string, slug: string, signal?: AbortSignal): Promise<ModelProbeResult> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/vibe-ide/vibe',
        'X-Title': 'Vibe'
      },
      body: JSON.stringify({
        model: slug,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
        tools: [{
          type: 'function',
          function: { name: 'ping', description: 'test', parameters: { type: 'object', properties: {} } }
        }],
        tool_choice: 'auto'
      }),
      signal
    })

    if (res.ok) return { slug, status: 'ok' }

    const body = await res.text().catch(() => '')
    if (res.status === 429) return { slug, status: 'rate_limited', message: 'Rate limited (try again later)' }
    if (res.status === 404 && body.includes('paid version')) {
      return { slug, status: 'paid_only', message: 'Now paid — no free variant available' }
    }
    if (res.status === 400 && body.includes('No models provided')) {
      return { slug, status: 'unavailable', message: 'Router found no matching free model right now' }
    }
    if (res.status === 403) return { slug, status: 'error', message: 'Access requires enabling free-tier privacy setting' }
    return { slug, status: 'error', message: `HTTP ${res.status}` }
  } catch (e) {
    return { slug, status: 'error', message: (e as Error).message }
  }
}

export async function probeOpenRouterFree(apiKey: string, maxCandidates = 8): Promise<ModelProbeResult[]> {
  const catalog = await fetchFreeToolModels()
  // Prefer models with the largest context (best for coding agent loops)
  catalog.sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))

  // Always include openrouter/free as a candidate — it's a router that picks a live model
  const candidates: string[] = ['openrouter/free']
  for (const m of catalog) {
    if (candidates.length >= maxCandidates) break
    if (!candidates.includes(m.id)) candidates.push(m.id)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const results = await Promise.all(candidates.map(slug => pingModel(apiKey, slug, controller.signal)))
    // Attach context length metadata where we have it
    for (const r of results) {
      const meta = catalog.find(m => m.id === r.slug)
      if (meta) r.contextLength = meta.context_length
    }
    return results
  } finally {
    clearTimeout(timeout)
  }
}

export interface OllamaDetectResult {
  available: boolean
  baseUrl: string
  models: Array<{ name: string; size?: number }>
  error?: string
}

export async function detectOllama(baseUrl = 'http://localhost:11434'): Promise<OllamaDetectResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return { available: false, baseUrl, models: [], error: `HTTP ${res.status}` }
    const data = (await res.json()) as { models?: Array<{ name: string; size?: number }> }
    return { available: true, baseUrl, models: data.models ?? [] }
  } catch (e) {
    return { available: false, baseUrl, models: [], error: (e as Error).message }
  }
}
