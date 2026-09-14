// Popup for creating a task with title + description in one shot. Triggered
// by the "new-task" keybinding (default Cmd/Ctrl+Shift+T) or the File menu.
//
// Autofocuses the title. Tab moves to description. Submit key follows the
// user's submitOnEnter preference. Esc cancels.

import { useEffect, useRef, useState } from 'react'
import { useSubmitKey } from '../stores/prefs'

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  /** False when no project is open — tasks.create() would throw "No workspace". */
  hasWorkspace: boolean
}

export default function NewTaskModal({ open, onClose, onCreated, hasWorkspace }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const submitKey = useSubmitKey()

  // Reset + focus on open
  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setError(null)
      setSaving(false)
      // Focus after paint
      setTimeout(() => titleRef.current?.focus(), 20)
    }
  }, [open])

  // Esc to close, even when focus is in a field
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function submit() {
    if (!title.trim() || !hasWorkspace) return
    setSaving(true)
    setError(null)
    try {
      await window.vibe.tasks.create(title.trim(), description.trim() || undefined)
      onCreated?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="new-task-modal" onClick={e => e.stopPropagation()}>
        <div className="new-task-header">
          <strong>New task</strong>
          <button onClick={onClose} style={{ fontSize: 11, padding: '3px 10px' }}>Close</button>
        </div>
        <div className="new-task-body">
          {!hasWorkspace && (
            <div className="new-task-error">
              Open a project first — tasks live in the project’s <code>.vibe/tasks.json</code>.
            </div>
          )}
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (submitKey.isSubmit(e)) { e.preventDefault(); submit() }
            }}
            placeholder="Task title…"
            className="new-task-title"
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => {
              if (submitKey.isSubmit(e)) { e.preventDefault(); submit() }
            }}
            placeholder={`Describe the task — what should the agent do? what are the constraints? (${submitKey.hint})`}
            rows={8}
            className="new-task-desc"
          />
          {error && <div className="new-task-error">{error}</div>}
        </div>
        <div className="new-task-footer">
          <div className="new-task-hint">{submitKey.hint} · Esc to cancel</div>
          <button
            className="primary"
            onClick={submit}
            disabled={!title.trim() || saving || !hasWorkspace}
          >
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  )
}
