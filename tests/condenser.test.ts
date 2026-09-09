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
