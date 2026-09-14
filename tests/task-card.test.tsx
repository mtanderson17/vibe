import { stubVibe, spy } from './helpers/dom'   // must come first — installs the DOM
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TaskCard, { type TaskCardVariant } from '../src/components/tasks/TaskCard'
import { assignOptionsFor } from '../src/components/tasks/assign'
import { usePrefs } from '../src/stores/prefs'
import type { AgentState, Task } from '../src/types'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Ship the thing',
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

function mount(variant: TaskCardVariant, t: Task, extra: Record<string, unknown> = {}) {
  const noop = () => {}
  return render(
    <TaskCard
      task={t}
      variant={variant}
      agents={{}}
      agentIds={[]}
      pickerOpen={false}
      onOpenPicker={noop}
      onRefresh={noop}
      onAssign={noop}
      onDelete={noop}
      onMove={noop}
      {...extra}
    />
  )
}

function buttonLabels() {
  return screen.getAllByRole('button').map(b => b.textContent)
}

test('each variant offers the actions that make sense for its column', () => {
  const restore = stubVibe({})
  try {
    mount('backlog', task())
    assert.deepEqual(buttonLabels(), ['Assign to agent', 'Edit', 'Delete'])
    cleanup()

    mount('in_progress', task({ status: 'in_progress' }))
    assert.deepEqual(buttonLabels(), ['Mark done', 'Edit', 'Delete'])
    cleanup()

    mount('awaiting_merge', task({ status: 'awaiting_merge' }))
    assert.deepEqual(buttonLabels(), ['Mark done', 'Edit', 'Delete'])
    cleanup()

    mount('done', task({ status: 'done' }))
    assert.deepEqual(buttonLabels(), ['Reopen', 'Edit', 'Delete'])
    cleanup()

    mount('proposed', task({ proposed: true }), { onAcceptProposed: () => {} })
    assert.deepEqual(buttonLabels(), ['Accept', 'Edit', 'Dismiss'])
  } finally { cleanup(); restore() }
})

test('Mark done and Reopen move the task to the right column', async () => {
  const restore = stubVibe({})
  try {
    const user = userEvent.setup()
    const moves: Array<[string, string]> = []
    const onMove = (id: string, status: string) => { moves.push([id, status]) }

    mount('in_progress', task({ status: 'in_progress' }), { onMove })
    await user.click(screen.getByRole('button', { name: 'Mark done' }))
    cleanup()

    mount('done', task({ status: 'done' }), { onMove })
    await user.click(screen.getByRole('button', { name: 'Reopen' }))

    assert.deepEqual(moves, [['task-1', 'done'], ['task-1', 'backlog']])
  } finally { cleanup(); restore() }
})

test('a proposed card hides assignment metadata and the add-description affordance', () => {
  const restore = stubVibe({})
  try {
    mount('proposed', task({ proposed: true, assignedTo: 'agent-1', branch: 'vibe/agent-1' }), {
      assignedAgent: agent({ displayName: 'Scout' }),
      onAcceptProposed: () => {}
    })
    assert.equal(screen.queryByText('+ add description'), null)
    assert.equal(screen.queryByText('vibe/agent-1'), null, 'a proposed task has no branch yet')
    assert.equal(screen.queryByText('Scout'), null)
  } finally { cleanup(); restore() }
})

test('an assigned card shows the agent display name and branch', () => {
  const restore = stubVibe({})
  try {
    mount('in_progress', task({ status: 'in_progress', assignedTo: 'agent-1', branch: 'vibe/agent-1' }), {
      assignedAgent: agent({ displayName: 'Scout', status: 'running' })
    })
    assert.ok(screen.getByText('Scout'))
    assert.ok(screen.getByText('vibe/agent-1'))
  } finally { cleanup(); restore() }
})

test('an assigned card falls back to the agent id when there is no display name', () => {
  const restore = stubVibe({})
  try {
    mount('in_progress', task({ status: 'in_progress', assignedTo: 'agent-7' }), {})
    assert.ok(screen.getByText('agent-7'))
  } finally { cleanup(); restore() }
})

test('the assign picker disables agents that are already busy', () => {
  const restore = stubVibe({})
  try {
    mount('backlog', task(), {
      pickerOpen: true,
      assignOptions: assignOptionsFor(['agent-1', 'agent-2'], {
        'agent-1': agent({ id: 'agent-1', status: 'idle' }),
        'agent-2': agent({ id: 'agent-2', status: 'running' })
      })
    })
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    const byValue = Object.fromEntries(options.map(o => [o.value, o.disabled]))
    assert.equal(byValue['agent-1'], false)
    assert.equal(byValue['agent-2'], true, 'a running agent must not be assignable')
  } finally { cleanup(); restore() }
})

test('clicking the title opens the inline editor and saving writes both fields', async () => {
  const update = spy({ ok: true })
  const restore = stubVibe({ tasks: { update } })
  try {
    usePrefs.setState({ submitOnEnter: true })
    const user = userEvent.setup()
    let refreshed = 0
    mount('backlog', task({ description: 'old body' }), { onRefresh: () => { refreshed++ } })

    await user.click(screen.getByText('Ship the thing'))
    const title = screen.getByPlaceholderText('Task title')
    await user.clear(title)
    await user.type(title, '  New title  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => assert.deepEqual(update.calls, [['task-1', { title: 'New title', description: 'old body' }]]))
    assert.equal(refreshed, 1)
  } finally { cleanup(); restore() }
})

test('Escape cancels an edit and restores the original text', async () => {
  const update = spy({ ok: true })
  const restore = stubVibe({ tasks: { update } })
  try {
    const user = userEvent.setup()
    mount('backlog', task({ description: 'old body' }))

    await user.click(screen.getByText('Ship the thing'))
    await user.type(screen.getByPlaceholderText('Task title'), ' scribble')
    await user.keyboard('{Escape}')

    assert.ok(screen.getByText('Ship the thing'), 'card should show the original title again')
    assert.equal(update.calls.length, 0)
  } finally { cleanup(); restore() }
})

test('the editor refuses to save a blank title', async () => {
  const update = spy({ ok: true })
  const restore = stubVibe({ tasks: { update } })
  try {
    const user = userEvent.setup()
    mount('backlog', task())

    await user.click(screen.getByText('Ship the thing'))
    await user.clear(screen.getByPlaceholderText('Task title'))
    assert.equal((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled, true)
    await user.keyboard('{Enter}')
    assert.equal(update.calls.length, 0)
  } finally { cleanup(); restore() }
})

test('the editor title field follows the submitOnEnter preference', async () => {
  const update = spy({ ok: true })
  const restore = stubVibe({ tasks: { update } })
  try {
    usePrefs.setState({ submitOnEnter: false })
    const user = userEvent.setup()
    mount('backlog', task())

    await user.click(screen.getByText('Ship the thing'))
    const title = screen.getByPlaceholderText('Task title')
    await user.type(title, '{Enter}')
    assert.equal(update.calls.length, 0, 'plain Enter must not save when the pref is off')

    await user.type(title, '{Control>}{Enter}{/Control}')
    await waitFor(() => assert.equal(update.calls.length, 1))
  } finally { cleanup(); restore(); usePrefs.setState({ submitOnEnter: true }) }
})
