import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROVIDERS, emptyKeyDraft, configWithDraftKeys, keyPatch } from '../src/components/settings/providers'
import type { Config } from '../src/types'

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    workspacePath: 'C:/code/thing',
    recentWorkspaces: [],
    openrouterApiKey: null,
    anthropicApiKey: null,
    openaiApiKey: null,
    geminiApiKey: null,
    groqApiKey: null,
    xaiApiKey: null,
    model: 'anthropic/claude-haiku-4-5',
    pmModel: null,
    maxSteps: 100,
    agentCount: 4,
    ...overrides
  } as Config
}

test('every provider spec is complete and distinct', () => {
  const keys = PROVIDERS.map(p => p.key)
  assert.equal(new Set(keys).size, keys.length, 'two providers share a config field')
  for (const p of PROVIDERS) {
    assert.ok(p.key.endsWith('ApiKey'), `${p.key} is not an API-key field`)
    for (const field of ['label', 'console', 'consoleUrl', 'placeholder', 'slugExample', 'hint'] as const) {
      assert.ok(p[field].length > 0, `${p.key} is missing ${field}`)
    }
    assert.ok(p.consoleUrl.startsWith('https://'), `${p.key} console URL must be https`)
  }
})

test('emptyKeyDraft seeds from config and turns null into an empty string', () => {
  const draft = emptyKeyDraft(baseConfig({ anthropicApiKey: 'sk-ant-live' }))
  assert.equal(draft.anthropicApiKey, 'sk-ant-live')
  assert.equal(draft.openaiApiKey, '')
  assert.deepEqual(Object.keys(draft).sort(), PROVIDERS.map(p => p.key).sort())
})

test('keyPatch trims keys and nulls out blanks', () => {
  const patch = keyPatch({
    openrouterApiKey: '  sk-or-padded  ',
    anthropicApiKey: '',
    openaiApiKey: '   ',
    geminiApiKey: 'AIza-keep',
    groqApiKey: '',
    xaiApiKey: ''
  })
  assert.equal(patch.openrouterApiKey, 'sk-or-padded')
  assert.equal(patch.geminiApiKey, 'AIza-keep')
  assert.equal(patch.anthropicApiKey, null)
  assert.equal(patch.openaiApiKey, null, 'whitespace-only must clear the key, not store spaces')
  assert.equal(Object.keys(patch).length, PROVIDERS.length, 'patch must cover every provider')
})

test('configWithDraftKeys overlays unsaved keys without touching other fields', () => {
  const config = baseConfig({ anthropicApiKey: 'saved-key', model: 'groq/llama' })
  const merged = configWithDraftKeys(config, { ...emptyKeyDraft(config), groqApiKey: 'gsk-typed' })
  assert.equal(merged.groqApiKey, 'gsk-typed', 'a key typed on the Keys tab should be visible to the model picker')
  assert.equal(merged.anthropicApiKey, 'saved-key')
  assert.equal(merged.model, 'groq/llama')
  assert.equal(merged.workspacePath, 'C:/code/thing')
  assert.equal(config.groqApiKey, null, 'must not mutate the original config')
})

test('configWithDraftKeys clears a key the user emptied', () => {
  const config = baseConfig({ anthropicApiKey: 'saved-key' })
  const merged = configWithDraftKeys(config, { ...emptyKeyDraft(config), anthropicApiKey: '' })
  assert.equal(merged.anthropicApiKey, null)
})
