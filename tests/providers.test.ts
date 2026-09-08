import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toApiMessages, parseToolCalls } from '../electron/main/providers/serialize'
import { providerFor } from '../electron/main/providers/adapter'
import type { Message } from '../electron/main/types'
import type { OpenAIRawChoice } from '../electron/main/providers/types'

// --- serialize ---

test('toApiMessages: user/system messages serialize verbatim', () => {
  const messages: Message[] = [
    { role: 'system', content: 'you are helpful' },
    { role: 'user', content: 'hi' }
  ]
  const result = toApiMessages(messages)
  assert.deepEqual(result, [
    { role: 'system', content: 'you are helpful' },
    { role: 'user', content: 'hi' }
  ])
})

test('toApiMessages: assistant with tool_calls serializes arguments as JSON string', () => {
  const messages: Message[] = [{
    role: 'assistant',
    content: null,
    toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'main.py' } }]
  }]
  const result = toApiMessages(messages) as Array<{ tool_calls?: Array<{ function: { arguments: string } }> }>
  assert.equal(result[0].tool_calls?.[0].function.arguments, '{"path":"main.py"}')
})

test('toApiMessages: tool message includes tool_call_id and name', () => {
  const messages: Message[] = [{
    role: 'tool',
    content: 'file contents',
    toolCallId: 'call_abc',
    name: 'read_file'
  }]
  const result = toApiMessages(messages) as Array<{ tool_call_id: string; name: string; content: string }>
  assert.equal(result[0].tool_call_id, 'call_abc')
  assert.equal(result[0].name, 'read_file')
  assert.equal(result[0].content, 'file contents')
})

test('parseToolCalls: returns undefined when no tool_calls', () => {
  const choice: OpenAIRawChoice = {
    message: { role: 'assistant', content: 'hello' },
    finish_reason: 'stop'
  }
  assert.equal(parseToolCalls(choice), undefined)
})

test('parseToolCalls: parses JSON arguments into an object', () => {
  const choice: OpenAIRawChoice = {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'write_file', arguments: '{"path":"x.py","content":"hi"}' }
      }]
    },
    finish_reason: 'tool_calls'
  }
  const result = parseToolCalls(choice)
  assert.equal(result?.length, 1)
  assert.equal(result?.[0].name, 'write_file')
  assert.deepEqual(result?.[0].arguments, { path: 'x.py', content: 'hi' })
})

test('parseToolCalls: gracefully handles malformed JSON', () => {
  const choice: OpenAIRawChoice = {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'x', arguments: '{malformed' }
      }]
    },
    finish_reason: 'tool_calls'
  }
  const result = parseToolCalls(choice)
  assert.deepEqual(result?.[0].arguments, { _raw: '{malformed' })
})

// --- providerFor ---

test('providerFor: bare model slug routes to OpenRouter', () => {
  const p = providerFor('meta-llama/llama-3.3-70b-instruct:free', { openrouter: 'sk-or-x' })
  assert.equal(p.label, 'OpenRouter')
  assert.equal(p.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(p.model, 'meta-llama/llama-3.3-70b-instruct:free')
  assert.equal(p.needsAuth, true)
  assert.equal(p.apiKey, 'sk-or-x')
})

test('providerFor: anthropic/* WITH OpenRouter key only routes to OpenRouter (same slug format)', () => {
  const p = providerFor('anthropic/claude-3.5-sonnet', { openrouter: 'sk-or-x' })
  assert.equal(p.label, 'OpenRouter')
  assert.equal(p.model, 'anthropic/claude-3.5-sonnet')
  assert.equal(p.apiKey, 'sk-or-x')
})

test('providerFor: anthropic/* WITH Anthropic key routes to Anthropic direct (BYOK)', () => {
  const p = providerFor('anthropic/claude-sonnet-4-6', { anthropic: 'sk-ant-x' })
  assert.equal(p.label, 'Anthropic')
  assert.equal(p.model, 'claude-sonnet-4-6')
  assert.equal(p.apiKey, 'sk-ant-x')
})

test('providerFor: anthropic/* WITH BOTH keys prefers Anthropic direct', () => {
  const p = providerFor('anthropic/claude-sonnet-4-6', { openrouter: 'sk-or-x', anthropic: 'sk-ant-x' })
  assert.equal(p.label, 'Anthropic')
})

test('providerFor: Ollama slug strips prefix', () => {
  const p = providerFor('ollama/llama3.2:3b', {})
  assert.equal(p.label, 'Ollama')
  assert.equal(p.baseUrl, 'http://localhost:11434/v1')
  assert.equal(p.model, 'llama3.2:3b')
  assert.equal(p.needsAuth, false)
  assert.equal(p.apiKey, null)
})

test('providerFor: missing OpenRouter key returns null (not undefined)', () => {
  const p = providerFor('meta-llama/llama-3.3-70b-instruct:free', {})
  assert.equal(p.apiKey, null)
})
