import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerFor } from '../electron/main/providers'

// --- providerFor (kept from before AI SDK migration since routing rules are
// still ours — we decide direct vs OpenRouter based on which key is set) ---

test('providerFor: bare model slug routes to OpenRouter', () => {
  const p = providerFor('meta-llama/llama-3.3-70b-instruct:free', { openrouter: 'sk-or-x' })
  assert.equal(p.label, 'OpenRouter')
  assert.equal(p.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(p.model, 'meta-llama/llama-3.3-70b-instruct:free')
  assert.equal(p.needsAuth, true)
  assert.equal(p.apiKey, 'sk-or-x')
})

test('providerFor: anthropic/* WITH OpenRouter key only routes to OpenRouter', () => {
  const p = providerFor('anthropic/claude-3.5-sonnet', { openrouter: 'sk-or-x' })
  assert.equal(p.label, 'OpenRouter')
  assert.equal(p.model, 'anthropic/claude-3.5-sonnet')
  assert.equal(p.apiKey, 'sk-or-x')
})

test('providerFor: anthropic/* WITH Anthropic key routes to Anthropic direct', () => {
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

test('providerFor: missing OpenRouter key returns null', () => {
  const p = providerFor('meta-llama/llama-3.3-70b-instruct:free', {})
  assert.equal(p.apiKey, null)
})

test('providerFor: openai/* WITH OpenAI key routes to OpenAI direct', () => {
  const p = providerFor('openai/gpt-5', { openai: 'sk-proj-x' })
  assert.equal(p.label, 'OpenAI')
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
  assert.equal(p.model, 'llama-3.3-70b-versatile')
})

test('providerFor: xai/* WITH xAI key routes to xAI direct', () => {
  const p = providerFor('xai/grok-4', { xai: 'xai-x' })
  assert.equal(p.label, 'xAI')
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
