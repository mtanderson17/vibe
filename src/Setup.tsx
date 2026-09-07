import { useEffect, useState } from 'react'
import type { Config } from './types'

interface Props {
  config: Config
  onSaved: (c: Config) => void
}

interface ProbeResult {
  slug: string
  status: 'ok' | 'rate_limited' | 'paid_only' | 'unavailable' | 'error'
  message?: string
  contextLength?: number
}

interface OllamaState {
  available: boolean
  baseUrl: string
  models: Array<{ name: string }>
}

const STATUS_LABELS: Record<ProbeResult['status'], { text: string; color: string; icon: string }> = {
  ok:            { text: 'available',    color: 'var(--green)',   icon: '✓' },
  rate_limited:  { text: 'rate limited', color: 'var(--yellow)',  icon: '⏱' },
  paid_only:     { text: 'paid only',    color: 'var(--fg-dim)',  icon: '$' },
  unavailable:   { text: 'unavailable',  color: 'var(--fg-dim)',  icon: '·' },
  error:         { text: 'error',        color: 'var(--red)',     icon: '✗' }
}

export default function Setup({ config, onSaved }: Props) {
  const [apiKey, setApiKey] = useState(config.openrouterApiKey ?? '')
  const [workspace, setWorkspace] = useState(config.workspacePath ?? '')
  const [model, setModel] = useState(config.model)
  const [agentCount, setAgentCount] = useState(config.agentCount ?? 4)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([])
  const [ollama, setOllama] = useState<OllamaState | null>(null)

  // Detect Ollama on mount — no key needed
  useEffect(() => {
    window.vibe.probe.ollama().then(r => setOllama(r as OllamaState))
  }, [])

  async function pickWorkspace() {
    const p = await window.vibe.workspace.pick()
    if (p) setWorkspace(p)
  }

  async function probe() {
    if (!apiKey.trim()) return
    setProbing(true)
    setProbeResults([])
    try {
      const results = await window.vibe.probe.openrouter(apiKey.trim())
      setProbeResults(results)
      // Auto-select the first working model if the current selection isn't in the OK set
      const working = results.filter(r => r.status === 'ok')
      const currentSlugs = model.split(',').map(s => s.trim())
      const currentIsWorking = currentSlugs.some(s => working.find(w => w.slug === s))
      if (working.length && !currentIsWorking) {
        // Build a fallback chain: first working + others as backups
        setModel(working.slice(0, 3).map(w => w.slug).join(','))
      }
    } finally {
      setProbing(false)
    }
  }

  async function save() {
    setSaving(true)
    const next = await window.vibe.config.set({
      openrouterApiKey: apiKey.trim() || null,
      workspacePath: workspace.trim() || null,
      model,
      agentCount: Math.max(1, Math.min(8, agentCount))
    })
    setSaving(false)
    onSaved(next)
  }

  const ready = (apiKey.trim() || ollama?.available) && workspace.trim() && model.trim()

  return (
    <div className="setup">
      <h1>Welcome to Vibe.</h1>
      <p>A command center for agent-driven development. Free forever, open source. Two minutes to set up.</p>

      {ollama?.available && ollama.models.length > 0 && (
        <div className="setup-callout">
          <strong>Ollama detected</strong> at {ollama.baseUrl} · {ollama.models.length} model{ollama.models.length !== 1 ? 's' : ''} available.
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ollama.models.slice(0, 6).map(m => (
              <button
                key={m.name}
                onClick={() => setModel(`ollama/${m.name}`)}
                style={{ fontSize: 11, padding: '3px 8px' }}
              >
                Use {m.name}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, marginTop: 6, marginBottom: 0, opacity: 0.7 }}>
            Click a model to use it directly (no API key required). Choose one that supports tool-calling
            (e.g. llama3.1, llama3.2, qwen2.5-coder) for best results.
          </p>
        </div>
      )}

      <div className="field">
        <label>OpenRouter API key</label>
        <div className="row">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-or-v1-..."
          />
          <button onClick={probe} disabled={!apiKey.trim() || probing}>
            {probing ? 'Testing…' : 'Test free models'}
          </button>
        </div>
        <p style={{ fontSize: 11, marginTop: 4 }}>
          Free at <span style={{ color: 'var(--accent)' }}>openrouter.ai</span> — no credit card required.
        </p>
      </div>

      {probeResults.length > 0 && (
        <div className="field">
          <label>Free-tier models (tested against your key)</label>
          <div className="probe-list">
            {probeResults.map(r => {
              const meta = STATUS_LABELS[r.status]
              const selected = model.split(',').map(s => s.trim()).includes(r.slug)
              return (
                <div
                  key={r.slug}
                  className={`probe-row ${selected ? 'selected' : ''} ${r.status === 'ok' ? 'clickable' : 'dim'}`}
                  onClick={() => {
                    if (r.status !== 'ok') return
                    // Toggle in the comma-separated list, first entry becomes primary
                    const list = model.split(',').map(s => s.trim()).filter(Boolean)
                    const next = list.includes(r.slug)
                      ? list.filter(s => s !== r.slug)
                      : [r.slug, ...list]
                    setModel(next.join(','))
                  }}
                >
                  <span style={{ color: meta.color, width: 14 }}>{meta.icon}</span>
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{r.slug}</span>
                  {r.contextLength && (
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{(r.contextLength / 1000).toFixed(0)}k ctx</span>
                  )}
                  <span style={{ fontSize: 10, color: meta.color }}>{meta.text}</span>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: 11, marginTop: 4 }}>
            Click ✓ models to build a fallback chain. First entry is the primary.
          </p>
        </div>
      )}

      <div className="field">
        <label>Model (or fallback chain — comma separated)</label>
        <input
          type="text"
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="e.g. openrouter/free,meta-llama/llama-3.3-70b-instruct:free"
        />
      </div>

      <div className="field">
        <label>Concurrent agents (1-8)</label>
        <input
          type="number"
          min={1}
          max={8}
          value={agentCount}
          onChange={e => setAgentCount(parseInt(e.target.value) || 1)}
        />
        <p style={{ fontSize: 11, marginTop: 4 }}>
          More agents = more parallelism but more RAM and API load. 4 is a good starting point.
        </p>
      </div>

      <div className="field">
        <label>Workspace folder</label>
        <div className="row">
          <input value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="C:\path\to\your\project" />
          <button onClick={pickWorkspace}>Browse…</button>
        </div>
        <p style={{ fontSize: 11, marginTop: 4 }}>
          A git repo + sensible <code>.gitignore</code> will be initialized here if one doesn't exist.
        </p>
      </div>

      <button className="primary" onClick={save} disabled={!ready || saving} style={{ width: '100%', padding: 10 }}>
        {saving ? 'Saving…' : 'Start'}
      </button>
    </div>
  )
}
