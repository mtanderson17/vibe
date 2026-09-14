import { stubVibe, spy } from './helpers/dom'   // must come first — installs the DOM
import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MergePanel from '../src/components/MergePanel'

test('awaiting_merge renders the merge prompt and checks sibling overlap', async () => {
  const checkOverlap = spy({ own: ['a.ts'], overlaps: {} })
  const restore = stubVibe({ agents: { checkOverlap } })
  try {
    render(<MergePanel agentId="agent-1" branch="vibe/agent-1" status="awaiting_merge" />)
    assert.ok(screen.getByText(/Ready to merge/))
    assert.ok(screen.getByText('vibe/agent-1'))
    await waitFor(() => assert.deepEqual(checkOverlap.calls, [['agent-1']]))
  } finally { cleanup(); restore() }
})

test('overlapping siblings surface a warning with the conflicting files', async () => {
  const restore = stubVibe({
    agents: { checkOverlap: async () => ({ own: ['a.ts'], overlaps: { 'agent-2': ['a.ts', 'b.ts'] } }) }
  })
  try {
    render(<MergePanel agentId="agent-1" branch="vibe/agent-1" status="awaiting_merge" />)
    await waitFor(() => assert.ok(screen.getByText(/Overlaps with sibling agents/)))
    assert.ok(screen.getByText(/a\.ts, b\.ts/))
    assert.ok(screen.getByText('agent-2'))
  } finally { cleanup(); restore() }
})

test('a clean merge shows the success banner', async () => {
  const restore = stubVibe({
    agents: { merge: async () => ({ ok: true, conflicts: [], output: '' }) }
  })
  try {
    const user = userEvent.setup()
    render(<MergePanel agentId="agent-1" branch="vibe/agent-1" status="awaiting_merge" />)
    await user.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => assert.ok(screen.getByText('✓ Merged successfully')))
  } finally { cleanup(); restore() }
})

test('a conflicted merge lists the files and offers AI resolution', async () => {
  const restore = stubVibe({
    agents: { merge: async () => ({ ok: false, conflicts: ['src/a.ts', 'src/b.ts'], output: '' }) }
  })
  try {
    const user = userEvent.setup()
    render(<MergePanel agentId="agent-1" branch="vibe/agent-1" status="awaiting_merge" />)
    await user.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => assert.ok(screen.getByText(/Merge conflicts:/)))
    assert.ok(screen.getByRole('button', { name: 'Resolve with AI' }))
    assert.ok(screen.getByRole('button', { name: 'Abort' }))
  } finally { cleanup(); restore() }
})

test('merge state survives awaiting_merge but clears once the agent runs again', async () => {
  const restore = stubVibe({
    agents: { merge: async () => ({ ok: true, conflicts: [], output: '' }) }
  })
  try {
    const user = userEvent.setup()
    const { rerender } = render(
      <MergePanel agentId="agent-1" branch="vibe/agent-1" status="awaiting_merge" />
    )
    await user.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => assert.ok(screen.getByText('✓ Merged successfully')))

    // Still awaiting_merge → banner stays (this is the case the effect must not eat).
    rerender(<MergePanel agentId="agent-1" branch="vibe/agent-1" status="awaiting_merge" />)
    assert.ok(screen.queryByText('✓ Merged successfully'))

    // Agent starts a follow-up task → stale banner is cleared.
    rerender(<MergePanel agentId="agent-1" branch="vibe/agent-1" status="running" />)
    await waitFor(() => assert.equal(screen.queryByText('✓ Merged successfully'), null))
  } finally { cleanup(); restore() }
})

test('aborting a conflicted merge clears the banner and calls abortMerge', async () => {
  const abortMerge = spy(undefined)
  const restore = stubVibe({
    agents: { merge: async () => ({ ok: false, conflicts: ['src/a.ts'], output: '' }), abortMerge }
  })
  try {
    const user = userEvent.setup()
    render(<MergePanel agentId="agent-1" branch="vibe/agent-1" status="awaiting_merge" />)
    await user.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => assert.ok(screen.getByText(/Merge conflicts:/)))
    await user.click(screen.getByRole('button', { name: 'Abort' }))
    await waitFor(() => assert.equal(screen.queryByText(/Merge conflicts:/), null))
    assert.equal(abortMerge.calls.length, 1)
  } finally { cleanup(); restore() }
})
