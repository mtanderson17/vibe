import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSystem, toModelMessages } from '../electron/main/providers/aisdk'
import type { Message } from '../electron/main/types'

test('extractSystem: pulls single system message out', () => {
  const messages: Message[] = [
    { role: 'system', content: 'you are a helpful agent' },
    { role: 'user', content: 'hi' }
  ]
  const { system, rest } = extractSystem(messages)
  assert.equal(system, 'you are a helpful agent')
  assert.equal(rest.length, 1)
  assert.equal(rest[0].role, 'user')
})

test('extractSystem: concatenates multiple system messages in order', () => {
  const messages: Message[] = [
    { role: 'system', content: 'first' },
    { role: 'user', content: 'hi' },
    { role: 'system', content: 'compaction summary' },
    { role: 'user', content: 'continue' }
  ]
  const { system, rest } = extractSystem(messages)
  assert.equal(system, 'first\n\ncompaction summary')
  assert.equal(rest.length, 2)
  assert.ok(rest.every(m => m.role !== 'system'))
})

test('extractSystem: no system messages returns undefined', () => {
  const messages: Message[] = [{ role: 'user', content: 'hi' }]
  const { system, rest } = extractSystem(messages)
  assert.equal(system, undefined)
  assert.equal(rest.length, 1)
})

test('extractSystem: skips empty-content system messages', () => {
  const messages: Message[] = [
    { role: 'system', content: null },
    { role: 'user', content: 'hi' }
  ]
  const { system } = extractSystem(messages)
  assert.equal(system, undefined)
})

test('toModelMessages: user + assistant plain text', () => {
  const out = toModelMessages([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' }
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].role, 'user')
  assert.equal(out[0].content, 'hi')
  assert.equal(out[1].role, 'assistant')
  assert.equal(out[1].content, 'hello')
})

test('toModelMessages: assistant with tool calls emits parts array', () => {
  const out = toModelMessages([
    {
      role: 'assistant',
      content: 'let me read that',
      toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'a.ts' } }]
    }
  ])
  assert.equal(out.length, 1)
  const parts = out[0].content as Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown }>
  assert.ok(Array.isArray(parts))
  assert.equal(parts[0].type, 'text')
  assert.equal(parts[0].text, 'let me read that')
  assert.equal(parts[1].type, 'tool-call')
  assert.equal(parts[1].toolCallId, 'call_1')
  assert.equal(parts[1].toolName, 'read_file')
  assert.deepEqual(parts[1].input, { path: 'a.ts' })
})

test('toModelMessages: assistant with only tool calls (no text)', () => {
  const out = toModelMessages([
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c', name: 'list_files', arguments: { path: '.' } }]
    }
  ])
  const parts = out[0].content as Array<{ type: string }>
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, 'tool-call')
})

test('toModelMessages: tool result message', () => {
  const out = toModelMessages([
    { role: 'tool', content: 'file contents', toolCallId: 'call_1', name: 'read_file' }
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].role, 'tool')
  const content = out[0].content as Array<{ type: string; toolCallId: string; toolName: string; output: { value: string } }>
  assert.equal(content[0].type, 'tool-result')
  assert.equal(content[0].toolCallId, 'call_1')
  assert.equal(content[0].toolName, 'read_file')
  assert.equal(content[0].output.value, 'file contents')
})

test('toModelMessages: stray system falls through as user with prefix (defensive)', () => {
  // extractSystem should normally remove these; if one leaks through, we
  // preserve its content by inlining rather than throwing.
  const out = toModelMessages([
    { role: 'system', content: 'stray' }
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].role, 'user')
  assert.match(out[0].content as string, /\[system\]/)
})
