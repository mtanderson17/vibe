import { useEffect, useState } from 'react'
import type { Config } from '../types'
import ModelChainPicker from './ModelChainPicker'

export default function ModelOverrideEditor({ agentId, current, disabled }: { agentId: string; current: string; disabled: boolean }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(current)
  const [config, setConfig] = useState<Config | null>(null)

  useEffect(() => { setValue(current) }, [current])
  useEffect(() => {
    if (editing && !config) {
      window.vibe.config.get().then(setConfig)
    }
  }, [editing, config])

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        disabled={disabled}
        style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px dashed var(--border-2)', color: 'var(--fg-dim)' }}
        title="Override the global model for just this agent"
      >
        {current ? 'change model' : '+ model override'}
      </button>
    )
  }

  async function save() {
    const trimmed = value.trim()
    await window.vibe.agents.setModel(agentId, trimmed || null)
    setEditing(false)
  }

  return (
    <div className="agent-model-editor">
      <div className="agent-model-editor-header">
        <strong style={{ fontSize: 13 }}>Model for {agentId}</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => { setValue(current); setEditing(false) }}>Cancel</button>
          <button className="primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={save}>Save</button>
        </div>
      </div>
      {config ? (
        <ModelChainPicker value={value} onChange={setValue} config={config} compact />
      ) : (
        <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>Loading providers…</div>
      )}
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
        Empty selection = use the global default.
      </div>
    </div>
  )
}
