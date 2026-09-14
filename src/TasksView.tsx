// The Tasks screen: a kanban board over the workspace's .vibe/tasks.json,
// plus the PM agent's proposed-task row and its chat drawer.
//
// This component owns the task list and every mutation of it; TaskCard and
// PmPanel are presentational-ish children that call back up here to refresh.

import { useEffect, useState, useCallback } from 'react'
import { useAgents } from './stores/agents'
import { useSubmitKey } from './stores/prefs'
import TaskCard, { type TaskCardVariant } from './components/tasks/TaskCard'
import PmPanel from './components/tasks/PmPanel'
import type { Task } from './types'

interface Props { agentIds: string[] }

const COLUMNS: Array<{ key: TaskCardVariant; label: string }> = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'awaiting_merge', label: 'Awaiting Merge' },
  { key: 'done', label: 'Done' }
]

export default function TasksView({ agentIds }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [showDescription, setShowDescription] = useState(false)
  const submitKey = useSubmitKey()
  const [assignPickerFor, setAssignPickerFor] = useState<string | null>(null)
  const agents = useAgents(s => s.agents)

  const refresh = useCallback(async () => {
    setTasks(await window.vibe.tasks.list())
  }, [])

  useEffect(() => { refresh() }, [refresh])

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

  const proposed = tasks.filter(t => t.proposed)

  // Shared by the proposed row and every kanban column.
  const cardProps = {
    agents, agentIds, assignPickerFor, setAssignPickerFor,
    onRefresh: refresh, onAssign: assign, onDelete: del, onMove: moveTask
  }

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
                // Single-line input: always submit on plain Enter regardless of pref
                if (e.key === 'Enter' && !e.shiftKey) create()
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
                if (submitKey.isSubmit(e)) { e.preventDefault(); create() }
                if (e.key === 'Escape') { setShowDescription(false); setNewDescription('') }
              }}
              placeholder={`Optional description — sent to the agent as part of the task (${submitKey.hint}, Esc to hide)`}
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
                variant="proposed"
                onAcceptProposed={acceptProposed}
                {...cardProps}
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
                  <TaskCard key={t.id} task={t} variant={col.key} {...cardProps} />
                ))}
                {colTasks.length === 0 && <div className="kanban-empty">— empty —</div>}
              </div>
            </div>
          )
        })}
      </div>

      <PmPanel onTasksChanged={refresh} />
    </div>
  )
}
