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
    await window.vibe.tasks.create(newTitle.trim())
    setNewTitle('')
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
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create() }}
            placeholder="New task title…"
            style={{ width: 300 }}
          />
          <button className="primary" onClick={create} disabled={!newTitle.trim()}>Add task</button>
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
              <div key={t.id} className="task-card proposed">
                <div className="task-card-title">{t.title}</div>
                {t.description && <div className="task-card-desc">{t.description}</div>}
                <div className="task-card-actions">
                  <button className="primary" onClick={() => acceptProposed(t.id)}>Accept</button>
                  <button className="danger" onClick={() => del(t.id)}>Dismiss</button>
                </div>
              </div>
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
                  <div key={t.id} className="task-card">
                    <div className="task-card-title">{t.title}</div>
                    {t.description && <div className="task-card-desc">{t.description}</div>}
                    <div className="task-card-meta">
                      {t.assignedTo && (
                        <span>
                          <span className={`status-dot status-${agents[t.assignedTo]?.status ?? 'idle'}`} style={{ marginRight: 4 }} />
                          {t.assignedTo}
                        </span>
                      )}
                      {t.branch && <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--accent)' }}>{t.branch}</span>}
                    </div>
                    <div className="task-card-actions">
                      {col.key === 'backlog' && (
                        <>
                          {assignPickerFor === t.id ? (
                            <select
                              autoFocus
                              onChange={e => e.target.value && assign(t.id, e.target.value)}
                              onBlur={() => setAssignPickerFor(null)}
                              defaultValue=""
                            >
                              <option value="" disabled>Assign to…</option>
                              {agentIds.map(id => {
                                const s = agents[id]?.status ?? 'idle'
                                const busy = s === 'running' || s === 'awaiting_input' || s === 'awaiting_merge'
                                return <option key={id} value={id} disabled={busy}>{id} {busy ? `(${s})` : ''}</option>
                              })}
                            </select>
                          ) : (
                            <button onClick={() => setAssignPickerFor(t.id)}>Assign to agent</button>
                          )}
                        </>
                      )}
                      {col.key !== 'done' && col.key !== 'backlog' && (
                        <button onClick={() => moveTask(t.id, 'done')}>Mark done</button>
                      )}
                      {col.key === 'done' && (
                        <button onClick={() => moveTask(t.id, 'backlog')}>Reopen</button>
                      )}
                      <button className="danger" onClick={() => del(t.id)}>Delete</button>
                    </div>
                  </div>
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
              <button className="primary" onClick={sendToPm} disabled={!pmInput.trim() || pmState.status === 'running'}>
                Send
              </button>
              <button onClick={() => window.vibe.pm.clear()}>Clear chat</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
