import { useEffect, useMemo, useState } from 'react'
import { useAgents } from './stores/agents'
import type { AgentState } from './types'

interface Props { agentIds: string[] }

type Pricing = Record<string, { prompt: number; completion: number }>

// Public Anthropic pricing as of late 2025, per-token USD. Used as a fallback when
// the OpenRouter /models table doesn't include the exact anthropic/* slug that a
// BYOK-Anthropic user is running against. Update as Anthropic changes their pricing.
const ANTHROPIC_FALLBACK: Pricing = {
  'anthropic/claude-opus-4-7':      { prompt: 0.000015, completion: 0.000075 },
  'anthropic/claude-opus-4-6':      { prompt: 0.000015, completion: 0.000075 },
  'anthropic/claude-sonnet-4-6':    { prompt: 0.000003, completion: 0.000015 },
  'anthropic/claude-sonnet-4-5':    { prompt: 0.000003, completion: 0.000015 },
  'anthropic/claude-haiku-4-5':     { prompt: 0.000001, completion: 0.000005 },
  'anthropic/claude-haiku-4-5-20251001': { prompt: 0.000001, completion: 0.000005 }
}

function costOf(usage: AgentState['usage'], model: string | undefined, pricing: Pricing): number {
  if (!usage || !model) return 0
  const p = pricing[model] ?? ANTHROPIC_FALLBACK[model]
  if (!p) return 0
  return usage.prompt * p.prompt + usage.completion * p.completion
}

function fmtDollars(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(6)}`
  if (n < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export default function CostView({ agentIds }: Props) {
  const agents = useAgents(s => s.agents)
  const [pricing, setPricing] = useState<Pricing>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.vibe.models.pricing().then(p => { setPricing(p); setLoaded(true) })
  }, [])

  const rows = useMemo(() => agentIds.map(id => {
    const a = agents[id]
    if (!a) return { id, tokens: 0, cost: 0, model: '—', task: '—', status: 'idle' }
    const usage = a.usage ?? { prompt: 0, completion: 0, total: 0 }
    return {
      id,
      tokens: usage.total,
      prompt: usage.prompt,
      completion: usage.completion,
      cost: costOf(a.usage, a.pinnedModel, pricing),
      model: a.pinnedModel ?? '—',
      task: a.task ?? '—',
      status: a.status
    }
  }), [agents, agentIds, pricing])

  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0)
  const totalCost = rows.reduce((s, r) => s + r.cost, 0)
  const freeRatio = rows.filter(r => r.model.includes(':free') || r.model.startsWith('ollama/')).length / Math.max(1, rows.filter(r => r.tokens > 0).length)

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">Cost Management</div>
          <div className="screen-subtitle">
            Tokens + estimated cost per agent, current session. Pricing sourced from OpenRouter.
            {!loaded && ' (loading pricing…)'}
          </div>
        </div>
      </div>

      <div className="cost-summary">
        <div className="cost-card">
          <div className="cost-card-label">Total tokens (session)</div>
          <div className="cost-card-value">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="cost-card">
          <div className="cost-card-label">Total estimated cost</div>
          <div className="cost-card-value">{fmtDollars(totalCost)}</div>
        </div>
        <div className="cost-card">
          <div className="cost-card-label">Free-tier ratio</div>
          <div className="cost-card-value">{Math.round(freeRatio * 100)}%</div>
        </div>
      </div>

      <div className="cost-table-wrap">
        <table className="cost-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Task</th>
              <th>Model</th>
              <th style={{ textAlign: 'right' }}>Prompt tok</th>
              <th style={{ textAlign: 'right' }}>Completion tok</th>
              <th style={{ textAlign: 'right' }}>Total tok</th>
              <th style={{ textAlign: 'right' }}>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><strong>{r.id}</strong></td>
                <td><span className={`status-dot status-${r.status}`} style={{ marginRight: 6 }} />{r.status}</td>
                <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.task}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.model}</td>
                <td style={{ textAlign: 'right' }}>{(r.prompt ?? 0).toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{(r.completion ?? 0).toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{r.tokens.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{r.model.includes(':free') || r.model.startsWith('ollama/') ? 'free' : fmtDollars(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '10px 20px', fontSize: 11, color: 'var(--fg-dim)' }}>
        Notes: cost is estimated from OpenRouter published pricing at the time of load.
        Local Ollama models are always $0. Free-tier models are $0 but subject to daily limits.
        Session totals reset when an agent starts a new task.
      </div>
    </div>
  )
}
