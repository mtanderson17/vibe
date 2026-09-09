import { useEffect, useState, useCallback, useRef } from 'react'
import { useAgents } from './stores/agents'
import type { Message } from './types'

interface Props { agentIds: string[] }

interface Task {
  id: string
  title: string
  description?: string
  status: string
  assignedTo?: string | null
  branch?: string | null
  proposed?: boolean
  proposedBy?: string
  createdAt: string
  updatedAt: string
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'awaiting_merge', label: 'Awaiting Merge' },
  { key: 'done', label: 'Done' }
]

interface PmState {
  status: 'idle' | 'running' | 'error'
  lastRun: string | null
  messages: Message[]
  error?: string
  usage?: { total: number }
  pinnedModel?: string
}

export default function TasksView({ agentIds }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [showDescription, setShowDescription] = useState(false)
  const [assignPickerFor, setAssignPickerFor] = useState<string | null>(null)
  const [pmState, setPmState] = useState<PmState>({ status: 'idle', lastRun: null, messages: [] })
  const [pmInput, setPmInput] = useState('')
  const [pmPanelOpen, setPmPanelOpen] = useState(false)
  const agents = useAgents(s => s.agents)
  const pmScrollRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const list = await window.vibe.tasks.list()
    setTasks(list)
  }, [])

  const refreshPm = useCallback(async () => {
    const s = await window.vibe.pm.state()
    setPmState(s as PmState)
  }, [])

  useEffect(() => { refresh(); refreshPm() }, [refresh, refreshPm])

  useEffect(() => {
    const off = window.vibe.onPmEvent(evt => {
      if (evt.type === 'status') {
        setPmState(prev => ({ ...prev, status: evt.data as 'idle' | 'running' | 'error' }))
        if (evt.data === 'idle') refresh() // proposed tasks might have appeared
      } else if (evt.type === 'message') {
        setPmState(prev => ({ ...prev, messages: [...prev.messages, evt.data as Message] }))
      } else if (evt.type === 'usage') {
        setPmState(prev => ({ ...prev, usage: evt.data as { total: number } }))
      } else if (evt.type === 'cleared') {
        setPmState(prev => ({ ...prev, messages: [], usage: undefined }))
      }
    })
    return off
  }, [refresh])

  useEffect(() => {
    if (pmScrollRef.current) pmScrollRef.current.scrollTop = pmScrollRef.current.scrollHeight
  }, [pmState.messages.length])

  async function create() {
    if (!newTitle.trim()) return
    await window.vibe.tasks.create(newTitle.trim(), newDescription.trim() || undefined)
    setNewTitle('')
    setNewDescription('')
    setShowDescription(false)
    refresh()
  }

  async function moveTask(id: string, status: string) {
    await window.vibe.tasks.update(id, { status })
    refresh()
  }

  async function del(id: string) {
    await window.vibe.tasks.delete(id)
    refresh()
  }

  async function assign(taskId: string, agentId: string) {
    setAssignPickerFor(null)
    await window.vibe.tasks.assignToAgent(taskId, agentId)
    refresh()
  }

  async function acceptProposed(id: string) {
    await window.vibe.tasks.update(id, { proposed: false })
    refresh()
  }

  async function sendToPm() {
    if (!pmInput.trim() || pmState.status === 'running') return
    const text = pmInput.trim()
    setPmInput('')
    setPmPanelOpen(true)
    await window.vibe.pm.run('chat', text)
  }

  const proposed = tasks.filter(t => t.proposed)

  return (
    <div className="screen tasks-screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">Tasks</div>
          <div className="screen-subtitle">Discrete work items · assign to an agent to start it</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 360 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !showDescription) create()
                if (e.key === 'Enter' && showDescription && (e.metaKey || e.ctrlKey)) create()
              }}
              onFocus={() => setShowDescription(true)}
              placeholder="New task title…"
              style={{ flex: 1 }}
            />
            <button className="primary" onClick={create} disabled={!newTitle.trim()}>Add task</button>
          </div>
          {showDescription && (
            <textarea
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create()
                if (e.key === 'Escape') { setShowDescription(false); setNewDescription('') }
              }}
              placeholder="Optional description — this gets sent to the agent as part of the task (Cmd/Ctrl+Enter to submit, Esc to hide)"
              rows={3}
              style={{ resize: 'vertical', fontSize: 12 }}
            />
          )}
        </div>
      </div>

      <div className="screen-help">
        <strong>What belongs here:</strong> specific, agent-sized units of work. One card = one focused mission
        a single agent can complete end-to-end.
        <br />
        <strong>Proposed tasks</strong> come from the PM agent — accept to move to backlog, or dismiss.
      </div>

      {proposed.length > 0 && (
        <div className="proposed-row">
          <div className="proposed-header">
            🤖 Proposed by PM agent ({proposed.length})
          </div>
          <div className="proposed-cards">
            {proposed.map(t => (
              <TaskCard
                key={t.id}
                task={t}
                agents={agents}
                agentIds={agentIds}
                variant="proposed"
                assignPickerFor={assignPickerFor}
                setAssignPickerFor={setAssignPickerFor}
                onRefresh={refresh}
                onAssign={assign}
                onDelete={del}
                onAcceptProposed={acceptProposed}
                onMove={moveTask}
              />
            ))}
          </div>
        </div>
      )}

      <div className="kanban">
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.key && !t.proposed)
          return (
            <div key={col.key} className="kanban-col">
              <div className="kanban-col-header">
                {col.label} <span style={{ opacity: 0.6 }}>({colTasks.length})</span>
              </div>
              <div className="kanban-col-body">
                {colTasks.map(t => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    agents={agents}
                    agentIds={agentIds}
                    variant={col.key as 'backlog' | 'in_progress' | 'awaiting_merge' | 'done'}
                    assignPickerFor={assignPickerFor}
                    setAssignPickerFor={setAssignPickerFor}
                    onRefresh={refresh}
                    onAssign={assign}
                    onDelete={del}
                    onMove={moveTask}
                  />
                ))}
                {colTasks.length === 0 && <div className="kanban-empty">— empty —</div>}
              </div>
            </div>
          )
        })}
      </div>

      <div className={`pm-panel ${pmPanelOpen ? 'open' : ''}`}>
        <div className="pm-panel-header" onClick={() => setPmPanelOpen(!pmPanelOpen)}>
          <span className={`status-dot status-${pmState.status === 'running' ? 'running' : pmState.status === 'error' ? 'error' : 'idle'}`} />
          <strong>PM agent</strong>
          <span style={{ opacity: 0.7, fontSize: 11 }}>
            {pmState.status === 'running' ? 'working…'
              : pmState.lastRun ? `last run ${new Date(pmState.lastRun).toLocaleTimeString()}`
              : 'idle'}
          </span>
          {pmState.usage && <span style={{ opacity: 0.7, fontSize: 11 }}>· {pmState.usage.total.toLocaleString()} tok</span>}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12 }}>{pmPanelOpen ? '▼' : '▲'}</span>
        </div>
        {pmPanelOpen && (
          <>
            <div className="pm-chat" ref={pmScrollRef}>
              {pmState.messages.filter(m => m.role !== 'system').map((m, i) => (
                <div key={i} className={`msg ${m.role}`} style={{ fontSize: 12 }}>
                  <div className="role">{m.role === 'tool' ? `tool: ${m.name}` : m.role}</div>
                  {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
                  {m.toolCalls?.map(tc => (
                    <div key={tc.id} className="toolcall">→ {tc.name}({Object.keys(tc.arguments).join(', ')})</div>
                  ))}
                </div>
              ))}
              {pmState.messages.length === 0 && (
                <div className="msg system">Ask the PM agent about the project, or trigger a summary update.</div>
              )}
            </div>
            <div className="pm-composer">
              <input
                value={pmInput}
                onChange={e => setPmInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendToPm() }}
                placeholder="Ask PM: 'add a task for X', 'what's the current state?', 'regenerate summary'…"
                disabled={pmState.status === 'running'}
              />
              {pmState.status === 'running' ? (
                <button className="danger" onClick={() => window.vibe.pm.kill()}>Stop</button>
              ) : (
                <button className="primary" onClick={sendToPm} disabled={!pmInput.trim()}>
                  Send
                </button>
              )}
              <button onClick={() => window.vibe.pm.clear()}>Clear chat</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface TaskCardProps {
  task: Task
  agents: Record<string, { status?: string } | undefined> | Record<string, unknown>
  agentIds: string[]
  variant: 'proposed' | 'backlog' | 'in_progress' | 'awaiting_merge' | 'done'
  assignPickerFor: string | null
  setAssignPickerFor: (id: string | null) => void
  onRefresh: () => void
  onAssign: (taskId: string, agentId: string) => void
  onDelete: (id: string) => void
  onAcceptProposed?: (id: string) => void
  onMove: (id: string, status: string) => void
}

function TaskCard({
  task, agents, agentIds, variant,
  assignPickerFor, setAssignPickerFor,
  onRefresh, onAssign, onDelete, onAcceptProposed, onMove
}: TaskCardProps) {
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDesc, setEditDesc] = useState(task.description ?? '')

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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit()
            if (e.key === 'Escape') cancelEdit()
          }}
          placeholder="Task title"
          style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}
        />
        <textarea
          value={editDesc}
          onChange={e => setEditDesc(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit()
            if (e.key === 'Escape') cancelEdit()
          }}
          placeholder="Optional description — sent to the agent as part of the task (Cmd/Ctrl+Enter to save, Esc to cancel)"
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
              <span
                className={`status-dot status-${((agents as Record<string, { status?: string } | undefined>)[task.assignedTo])?.status ?? 'idle'}`}
                style={{ marginRight: 4 }}
              />
              {task.assignedTo}
            </span>
          )}
          {task.branch && <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--accent)' }}>{task.branch}</span>}
        </div>
      )}
      <div className="task-card-actions">
        {variant === 'proposed' && onAcceptProposed && (
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
                  const s = ((agents as Record<string, { status?: string } | undefined>)[id])?.status ?? 'idle'
                  const busy = s === 'running' || s === 'awaiting_input' || s === 'awaiting_merge'
                  return <option key={id} value={id} disabled={busy}>{id} {busy ? `(${s})` : ''}</option>
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
