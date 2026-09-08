import { useEffect, useState, useCallback } from 'react'
import type { LedgerTotals } from './types'

interface Summary {
  totals: { all: LedgerTotals; today: LedgerTotals; last7d: LedgerTotals }
  bySource: Array<{ source: string; totals: LedgerTotals }>
  byModel: Array<{ model: string; totals: LedgerTotals }>
  byDay: Array<{ date: string; totals: LedgerTotals }>
  entryCount: number
}

function fmt$(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.0001) return `$${n.toExponential(2)}`
  if (n < 0.01) return `$${n.toFixed(6)}`
  if (n < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

export default function CostView() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const s = await window.vibe.ledger.summary()
    setSummary(s)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    // Refresh whenever an agent or PM event fires (new usage → new ledger entry)
    const offAgent = window.vibe.onAgentEvent(e => {
      if (e.type === 'usage') setTimeout(refresh, 500)
    })
    const offPm = window.vibe.onPmEvent(e => {
      if (e.type === 'usage') setTimeout(refresh, 500)
    })
    // Also poll every 20s in case something's writing to the ledger while we're viewing
    const t = setInterval(refresh, 20000)
    return () => { offAgent(); offPm(); clearInterval(t) }
  }, [refresh])

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">Cost</div>
          <div className="screen-subtitle">
            All LLM spend recorded in <code>.vibe/cost.jsonl</code>. Persists across restarts and agent close/spawn.
          </div>
        </div>
        <button onClick={refresh}>Refresh</button>
      </div>

      {loading && <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>}

      {!loading && summary && summary.entryCount === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-dim)' }}>
          No LLM calls yet. Spin up an agent and give it a task to start tracking cost.
        </div>
      )}

      {!loading && summary && summary.entryCount > 0 && (
        <>
          <div className="cost-summary">
            <SummaryCard label="Today" totals={summary.totals.today} />
            <SummaryCard label="Last 7 days" totals={summary.totals.last7d} />
            <SummaryCard label="All time" totals={summary.totals.all} />
          </div>

          <div className="cost-section">
            <div className="cost-section-title">By source</div>
            <table className="cost-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th style={{ textAlign: 'right' }}>Requests share</th>
                  <th style={{ textAlign: 'right' }}>Tokens</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.bySource.map(row => (
                  <tr key={row.source}>
                    <td><strong>{row.source}</strong></td>
                    <td style={{ textAlign: 'right' }}>
                      {Math.round(100 * row.totals.total / Math.max(1, summary.totals.all.total))}%
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(row.totals.total)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt$(row.totals.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cost-section">
            <div className="cost-section-title">By model</div>
            <table className="cost-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th style={{ textAlign: 'right' }}>Prompt tokens</th>
                  <th style={{ textAlign: 'right' }}>Completion tokens</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byModel.map(row => (
                  <tr key={row.model}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.model}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(row.totals.prompt)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(row.totals.completion)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(row.totals.total)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.model.startsWith('ollama/') || row.model.includes(':free') ? 'free' : fmt$(row.totals.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary.byDay.length > 0 && (
            <div className="cost-section">
              <div className="cost-section-title">Daily (last {summary.byDay.length} days)</div>
              <DailyChart data={summary.byDay} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, totals }: { label: string; totals: LedgerTotals }) {
  return (
    <div className="cost-card">
      <div className="cost-card-label">{label}</div>
      <div className="cost-card-value">{fmt$(totals.cost)}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 4 }}>
        {fmtNum(totals.total)} tokens
      </div>
    </div>
  )
}

function DailyChart({ data }: { data: Array<{ date: string; totals: LedgerTotals }> }) {
  const maxCost = Math.max(...data.map(d => d.totals.cost), 0.0001)
  return (
    <div className="daily-chart">
      {data.map(d => {
        const heightPct = (d.totals.cost / maxCost) * 100
        return (
          <div key={d.date} className="daily-bar-wrap" title={`${d.date}: ${fmt$(d.totals.cost)} · ${fmtNum(d.totals.total)} tokens`}>
            <div className="daily-bar" style={{ height: `${Math.max(2, heightPct)}%` }} />
            <div className="daily-label">{d.date.slice(5)}</div>
          </div>
        )
      })}
    </div>
  )
}
