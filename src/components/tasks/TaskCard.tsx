// One card on the kanban board (or in the PM's proposed row).
//
// Owns only its inline-edit state; every mutation goes back up to TasksView,
// which owns the task list and the refresh. `variant` decides the action row —
// a card's available actions are a function of the column it sits in.

import { useState } from 'react'
import { useSubmitKey } from '../../stores/prefs'
import type { AgentState, Task } from '../../types'

export type TaskCardVariant = 'proposed' | 'backlog' | 'in_progress' | 'awaiting_merge' | 'done'

interface Props {
  task: Task
  agents: Record<string, AgentState | undefined>
  agentIds: string[]
  variant: TaskCardVariant
  assignPickerFor: string | null
  setAssignPickerFor: (id: string | null) => void
  onRefresh: () => void
  onAssign: (taskId: string, agentId: string) => void
  onDelete: (id: string) => void
  onAcceptProposed?: (id: string) => void
  onMove: (id: string, status: string) => void
}

export default function TaskCard({
  task, agents, agentIds, variant,
  assignPickerFor, setAssignPickerFor,
  onRefresh, onAssign, onDelete, onAcceptProposed, onMove
}: Props) {
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDesc, setEditDesc] = useState(task.description ?? '')
  const submitKey = useSubmitKey()

  async function saveEdit() {
    if (!editTitle.trim()) return
    await window.vibe.tasks.update(task.id, {
      title: editTitle.trim(),
      description: editDesc.trim() || undefined
    })
    setEditing(false)
    onRefresh()
  }

  function cancelEdit() {
    setEditTitle(task.title)
    setEditDesc(task.description ?? '')
    setEditing(false)
  }

  const cardCls = `task-card ${variant === 'proposed' ? 'proposed' : ''}`
  const isProposed = variant === 'proposed'

  if (editing) {
    return (
      <div className={cardCls}>
        <input
          autoFocus
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onKeyDown={e => {
            // Both fields in this editor follow the pref — a plain Enter here
            // would otherwise submit a form whose other half needs Cmd+Enter.
            if (submitKey.isSubmit(e)) { e.preventDefault(); saveEdit() }
            if (e.key === 'Escape') cancelEdit()
          }}
          placeholder="Task title"
          style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}
        />
        <textarea
          value={editDesc}
          onChange={e => setEditDesc(e.target.value)}
          onKeyDown={e => {
            if (submitKey.isSubmit(e)) { e.preventDefault(); saveEdit() }
            if (e.key === 'Escape') cancelEdit()
          }}
          placeholder={`Optional description — sent to the agent as part of the task (${submitKey.hint}, Esc to cancel)`}
          rows={4}
          style={{ resize: 'vertical', fontSize: 12, marginBottom: 8 }}
        />
        <div className="task-card-actions">
          <button className="primary" onClick={saveEdit} disabled={!editTitle.trim()}>Save</button>
          <button onClick={cancelEdit}>Cancel</button>
        </div>
      </div>
    )
  }

  const assignedAgent = task.assignedTo ? agents[task.assignedTo] : undefined

  return (
    <div className={cardCls}>
      <div className="task-card-title" onClick={() => setEditing(true)} style={{ cursor: 'text' }} title="Click to edit">
        {task.title}
      </div>
      {task.description && (
        <div className="task-card-desc" onClick={() => setEditing(true)} style={{ cursor: 'text' }} title="Click to edit">
          {task.description}
        </div>
      )}
      {!task.description && !isProposed && (
        <div
          className="task-card-desc"
          onClick={() => setEditing(true)}
          style={{ cursor: 'text', opacity: 0.4, fontStyle: 'italic' }}
        >
          + add description
        </div>
      )}
      {!isProposed && (
        <div className="task-card-meta">
          {task.assignedTo && (
            <span>
              <span className={`status-dot status-${assignedAgent?.status ?? 'idle'}`} style={{ marginRight: 4 }} />
              {assignedAgent?.displayName || task.assignedTo}
            </span>
          )}
          {task.branch && <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--accent)' }}>{task.branch}</span>}
        </div>
      )}
      <div className="task-card-actions">
        {isProposed && onAcceptProposed && (
          <>
            <button className="primary" onClick={() => onAcceptProposed(task.id)}>Accept</button>
            <button onClick={() => setEditing(true)}>Edit</button>
            <button className="danger" onClick={() => onDelete(task.id)}>Dismiss</button>
          </>
        )}
        {variant === 'backlog' && (
          <>
            {assignPickerFor === task.id ? (
              <select
                autoFocus
                onChange={e => e.target.value && onAssign(task.id, e.target.value)}
                onBlur={() => setAssignPickerFor(null)}
                defaultValue=""
              >
                <option value="" disabled>Assign to…</option>
                {agentIds.map(id => {
                  const a = agents[id]
                  const s = a?.status ?? 'idle'
                  const busy = s === 'running' || s === 'awaiting_input' || s === 'awaiting_merge'
                  const label = a?.displayName ? `${a.displayName} (${id})` : id
                  return <option key={id} value={id} disabled={busy}>{label} {busy ? `· ${s}` : ''}</option>
                })}
              </select>
            ) : (
              <button className="primary" onClick={() => setAssignPickerFor(task.id)}>Assign to agent</button>
            )}
            <button onClick={() => setEditing(true)}>Edit</button>
            <button className="danger" onClick={() => onDelete(task.id)}>Delete</button>
          </>
        )}
        {(variant === 'in_progress' || variant === 'awaiting_merge') && (
          <>
            <button onClick={() => onMove(task.id, 'done')}>Mark done</button>
            <button onClick={() => setEditing(true)}>Edit</button>
            <button className="danger" onClick={() => onDelete(task.id)}>Delete</button>
          </>
        )}
        {variant === 'done' && (
          <>
            <button onClick={() => onMove(task.id, 'backlog')}>Reopen</button>
            <button onClick={() => setEditing(true)}>Edit</button>
            <button className="danger" onClick={() => onDelete(task.id)}>Delete</button>
          </>
        )}
      </div>
    </div>
  )
}
