import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTokens, findSafeCut, condenseIfNeeded } from '../electron/main/condenser'
import type { Message } from '../electron/main/types'

test('estimateTokens: sums content across messages', () => {
  const messages: Message[] = [
    { role: 'system', content: 'x'.repeat(400) },
    { role: 'user', content: 'y'.repeat(400) }
  ]
  // 800 chars / 4 = 200 tokens
  assert.equal(estimateTokens(messages), 200)
})

test('estimateTokens: includes tool call args', () => {
  const messages: Message[] = [
    { role: 'assistant', content: null, toolCalls: [{ id: '1', name: 'read_file', arguments: { path: 'foo.ts' } }] }
  ]
  assert.ok(estimateTokens(messages) > 0)
})

test('findSafeCut: lands on user message boundary', () => {
  const messages: Message[] = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'first' },
    { role: 'assistant', content: null, toolCalls: [{ id: '1', name: 'read_file', arguments: {} }] },
    { role: 'tool', content: 'result', toolCallId: '1', name: 'read_file' },
    { role: 'user', content: 'follow up' },
    { role: 'assistant', content: 'ok' }
  ]
  // Preferred cut = 2 (mid tool sequence): idx 2 is assistant, idx 3 is tool result,
  // idx 4 is user — first clean boundary. So cut lands at 4.
  const cut = findSafeCut(messages, 2)
  assert.equal(cut, 4)
})

test('condenseIfNeeded: below budget returns original unchanged', async () => {
  const messages: Message[] = [
    { role: 'system', content: 'small' },
    { role: 'user', content: 'hi' }
  ]
  const result = await condenseIfNeeded(messages, {
    keys: {},
    model: 'test/model',
    tokenBudget: 1000
  })
  assert.equal(result.compacted, false)
  assert.equal(result.messages, messages)
})

test('condenseIfNeeded: with too few messages returns original', async () => {
  const messages: Message[] = [
    { role: 'system', content: 'x'.repeat(50_000) },
    { role: 'user', content: 'y'.repeat(50_000) }
  ]
  const result = await condenseIfNeeded(messages, {
    keys: {},
    model: 'test/model',
    tokenBudget: 100
  })
  // Only 2 messages; can't meaningfully compact
  assert.equal(result.compacted, false)
})

test('condenseIfNeeded: over budget compacts and preserves head + tail', async () => {
  const messages: Message[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'original task' }
  ]
  // 30 middle turns (assistant + tool result pairs)
  for (let i = 0; i < 30; i++) {
    messages.push({ role: 'assistant', content: null, toolCalls: [{ id: `c${i}`, name: 'read_file', arguments: { path: `f${i}.ts` } }] })
    messages.push({ role: 'tool', content: 'x'.repeat(500), toolCallId: `c${i}`, name: 'read_file' })
  }
  // Recent tail
  messages.push({ role: 'user', content: 'now finish it' })
  messages.push({ role: 'assistant', content: 'ok' })

  let summarizerCalled = false
  const result = await condenseIfNeeded(messages, {
    keys: {},
    model: 'test/model',
    tokenBudget: 1000,
    keepRecent: 4,
    summarize: async (sys, user) => {
      summarizerCalled = true
      assert.match(sys, /context summarizer/)
      assert.match(user, /TOOL_CALL read_file/)
      return 'SUMMARY: read 30 files'
    }
  })

  assert.equal(summarizerCalled, true)
  assert.equal(result.compacted, true)
  // Head preserved
  assert.equal(result.messages[0].role, 'system')
  assert.equal(result.messages[0].content, 'system prompt')
  assert.equal(result.messages[1].role, 'user')
  assert.equal(result.messages[1].content, 'original task')
  // Compaction marker inserted
  const marker = result.messages[2]
  assert.equal(marker.role, 'system')
  assert.match(marker.content as string, /\[Compacted \d+ earlier turns/)
  assert.match(marker.content as string, /SUMMARY: read 30 files/)
  // Recent tail preserved (last two messages)
  const last = result.messages[result.messages.length - 1]
  assert.equal(last.role, 'assistant')
  assert.equal(last.content, 'ok')
  // Total length is much smaller than original
  assert.ok(result.messages.length < messages.length / 4)
})

test('condenseIfNeeded: summarizer failure falls back to original', async () => {
  const messages: Message[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'task' }
  ]
  for (let i = 0; i < 30; i++) {
    messages.push({ role: 'assistant', content: 'x'.repeat(200) })
    messages.push({ role: 'user', content: 'more' })
  }
  const result = await condenseIfNeeded(messages, {
    keys: {},
    model: 'test/model',
    tokenBudget: 1000,
    keepRecent: 4,
    summarize: async () => { throw new Error('provider down') }
  })
  assert.equal(result.compacted, false)
  assert.equal(result.messages, messages)
})

test('condenseIfNeeded: preserves clean tool-call boundary (no orphaned tool_result)', async () => {
  const messages: Message[] = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'go' }
  ]
  // Build a long stream where the "keep-recent" preferred cutoff lands INSIDE
  // a tool_call/tool_result pair. findSafeCut should slide the cut forward to
  // the next user turn, so the preserved tail starts cleanly.
  for (let i = 0; i < 20; i++) {
    messages.push({ role: 'user', content: `step ${i}` })
    messages.push({ role: 'assistant', content: null, toolCalls: [{ id: `t${i}`, name: 'read_file', arguments: {} }] })
    messages.push({ role: 'tool', content: 'x'.repeat(300), toolCallId: `t${i}`, name: 'read_file' })
  }

  const result = await condenseIfNeeded(messages, {
    keys: {},
    model: 'test/model',
    tokenBudget: 1000,
    keepRecent: 5,
    summarize: async () => 'summary'
  })
  assert.equal(result.compacted, true)
  // First message after the compaction marker must be user (clean boundary),
  // never a bare tool_result orphaned from its tool_call.
  const afterMarker = result.messages[3]
  assert.equal(afterMarker.role, 'user')
})
