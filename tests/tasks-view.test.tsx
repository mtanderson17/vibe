import { stubVibe, spy } from './helpers/dom'   // must come first — installs the DOM
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TasksView from '../src/TasksView'
import { useAgents } from '../src/stores/agents'
import type { AgentState, Task } from '../src/types'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'a task',
    status: 'backlog',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
}

function agent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-1', status: 'idle', task: null, branch: null,
    worktreePath: null, messages: [], ...overrides
  }
}

/** TasksView pulls its list over IPC and PmPanel subscribes on mount. */
function stubBoard(tasks: Task[], extraTasks: Record<string, unknown> = {}) {
  return stubVibe({
    tasks: {
      list: async () => tasks,
      update: async () => ({ ok: true }),
      delete: async () => ({ ok: true }),
      assignToAgent: async () => ({ ok: true }),
      ...extraTasks   // merge into the namespace, don't replace it
    },
    pm: {
      state: async () => ({ status: 'idle', lastRun: null, messages: [] }),
      run: async () => undefined,
      clear: async () => undefined,
      kill: async () => undefined
    }
  } as never)
}

function withPmEvents(restore: () => void) {
  const w = globalThis as unknown as { vibe: Record<string, unknown> }
  w.vibe.onPmEvent = () => () => {}
  return restore
}

function column(label: string) {
  // Each kanban column is the element containing its header.
  const header = screen.getByText(new RegExp(`^${label}$`))
  return header.closest('.kanban-col') as HTMLElement
}

test('tasks land in the column matching their status', async () => {
  const restore = withPmEvents(stubBoard([
    task({ id: 'a', title: 'in the backlog', status: 'backlog' }),
    task({ id: 'b', title: 'being worked', status: 'in_progress' }),
    task({ id: 'c', title: 'all finished', status: 'done' })
  ]))
  try {
    render(<TasksView agentIds={['agent-1']} />)
    await waitFor(() => assert.ok(screen.getByText('in the backlog')))

    assert.ok(within(column('Backlog')).getByText('in the backlog'))
    assert.ok(within(column('In Progress')).getByText('being worked'))
    assert.ok(within(column('Done')).getByText('all finished'))
    assert.ok(within(column('Awaiting Merge')).getByText('— empty —'))
  } finally { cleanup(); restore() }
})

test('a proposed task appears in the PM row, not in its status column', async () => {
  const restore = withPmEvents(stubBoard([
    task({ id: 'p', title: 'PM suggested this', status: 'backlog', proposed: true })
  ]))
  try {
    render(<TasksView agentIds={[]} />)
    await waitFor(() => assert.ok(screen.getByText('PM suggested this')))

    assert.match(screen.getByText(/Proposed by PM agent/).textContent ?? '', /\(1\)/)
    assert.ok(within(column('Backlog')).getByText('— empty —'),
      'a proposed task must not double up in the backlog column')
  } finally { cleanup(); restore() }
})

test('an assigned card resolves its agent through to the card', async () => {
  const restore = withPmEvents(stubBoard([
    task({ id: 'a', title: 'assigned work', status: 'in_progress', assignedTo: 'agent-2', branch: 'vibe/agent-2/x' })
  ]))
  try {
    useAgents.setState({ agents: { 'agent-2': agent({ id: 'agent-2', displayName: 'Scout', status: 'running' }) } })
    render(<TasksView agentIds={['agent-2']} />)
    await waitFor(() => assert.ok(screen.getByText('assigned work')))
    assert.ok(screen.getByText('Scout'), 'the parent resolves assignedAgent for the card')
    assert.ok(screen.getByText('vibe/agent-2/x'))
  } finally { cleanup(); restore(); useAgents.setState({ agents: {} }) }
})

test('opening the picker offers every agent, with busy ones disabled', async () => {
  const restore = withPmEvents(stubBoard([task({ id: 'a', title: 'needs an agent' })]))
  try {
    useAgents.setState({ agents: {
      'agent-1': agent({ id: 'agent-1', status: 'idle' }),
      'agent-2': agent({ id: 'agent-2', status: 'running' })
    } })
    const user = userEvent.setup()
    render(<TasksView agentIds={['agent-1', 'agent-2']} />)
    await waitFor(() => assert.ok(screen.getByText('needs an agent')))

    // No picker is open, so no card has options yet.
    assert.equal(screen.queryByRole('option'), null)

    await user.click(screen.getByRole('button', { name: 'Assign to agent' }))
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    const byValue = Object.fromEntries(options.filter(o => o.value).map(o => [o.value, o.disabled]))
    assert.equal(byValue['agent-1'], false)
    assert.equal(byValue['agent-2'], true, 'a running agent must not be assignable')
  } finally { cleanup(); restore(); useAgents.setState({ agents: {} }) }
})

test('creating a task sends the trimmed title and reloads the board', async () => {
  const create = spy({ id: 'new' })
  const restore = withPmEvents(stubBoard([], { create }))
  try {
    const user = userEvent.setup()
    render(<TasksView agentIds={[]} />)
    await waitFor(() => assert.ok(screen.getByPlaceholderText(/New task title/)))

    await user.type(screen.getByPlaceholderText(/New task title/), '  build the thing  ')
    await user.click(screen.getByRole('button', { name: 'Add task' }))

    await waitFor(() => assert.deepEqual(create.calls, [['build the thing', undefined]]))
  } finally { cleanup(); restore() }
})
