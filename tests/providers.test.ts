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

// --- New BYOK providers ---

test('providerFor: openai/* WITH OpenAI key routes to OpenAI direct', () => {
  const p = providerFor('openai/gpt-5', { openai: 'sk-proj-x' })
  assert.equal(p.label, 'OpenAI')
  assert.equal(p.baseUrl, 'https://api.openai.com/v1')
  assert.equal(p.model, 'gpt-5')
  assert.equal(p.apiKey, 'sk-proj-x')
})

test('providerFor: openai/* WITHOUT OpenAI key falls through to OpenRouter', () => {
  const p = providerFor('openai/gpt-5', { openrouter: 'sk-or-x' })
  assert.equal(p.label, 'OpenRouter')
  assert.equal(p.model, 'openai/gpt-5')
})

test('providerFor: google/* WITH Gemini key routes to Gemini direct', () => {
  const p = providerFor('google/gemini-2.5-pro', { gemini: 'AIza-x' })
  assert.equal(p.label, 'Gemini')
  assert.equal(p.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.equal(p.model, 'gemini-2.5-pro')
})

test('providerFor: gemini/* prefix also routes to Gemini', () => {
  const p = providerFor('gemini/gemini-2.5-flash', { gemini: 'AIza-x' })
  assert.equal(p.label, 'Gemini')
  assert.equal(p.model, 'gemini-2.5-flash')
})

test('providerFor: groq/* WITH Groq key routes to Groq direct', () => {
  const p = providerFor('groq/llama-3.3-70b-versatile', { groq: 'gsk_x' })
  assert.equal(p.label, 'Groq')
  assert.equal(p.baseUrl, 'https://api.groq.com/openai/v1')
  assert.equal(p.model, 'llama-3.3-70b-versatile')
})

test('providerFor: xai/* WITH xAI key routes to xAI direct', () => {
  const p = providerFor('xai/grok-4', { xai: 'xai-x' })
  assert.equal(p.label, 'xAI')
  assert.equal(p.baseUrl, 'https://api.x.ai/v1')
  assert.equal(p.model, 'grok-4')
})

test('providerFor: x-ai/* prefix (OpenRouter style) also routes to xAI', () => {
  const p = providerFor('x-ai/grok-4', { xai: 'xai-x' })
  assert.equal(p.label, 'xAI')
  assert.equal(p.model, 'grok-4')
})

test('providerFor: all provider prefixes fall through to OpenRouter without their key', () => {
  const keys = { openrouter: 'sk-or-x' }
  assert.equal(providerFor('openai/gpt-5', keys).label, 'OpenRouter')
  assert.equal(providerFor('google/gemini-2.5-pro', keys).label, 'OpenRouter')
  assert.equal(providerFor('groq/llama-3.3-70b', keys).label, 'OpenRouter')
  assert.equal(providerFor('xai/grok-4', keys).label, 'OpenRouter')
})
