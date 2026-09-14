// Pure helpers behind the Tasks board. Kept out of the components so they can
// be tested without a DOM, and so TaskCard doesn't have to take the whole
// agents map just to render one dropdown.

import type { AgentState, Task } from '../../types'
import type { TaskCardVariant } from './TaskCard'

/** An agent is unavailable for new work while it's mid-task or mid-merge. */
const BUSY_STATUSES: ReadonlyArray<AgentState['status']> = ['running', 'awaiting_input', 'awaiting_merge']

export interface AssignOption {
  id: string
  label: string
  busy: boolean
  status: AgentState['status']
}

/** Rows for the "assign to agent" dropdown, in the order given. */
export function assignOptionsFor(
  agentIds: string[],
  agents: Record<string, AgentState | undefined>
): AssignOption[] {
  return agentIds.map(id => {
    const agent = agents[id]
    const status = agent?.status ?? 'idle'
    return {
      id,
      label: agent?.displayName ? `${agent.displayName} (${id})` : id,
      busy: BUSY_STATUSES.includes(status),
      status
    }
  })
}

export type TaskColumns = Record<TaskCardVariant, Task[]>

/**
 * Split the task list into the proposed row and one bucket per kanban column,
 * in a single pass. Previously each column re-filtered the whole array on every
 * render, including on every keystroke in the new-task box.
 */
export function partitionTasks(tasks: Task[], columns: TaskCardVariant[]): TaskColumns {
  const out = { proposed: [] as Task[] } as TaskColumns
  for (const col of columns) out[col] = []

  for (const task of tasks) {
    if (task.proposed) {
      out.proposed.push(task)
      continue
    }
    const bucket = out[task.status as TaskCardVariant]
    // A status we don't have a column for (hand-edited tasks.json, or a status
    // added later) is dropped rather than crashing the board.
    if (bucket) bucket.push(task)
  }
  return out
}
