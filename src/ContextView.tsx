import { useEffect, useState } from 'react'

export default function ContextView() {
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.vibe.context.read().then(setContent)
  }, [])

  async function save() {
    setSaving(true)
    await window.vibe.context.write(content)
    setDirty(false)
    setSaving(false)
  }

  return (
    <div className="context-view">
      <div className="header">
        <div>
          <div style={{ fontWeight: 600 }}>Shared Project Context</div>
          <div className="path">Prepended to every agent's system prompt · .vibe/context/project.md</div>
        </div>
        <button className="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <textarea
        value={content}
        onChange={e => { setContent(e.target.value); setDirty(true) }}
      />
    </div>
  )
}
