import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadTasks, createTask, updateTask, deleteTask } from '../electron/main/tasks'

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibe-tasks-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('loadTasks returns [] for fresh workspace', async () => {
  const { dir, cleanup } = scratch()
  try {
    const tasks = await loadTasks(dir)
    assert.deepEqual(tasks, [])
  } finally { cleanup() }
})

test('createTask persists title, description, defaults', async () => {
  const { dir, cleanup } = scratch()
  try {
    const created = await createTask(dir, 'test title', 'test desc')
    assert.equal(created.title, 'test title')
    assert.equal(created.description, 'test desc')
    assert.equal(created.status, 'backlog')
    assert.equal(created.proposed, false)
    assert.equal(created.assignedTo, null)
    assert.match(created.id, /^task-/)

    const tasks = await loadTasks(dir)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].id, created.id)
  } finally { cleanup() }
})

test('createTask with proposed flag preserves proposedBy', async () => {
  const { dir, cleanup } = scratch()
  try {
    await createTask(dir, 'x', undefined, { proposed: true, proposedBy: 'pm-agent' })
    const [t] = await loadTasks(dir)
    assert.equal(t.proposed, true)
    assert.equal(t.proposedBy, 'pm-agent')
  } finally { cleanup() }
})

test('updateTask patches fields and updates updatedAt', async () => {
  const { dir, cleanup } = scratch()
  try {
    const t = await createTask(dir, 'x')
    const originalUpdatedAt = t.updatedAt
    await new Promise(r => setTimeout(r, 5))
    const patched = await updateTask(dir, t.id, { status: 'in_progress', assignedTo: 'agent-1' })
    assert.ok(patched)
    assert.equal(patched!.status, 'in_progress')
    assert.equal(patched!.assignedTo, 'agent-1')
    assert.notEqual(patched!.updatedAt, originalUpdatedAt)
  } finally { cleanup() }
})

test('updateTask returns null for unknown id', async () => {
  const { dir, cleanup } = scratch()
  try {
    const result = await updateTask(dir, 'task-does-not-exist', { status: 'done' })
    assert.equal(result, null)
  } finally { cleanup() }
})

test('deleteTask removes only the target', async () => {
  const { dir, cleanup } = scratch()
  try {
    const a = await createTask(dir, 'a')
    await createTask(dir, 'b')
    await deleteTask(dir, a.id)
    const remaining = await loadTasks(dir)
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].title, 'b')
  } finally { cleanup() }
})

test('createTask generates unique IDs even in tight loops', async () => {
  const { dir, cleanup } = scratch()
  try {
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const t = await createTask(dir, `task-${i}`)
      ids.add(t.id)
    }
    assert.equal(ids.size, 20)
  } finally { cleanup() }
})
