// Append-only cost ledger. One line per LLM request, JSONL for durability and
// zero-migration extension. Aggregations computed on read.

import { appendFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface LedgerEntry {
  timestamp: string           // ISO-8601
  source: string              // 'agent-1' | 'pm-agent' | 'resolver' | etc.
  model: string               // fully-qualified slug (with provider prefix)
  branch: string | null
  task: string | null         // task title if known, else the initial user prompt
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number            // computed at write time from pricing snapshot
}

function ledgerPath(workspacePath: string): string {
  return path.join(workspacePath, '.vibe', 'cost.jsonl')
}

export async function appendLedgerEntry(workspacePath: string, entry: LedgerEntry): Promise<void> {
  const p = ledgerPath(workspacePath)
  if (!existsSync(path.dirname(p))) {
    await mkdir(path.dirname(p), { recursive: true })
  }
  await appendFile(p, JSON.stringify(entry) + '\n', 'utf8')
}

export async function readLedger(workspacePath: string): Promise<LedgerEntry[]> {
  const p = ledgerPath(workspacePath)
  if (!existsSync(p)) return []
  const raw = await readFile(p, 'utf8')
  const entries: LedgerEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try { entries.push(JSON.parse(trimmed) as LedgerEntry) } catch { /* skip corrupt line */ }
  }
  return entries
}

// Pricing map (matches OpenRouter's format). Keyed by fully-qualified slug.
// per-token USD. Anthropic BYOK entries hardcoded here since Anthropic doesn't
// publish an API; OpenRouter models fetched dynamically and merged in at runtime.
export const ANTHROPIC_BYOK_PRICES: Record<string, { prompt: number; completion: number }> = {
  'anthropic/claude-opus-4-7':      { prompt: 0.000015, completion: 0.000075 },
  'anthropic/claude-opus-4-6':      { prompt: 0.000015, completion: 0.000075 },
  'anthropic/claude-sonnet-4-6':    { prompt: 0.000003, completion: 0.000015 },
  'anthropic/claude-sonnet-4-5':    { prompt: 0.000003, completion: 0.000015 },
  'anthropic/claude-haiku-4-5':     { prompt: 0.000001, completion: 0.000005 },
  'anthropic/claude-haiku-4-5-20251001': { prompt: 0.000001, completion: 0.000005 }
}

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  externalPricing: Record<string, { prompt: number; completion: number }>
): number {
  if (model.startsWith('ollama/') || model.includes(':free')) return 0
  const p = externalPricing[model] ?? ANTHROPIC_BYOK_PRICES[model]
  if (!p) return 0
  return promptTokens * p.prompt + completionTokens * p.completion
}

// --- Aggregations ---

export interface Summary {
  totals: { all: Totals; today: Totals; last7d: Totals }
  bySource: Array<{ source: string; totals: Totals }>
  byModel: Array<{ model: string; totals: Totals }>
  byDay: Array<{ date: string; totals: Totals }>  // last 30 days, ascending
  entryCount: number
}

export interface Totals {
  prompt: number
  completion: number
  total: number
  cost: number
}

function emptyTotals(): Totals { return { prompt: 0, completion: 0, total: 0, cost: 0 } }
function add(a: Totals, e: LedgerEntry): void {
  a.prompt += e.prompt_tokens
  a.completion += e.completion_tokens
  a.total += e.total_tokens
  a.cost += e.cost_usd
}

export function summarize(entries: LedgerEntry[]): Summary {
  const all = emptyTotals()
  const today = emptyTotals()
  const last7 = emptyTotals()
  const bySourceMap: Record<string, Totals> = {}
  const byModelMap: Record<string, Totals> = {}
  const byDayMap: Record<string, Totals> = {}

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  for (const e of entries) {
    add(all, e)
    const date = e.timestamp.slice(0, 10)
    if (date === todayStr) add(today, e)
    if (new Date(e.timestamp) >= sevenDaysAgo) add(last7, e)

    if (!bySourceMap[e.source]) bySourceMap[e.source] = emptyTotals()
    add(bySourceMap[e.source], e)

    if (!byModelMap[e.model]) byModelMap[e.model] = emptyTotals()
    add(byModelMap[e.model], e)

    if (!byDayMap[date]) byDayMap[date] = emptyTotals()
    add(byDayMap[date], e)
  }

  const bySource = Object.entries(bySourceMap)
    .map(([source, totals]) => ({ source, totals }))
    .sort((a, b) => b.totals.total - a.totals.total)

  const byModel = Object.entries(byModelMap)
    .map(([model, totals]) => ({ model, totals }))
    .sort((a, b) => b.totals.total - a.totals.total)

  const byDay = Object.entries(byDayMap)
    .map(([date, totals]) => ({ date, totals }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30)

  return {
    totals: { all, today, last7d: last7 },
    bySource,
    byModel,
    byDay,
    entryCount: entries.length
  }
}
