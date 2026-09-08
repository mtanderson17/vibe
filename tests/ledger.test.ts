import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appendLedgerEntry,
  readLedger,
  summarize,
  estimateCost,
  type LedgerEntry
} from '../electron/main/ledger'

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibe-ledger-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    timestamp: new Date().toISOString(),
    source: 'agent-1',
    model: 'anthropic/claude-haiku-4-5',
    branch: null,
    task: null,
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cost_usd: 0.00035,
    ...overrides
  }
}

test('readLedger returns [] for missing file', async () => {
  const { dir, cleanup } = scratch()
  try {
    const entries = await readLedger(dir)
    assert.deepEqual(entries, [])
  } finally { cleanup() }
})

test('appendLedgerEntry + readLedger roundtrip preserves entries', async () => {
  const { dir, cleanup } = scratch()
  try {
    const e1 = entry({ source: 'agent-1', total_tokens: 100 })
    const e2 = entry({ source: 'pm-agent', total_tokens: 200 })
    await appendLedgerEntry(dir, e1)
    await appendLedgerEntry(dir, e2)
    const entries = await readLedger(dir)
    assert.equal(entries.length, 2)
    assert.equal(entries[0].source, 'agent-1')
    assert.equal(entries[1].source, 'pm-agent')
  } finally { cleanup() }
})

test('readLedger skips corrupt lines', async () => {
  const { dir, cleanup } = scratch()
  try {
    await appendLedgerEntry(dir, entry({ source: 'agent-1' }))
    // Manually corrupt: append invalid JSON line
    const { appendFile } = await import('node:fs/promises')
    await appendFile(path.join(dir, '.vibe', 'cost.jsonl'), 'not valid json\n', 'utf8')
    await appendLedgerEntry(dir, entry({ source: 'agent-2' }))
    const entries = await readLedger(dir)
    assert.equal(entries.length, 2)
  } finally { cleanup() }
})

// --- estimateCost ---

test('estimateCost: free models return 0', () => {
  const cost = estimateCost('openrouter/free', 1000, 500, {})
  assert.equal(cost, 0)
})

test('estimateCost: ollama models return 0', () => {
  const cost = estimateCost('ollama/llama3.2:3b', 1000, 500, {
    'ollama/llama3.2:3b': { prompt: 0.001, completion: 0.001 }
  })
  assert.equal(cost, 0)
})

test('estimateCost: :free suffix models return 0 even if pricing exists', () => {
  const cost = estimateCost('meta-llama/llama-3.3-70b-instruct:free', 1000, 500, {})
  assert.equal(cost, 0)
})

test('estimateCost: falls back to Anthropic BYOK table', () => {
  const cost = estimateCost('anthropic/claude-haiku-4-5', 1_000_000, 1_000_000, {})
  // 1M prompt * 0.000001 + 1M completion * 0.000005 = 1 + 5 = 6
  assert.equal(cost, 6)
})

test('estimateCost: uses external pricing map when available', () => {
  const cost = estimateCost('some/model', 1_000_000, 1_000_000, {
    'some/model': { prompt: 0.00001, completion: 0.00003 }
  })
  // 1M * 0.00001 + 1M * 0.00003 = 10 + 30 = 40
  assert.equal(cost, 40)
})

// --- summarize ---

test('summarize: empty ledger returns zero totals', () => {
  const s = summarize([])
  assert.equal(s.entryCount, 0)
  assert.equal(s.totals.all.total, 0)
  assert.equal(s.totals.today.total, 0)
  assert.deepEqual(s.bySource, [])
  assert.deepEqual(s.byModel, [])
})

test('summarize: aggregates totals across entries', () => {
  const s = summarize([
    entry({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost_usd: 0.01 }),
    entry({ prompt_tokens: 200, completion_tokens: 100, total_tokens: 300, cost_usd: 0.02 })
  ])
  assert.equal(s.totals.all.prompt, 300)
  assert.equal(s.totals.all.completion, 150)
  assert.equal(s.totals.all.total, 450)
  assert.equal(s.totals.all.cost, 0.03)
})

test('summarize: bySource groups and sorts by tokens desc', () => {
  const s = summarize([
    entry({ source: 'agent-1', total_tokens: 100 }),
    entry({ source: 'pm-agent', total_tokens: 500 }),
    entry({ source: 'agent-1', total_tokens: 50 })
  ])
  assert.equal(s.bySource[0].source, 'pm-agent')
  assert.equal(s.bySource[0].totals.total, 500)
  assert.equal(s.bySource[1].source, 'agent-1')
  assert.equal(s.bySource[1].totals.total, 150)
})

test('summarize: byModel groups and sorts', () => {
  const s = summarize([
    entry({ model: 'anthropic/claude-haiku-4-5', total_tokens: 100 }),
    entry({ model: 'ollama/llama3.2:3b', total_tokens: 500 })
  ])
  assert.equal(s.byModel[0].model, 'ollama/llama3.2:3b')
  assert.equal(s.byModel[1].model, 'anthropic/claude-haiku-4-5')
})

test('summarize: today totals only include today\'s entries', () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()
  const s = summarize([
    entry({ timestamp: yesterday, total_tokens: 100 }),
    entry({ timestamp: now, total_tokens: 50 })
  ])
  assert.equal(s.totals.today.total, 50)
  assert.equal(s.totals.all.total, 150)
})

test('summarize: byDay entries grouped by date', () => {
  const s = summarize([
    entry({ timestamp: '2026-01-15T10:00:00Z', total_tokens: 100 }),
    entry({ timestamp: '2026-01-15T20:00:00Z', total_tokens: 50 }),
    entry({ timestamp: '2026-01-16T05:00:00Z', total_tokens: 200 })
  ])
  const jan15 = s.byDay.find(d => d.date === '2026-01-15')
  const jan16 = s.byDay.find(d => d.date === '2026-01-16')
  assert.equal(jan15?.totals.total, 150)
  assert.equal(jan16?.totals.total, 200)
})
