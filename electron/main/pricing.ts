// In-memory pricing cache. Fetched from OpenRouter's /models endpoint at first use.
// OpenRouter's catalog covers most third-party models we care about; Anthropic BYOK
// prices are separately maintained in ledger.ts.

let cache: Record<string, { prompt: number; completion: number }> | null = null
let fetchInFlight: Promise<void> | null = null
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
let fetchedAt = 0

export async function getPricing(): Promise<Record<string, { prompt: number; completion: number }>> {
  const stale = !cache || Date.now() - fetchedAt > CACHE_TTL_MS
  if (stale && !fetchInFlight) {
    fetchInFlight = refreshPricing().finally(() => { fetchInFlight = null })
  }
  if (fetchInFlight && !cache) await fetchInFlight
  return cache ?? {}
}

async function refreshPricing(): Promise<void> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    if (!res.ok) return
    const data = await res.json() as {
      data: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }>
    }
    const map: Record<string, { prompt: number; completion: number }> = {}
    for (const m of data.data) {
      map[m.id] = {
        prompt: parseFloat(m.pricing?.prompt ?? '0'),
        completion: parseFloat(m.pricing?.completion ?? '0')
      }
    }
    cache = map
    fetchedAt = Date.now()
  } catch (e) {
    console.warn('[vibe] failed to refresh pricing', e)
  }
}
