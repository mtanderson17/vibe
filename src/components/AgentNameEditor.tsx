import { useEffect, useState } from 'react'

export default function AgentNameEditor({ agentId, displayName }: { agentId: string; displayName?: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(displayName ?? '')

  useEffect(() => { setValue(displayName ?? '') }, [displayName])

  async function save() {
    await window.vibe.agents.setName(agentId, value.trim() || null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <strong
        onClick={() => setEditing(true)}
        style={{ cursor: 'text' }}
        title={`Click to rename · id: ${agentId}`}
      >
        {displayName || agentId}
      </strong>
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setValue(displayName ?? ''); setEditing(false) }
        }}
        onBlur={save}
        placeholder={`e.g. Researcher — leave empty to reset to "${agentId}"`}
        style={{ fontSize: 12, padding: '2px 6px', width: 220 }}
      />
    </span>
  )
}
