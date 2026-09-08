import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { saveAgent, loadAgents, deleteAgentFile, sanitizeHydratedAgent } from '../electron/main/persistence'
import type { AgentState } from '../electron/main/types'

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibe-persist-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-1',
    status: 'idle',
    task: null,
    branch: null,
    worktreePath: null,
    messages: [],
    ...overrides
  }
}

test('loadAgents returns [] when no persisted state exists', async () => {
  const { dir, cleanup } = scratch()
  try {
    const list = await loadAgents(dir)
    assert.deepEqual(list, [])
  } finally { cleanup() }
})

test('saveAgent and loadAgents roundtrip', async () => {
  const { dir, cleanup } = scratch()
  try {
    await saveAgent(dir, makeAgent({
      id: 'agent-2',
      status: 'awaiting_merge',
      task: 'add feature X',
      branch: 'vibe/agent-2/add-feature',
      messages: [{ role: 'user', content: 'go' }]
    }))
    const [loaded] = await loadAgents(dir)
    assert.equal(loaded.id, 'agent-2')
    assert.equal(loaded.status, 'awaiting_merge')
    assert.equal(loaded.task, 'add feature X')
    assert.equal(loaded.messages.length, 1)
  } finally { cleanup() }
})

test('saveAgent forces running → awaiting_input snapshot', async () => {
  const { dir, cleanup } = scratch()
  try {
    await saveAgent(dir, makeAgent({ status: 'running', task: 't' }))
    const [loaded] = await loadAgents(dir)
    // Running state can't survive a restart; must be rehydrated as awaiting_input
    assert.equal(loaded.status, 'awaiting_input')
  } finally { cleanup() }
})

test('loadAgents restores multiple agents in any order', async () => {
  const { dir, cleanup } = scratch()
  try {
    await saveAgent(dir, makeAgent({ id: 'agent-1' }))
    await saveAgent(dir, makeAgent({ id: 'agent-2' }))
    await saveAgent(dir, makeAgent({ id: 'agent-3' }))
    const loaded = await loadAgents(dir)
    const ids = loaded.map(a => a.id).sort()
    assert.deepEqual(ids, ['agent-1', 'agent-2', 'agent-3'])
  } finally { cleanup() }
})

test('deleteAgentFile removes just that file', async () => {
  const { dir, cleanup } = scratch()
  try {
    await saveAgent(dir, makeAgent({ id: 'agent-1' }))
    await saveAgent(dir, makeAgent({ id: 'agent-2' }))
    await deleteAgentFile(dir, 'agent-1')
    const loaded = await loadAgents(dir)
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0].id, 'agent-2')
  } finally { cleanup() }
})

test('deleteAgentFile is idempotent (does not throw)', async () => {
  const { dir, cleanup } = scratch()
  try {
    await deleteAgentFile(dir, 'never-existed')
    // No assertion — just make sure it doesn't throw
  } finally { cleanup() }
})

// --- sanitizeHydratedAgent (defends against restart bugs) ---

test('sanitizeHydratedAgent: running → awaiting_input', () => {
  const cleaned = sanitizeHydratedAgent(makeAgent({ status: 'running' }))
  assert.equal(cleaned.status, 'awaiting_input')
})

test('sanitizeHydratedAgent: awaiting_merge with dead worktree ref → merged + refs cleared', () => {
  const cleaned = sanitizeHydratedAgent(makeAgent({
    status: 'awaiting_merge',
    worktreePath: '/nonexistent/path/that/definitely/does/not/exist',
    branch: 'vibe/agent-1/dead-branch'
  }))
  assert.equal(cleaned.status, 'merged')
  assert.equal(cleaned.worktreePath, null)
  assert.equal(cleaned.branch, null)
})

test('sanitizeHydratedAgent: awaiting_merge with real worktree stays awaiting_merge', () => {
  // Use the tmp dir itself (guaranteed to exist)
  const cleaned = sanitizeHydratedAgent(makeAgent({
    status: 'awaiting_merge',
    worktreePath: process.cwd(),  // definitely exists
    branch: 'vibe/agent-1/real'
  }))
  assert.equal(cleaned.status, 'awaiting_merge')
  assert.equal(cleaned.branch, 'vibe/agent-1/real')
})

test('sanitizeHydratedAgent: idle with no refs is untouched', () => {
  const cleaned = sanitizeHydratedAgent(makeAgent({ status: 'idle' }))
  assert.equal(cleaned.status, 'idle')
  assert.equal(cleaned.worktreePath, null)
  assert.equal(cleaned.branch, null)
})

test('saveAgent + loadAgents: merged-with-cleared-refs roundtrip preserves state', async () => {
  const { dir, cleanup } = scratch()
  try {
    await saveAgent(dir, makeAgent({
      id: 'agent-1',
      status: 'merged',
      branch: null,
      worktreePath: null,
      task: 'add feature',
      messages: [{ role: 'user', content: 'go' }]
    }))
    const [loaded] = await loadAgents(dir)
    assert.equal(loaded.status, 'merged')
    assert.equal(loaded.branch, null)
    assert.equal(loaded.worktreePath, null)
    assert.equal(loaded.task, 'add feature')
  } finally { cleanup() }
})
