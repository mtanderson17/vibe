import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignOptionsFor, partitionTasks } from '../src/components/tasks/assign'
import type { AgentState, Task } from '../src/types'

const COLUMNS = ['backlog', 'in_progress', 'awaiting_merge', 'done'] as const

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: Math.random().toString(36).slice(2),
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

test('partitionTasks splits the board in one pass', () => {
  const tasks = [
    task({ id: 'a', status: 'backlog' }),
    task({ id: 'b', status: 'in_progress' }),
    task({ id: 'c', status: 'done' }),
    task({ id: 'd', status: 'backlog' }),
    task({ id: 'e', status: 'awaiting_merge' })
  ]
  const cols = partitionTasks(tasks, [...COLUMNS])
  assert.deepEqual(cols.backlog.map(t => t.id), ['a', 'd'])
  assert.deepEqual(cols.in_progress.map(t => t.id), ['b'])
  assert.deepEqual(cols.awaiting_merge.map(t => t.id), ['e'])
  assert.deepEqual(cols.done.map(t => t.id), ['c'])
  assert.deepEqual(cols.proposed, [])
})

test('partitionTasks routes proposed tasks out of their status column', () => {
  const tasks = [
    task({ id: 'p', status: 'backlog', proposed: true }),
    task({ id: 'n', status: 'backlog' })
  ]
  const cols = partitionTasks(tasks, [...COLUMNS])
  assert.deepEqual(cols.proposed.map(t => t.id), ['p'])
  assert.deepEqual(cols.backlog.map(t => t.id), ['n'],
    'a proposed task must not also appear in its status column')
})

test('partitionTasks preserves order within a column', () => {
  const tasks = [task({ id: '1' }), task({ id: '2' }), task({ id: '3' })]
  assert.deepEqual(partitionTasks(tasks, [...COLUMNS]).backlog.map(t => t.id), ['1', '2', '3'])
})

test('partitionTasks drops an unknown status rather than throwing', () => {
  // tasks.json is a plain file in the user's repo and can be hand-edited.
  const cols = partitionTasks([task({ id: 'x', status: 'nonsense' })], [...COLUMNS])
  for (const col of COLUMNS) assert.deepEqual(cols[col], [])
  assert.deepEqual(cols.proposed, [])
})

test('partitionTasks returns an empty bucket for every column, even with no tasks', () => {
  const cols = partitionTasks([], [...COLUMNS])
  for (const col of COLUMNS) assert.deepEqual(cols[col], [], `${col} should exist and be empty`)
})

test('assignOptionsFor marks busy agents and labels them', () => {
  const opts = assignOptionsFor(['agent-1', 'agent-2', 'agent-3', 'agent-4'], {
    'agent-1': agent({ id: 'agent-1', status: 'idle', displayName: 'Scout' }),
    'agent-2': agent({ id: 'agent-2', status: 'running' }),
    'agent-3': agent({ id: 'agent-3', status: 'awaiting_merge' }),
    'agent-4': agent({ id: 'agent-4', status: 'error' })
  })
  assert.deepEqual(opts.map(o => [o.id, o.busy]), [
    ['agent-1', false],
    ['agent-2', true],
    ['agent-3', true],
    ['agent-4', false]   // errored is idle-ish: it can take new work
  ])
  assert.equal(opts[0].label, 'Scout (agent-1)', 'a named agent shows both name and id')
  assert.equal(opts[1].label, 'agent-2', 'an unnamed agent falls back to its id')
})

test('assignOptionsFor treats an unknown agent as idle rather than crashing', () => {
  const opts = assignOptionsFor(['ghost'], {})
  assert.deepEqual(opts, [{ id: 'ghost', label: 'ghost', busy: false, status: 'idle' }])
})

test('assignOptionsFor keeps the order it was given', () => {
  const opts = assignOptionsFor(['agent-3', 'agent-1', 'agent-2'], {})
  assert.deepEqual(opts.map(o => o.id), ['agent-3', 'agent-1', 'agent-2'])
})
