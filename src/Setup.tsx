import { useState } from 'react'
import type { Config } from './types'

interface Props {
  config: Config
  onSaved: (c: Config) => void
}

export default function Setup({ config, onSaved }: Props) {
  const [apiKey, setApiKey] = useState(config.openrouterApiKey ?? '')
  const [workspace, setWorkspace] = useState(config.workspacePath ?? '')
  const [model, setModel] = useState(config.model)
  const [saving, setSaving] = useState(false)

  async function pickWorkspace() {
    const p = await window.vibe.workspace.pick()
    if (p) setWorkspace(p)
  }

  async function save() {
    setSaving(true)
    const next = await window.vibe.config.set({
      openrouterApiKey: apiKey.trim() || null,
      workspacePath: workspace.trim() || null,
      model
    })
    setSaving(false)
    onSaved(next)
  }

  const ready = apiKey.trim() && workspace.trim()

  return (
    <div className="setup">
      <h1>Welcome to Vibe</h1>
      <p>A command center for agent-driven development. Set two things and go.</p>

      <div className="field">
        <label>OpenRouter API key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-or-v1-..."
        />
        <p style={{ fontSize: 11, marginTop: 4 }}>
          Free at openrouter.ai — no credit card required for free-tier models.
        </p>
      </div>

      <div className="field">
        <label>Workspace folder</label>
        <div className="row">
          <input value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="C:\path\to\your\project" />
          <button onClick={pickWorkspace}>Browse…</button>
        </div>
        <p style={{ fontSize: 11, marginTop: 4 }}>
          A git repo will be initialized here if one doesn't exist.
        </p>
      </div>

      <div className="field">
        <label>Default model (OpenRouter slug)</label>
        <input
          type="text"
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="openrouter/free,minimax/minimax-m3:free"
        />
        <p style={{ fontSize: 11, marginTop: 4 }}>
          Default tries <code>openrouter/free</code> first, falls back to <code>minimax/minimax-m3:free</code> if
          unavailable. Use a comma-separated list for fallbacks, or one slug for a fixed model
          (e.g. <code>anthropic/claude-sonnet-4</code> once you add credit).
        </p>
      </div>

      <button className="primary" onClick={save} disabled={!ready || saving} style={{ width: '100%', padding: 10 }}>
        {saving ? 'Saving…' : 'Start'}
      </button>
    </div>
  )
}
