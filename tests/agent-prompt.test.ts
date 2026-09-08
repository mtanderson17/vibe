import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siblingsSummary, buildSystemPrompt } from '../electron/main/agent-prompt'
import type { AgentState } from '../electron/main/types'

function agent(overrides: Partial<AgentState>): AgentState {
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

test('siblingsSummary: no other agents returns placeholder', () => {
  const result = siblingsSummary('agent-1', [agent({ id: 'agent-1' })])
  assert.equal(result, '(no other agents active)')
})

test('siblingsSummary: excludes self even if active', () => {
  const result = siblingsSummary('agent-1', [
    agent({ id: 'agent-1', status: 'running', branch: 'x', task: 'self' })
  ])
  assert.equal(result, '(no other agents active)')
})

test('siblingsSummary: only includes running/awaiting_input/awaiting_merge', () => {
  const result = siblingsSummary('agent-1', [
    agent({ id: 'agent-1' }),
    agent({ id: 'agent-2', status: 'running', branch: 'vibe/agent-2/foo', task: 'do foo' }),
    agent({ id: 'agent-3', status: 'idle', branch: 'x', task: 'idle work' }),
    agent({ id: 'agent-4', status: 'merged', branch: 'y', task: 'old work' })
  ])
  assert.match(result, /agent-2/)
  assert.doesNotMatch(result, /agent-3/)
  assert.doesNotMatch(result, /agent-4/)
})

test('siblingsSummary: shows status, branch, task per sibling', () => {
  const result = siblingsSummary('agent-1', [
    agent({ id: 'agent-1' }),
    agent({
      id: 'agent-2',
      status: 'awaiting_merge',
      branch: 'vibe/agent-2/add-pause',
      task: 'add pause feature'
    })
  ])
  assert.match(result, /agent-2/)
  assert.match(result, /awaiting_merge/)
  assert.match(result, /vibe\/agent-2\/add-pause/)
  assert.match(result, /add pause feature/)
})

test('siblingsSummary: handles missing branch/task gracefully', () => {
  const result = siblingsSummary('agent-1', [
    agent({ id: 'agent-1' }),
    agent({ id: 'agent-2', status: 'running', branch: null, task: null })
  ])
  assert.match(result, /agent-2/)
  assert.match(result, /\?/)          // fallback for null branch
  assert.match(result, /no task/)
})

test('siblingsSummary: lists multiple siblings', () => {
  const result = siblingsSummary('agent-1', [
    agent({ id: 'agent-1' }),
    agent({ id: 'agent-2', status: 'running', branch: 'b2', task: 't2' }),
    agent({ id: 'agent-3', status: 'awaiting_input', branch: 'b3', task: 't3' })
  ])
  assert.match(result, /agent-2/)
  assert.match(result, /agent-3/)
  assert.equal(result.split('\n').length, 2)
})

// --- buildSystemPrompt ---

test('buildSystemPrompt: composes all sections in order', () => {
  const result = buildSystemPrompt({
    agentsGuide: 'GUIDE',
    sharedContext: 'CTX',
    summary: 'SUM',
    agentId: 'agent-1',
    worktreePath: '/tmp/wt/agent-1',
    siblings: '(no other agents active)'
  })

  // Assert section order
  const guideIdx = result.indexOf('GUIDE')
  const ctxIdx = result.indexOf('CTX')
  const sumIdx = result.indexOf('SUM')
  const sibIdx = result.indexOf('Concurrent Agents')
  const sessIdx = result.indexOf('Your Session')

  assert.ok(guideIdx >= 0, 'has guide')
  assert.ok(ctxIdx > guideIdx, 'context after guide')
  assert.ok(sumIdx > ctxIdx, 'summary after context')
  assert.ok(sibIdx > sumIdx, 'siblings after summary')
  assert.ok(sessIdx > sibIdx, 'session after siblings')
  assert.match(result, /agent-1/)
  assert.match(result, /\/tmp\/wt\/agent-1/)
})

test('buildSystemPrompt: siblings section text is included verbatim', () => {
  const result = buildSystemPrompt({
    agentsGuide: 'g',
    sharedContext: 'c',
    summary: 's',
    agentId: 'a',
    worktreePath: '/w',
    siblings: '- agent-2 [running] on branch `foo`: doing X'
  })
  assert.match(result, /agent-2 \[running\] on branch `foo`: doing X/)
})
