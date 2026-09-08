import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeToolCalls, accumulateUsage, pinnedModelFor } from '../electron/main/tool-loop'
import type { ToolCall } from '../electron/main/types'

// --- pinnedModelFor ---

test('pinnedModelFor: keeps existing pin', () => {
  const result = pinnedModelFor('openrouter/existing-pin', 'openrouter/free,ollama/x', 'served-by-x')
  assert.equal(result, 'openrouter/existing-pin')
})

test('pinnedModelFor: single-slug pins to itself even without servedBy', () => {
  const result = pinnedModelFor(undefined, 'ollama/llama3.2:3b', undefined)
  assert.equal(result, 'ollama/llama3.2:3b')
})

test('pinnedModelFor: single anthropic slug pins to itself', () => {
  const result = pinnedModelFor(undefined, 'anthropic/claude-sonnet-4-6', undefined)
  assert.equal(result, 'anthropic/claude-sonnet-4-6')
})

test('pinnedModelFor: multi-slug matches on suffix (preserving provider prefix)', () => {
  const result = pinnedModelFor(
    undefined,
    'openrouter/free,anthropic/claude-sonnet-4-6',
    'claude-sonnet-4-6'
  )
  assert.equal(result, 'anthropic/claude-sonnet-4-6')
})

test('pinnedModelFor: multi-slug with full match uses that', () => {
  const result = pinnedModelFor(
    undefined,
    'openrouter/free,meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free'
  )
  assert.equal(result, 'meta-llama/llama-3.3-70b-instruct:free')
})

test('pinnedModelFor: multi-slug no match falls back to servedBy', () => {
  const result = pinnedModelFor(undefined, 'openrouter/free,x', 'some-other-model')
  assert.equal(result, 'some-other-model')
})

test('pinnedModelFor: empty config returns undefined', () => {
  const result = pinnedModelFor(undefined, '', 'anything')
  assert.equal(result, undefined)
})

// --- accumulateUsage ---

test('accumulateUsage: undefined incoming preserves previous', () => {
  const prev = { prompt: 100, completion: 50, total: 150 }
  assert.deepEqual(accumulateUsage(prev, undefined), prev)
})

test('accumulateUsage: undefined previous starts from incoming', () => {
  const incoming = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  assert.deepEqual(accumulateUsage(undefined, incoming), { prompt: 10, completion: 5, total: 15 })
})

test('accumulateUsage: sums across turns', () => {
  const prev = { prompt: 100, completion: 50, total: 150 }
  const incoming = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
  assert.deepEqual(accumulateUsage(prev, incoming), { prompt: 120, completion: 60, total: 180 })
})

test('accumulateUsage: handles missing fields in incoming', () => {
  const incoming = { prompt_tokens: 10 } as unknown as { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  assert.deepEqual(accumulateUsage(undefined, incoming), { prompt: 10, completion: 0, total: 0 })
})

// --- executeToolCalls ---

const makeCall = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: `call_${name}_${Math.random().toString(36).slice(2, 6)}`,
  name,
  arguments: args
})

test('executeToolCalls: runs each call and emits tool messages', async () => {
  const calls = [makeCall('read_file'), makeCall('list_files')]
  const executed: string[] = []
  const result = await executeToolCalls({
    toolCalls: calls,
    execute: async (name) => { executed.push(name); return `result of ${name}` }
  })
  assert.deepEqual(executed, ['read_file', 'list_files'])
  assert.equal(result.messages.length, 2)
  assert.equal(result.messages[0].role, 'tool')
  assert.equal(result.messages[0].content, 'result of read_file')
  assert.equal(result.messages[1].name, 'list_files')
  assert.equal(result.calledFinish, false)
  assert.equal(result.stoppedForInput, false)
  assert.equal(result.aborted, false)
})

test('executeToolCalls: catches thrown errors and continues', async () => {
  const calls = [makeCall('bad_tool'), makeCall('good_tool')]
  const result = await executeToolCalls({
    toolCalls: calls,
    execute: async (name) => {
      if (name === 'bad_tool') throw new Error('kaboom')
      return 'ok'
    }
  })
  assert.match(result.messages[0].content ?? '', /\[error\] kaboom/)
  assert.equal(result.messages[1].content, 'ok')
})

test('executeToolCalls: finish flag on finish call', async () => {
  const calls = [makeCall('finish', { summary: 'done' })]
  const result = await executeToolCalls({
    toolCalls: calls,
    execute: async () => 'summary'
  })
  assert.equal(result.calledFinish, true)
})

test('executeToolCalls: ask_human stops for input and breaks loop', async () => {
  const calls = [makeCall('ask_human'), makeCall('write_file')]
  const executed: string[] = []
  const result = await executeToolCalls({
    toolCalls: calls,
    execute: async (name) => { executed.push(name); return 'x' }
  })
  assert.equal(result.stoppedForInput, true)
  assert.deepEqual(executed, ['ask_human']) // write_file should NOT have run
})

test('executeToolCalls: abort signal short-circuits', async () => {
  const controller = new AbortController()
  controller.abort()
  const calls = [makeCall('x'), makeCall('y')]
  const executed: string[] = []
  const result = await executeToolCalls({
    toolCalls: calls,
    execute: async (name) => { executed.push(name); return 'x' },
    abortSignal: controller.signal
  })
  assert.equal(result.aborted, true)
  assert.equal(executed.length, 0)
})

test('executeToolCalls: emits onToolCall + onToolResult events in order', async () => {
  const events: string[] = []
  const calls = [makeCall('read_file')]
  await executeToolCalls({
    toolCalls: calls,
    execute: async () => 'contents',
    onToolCall: (c) => events.push(`call:${c.name}`),
    onToolResult: (c, r) => events.push(`result:${c.name}:${r}`)
  })
  assert.deepEqual(events, ['call:read_file', 'result:read_file:contents'])
})
