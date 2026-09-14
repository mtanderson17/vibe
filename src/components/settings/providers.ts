// The provider catalogue behind the API Keys tab. Data only — adding a
// provider here adds a row to the tab; wiring it into the runtime is a
// separate change in electron/main/providers.ts.

import type { Config } from '../../types'

export interface ProviderSpec {
  key: keyof Config          // config field
  label: string
  console: string            // where to get the key
  consoleUrl: string
  placeholder: string
  slugExample: string
  hint: string
}

export const PROVIDERS: ProviderSpec[] = [
  {
    key: 'openrouterApiKey',
    label: 'OpenRouter',
    console: 'openrouter.ai',
    consoleUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-...',
    slugExample: 'meta-llama/llama-3.3-70b-instruct:free',
    hint: 'Router across 200+ models. Free tier included. The default and most flexible option.'
  },
  {
    key: 'anthropicApiKey',
    label: 'Anthropic',
    console: 'console.anthropic.com',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-api03-...',
    slugExample: 'anthropic/claude-sonnet-4-6',
    hint: 'Claude models direct. Best coding quality; BYOK for full cost transparency.'
  },
  {
    key: 'openaiApiKey',
    label: 'OpenAI',
    console: 'platform.openai.com',
    consoleUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-proj-...',
    slugExample: 'openai/gpt-5',
    hint: 'GPT models direct.'
  },
  {
    key: 'geminiApiKey',
    label: 'Google Gemini',
    console: 'aistudio.google.com',
    consoleUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza...',
    slugExample: 'google/gemini-2.5-pro',
    hint: 'Long-context Google models. Uses their OpenAI-compat endpoint.'
  },
  {
    key: 'groqApiKey',
    label: 'Groq',
    console: 'console.groq.com',
    consoleUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
    slugExample: 'groq/llama-3.3-70b-versatile',
    hint: 'Very fast inference for open-weight models.'
  },
  {
    key: 'xaiApiKey',
    label: 'xAI (Grok)',
    console: 'console.x.ai',
    consoleUrl: 'https://console.x.ai',
    placeholder: 'xai-...',
    slugExample: 'xai/grok-4',
    hint: 'Grok models direct.'
  }
]

/** The config fields PROVIDERS covers — the shape Setup keeps its draft keys in. */
export type ApiKeyDraft = Record<string, string>

export function emptyKeyDraft(config: Config): ApiKeyDraft {
  const draft: ApiKeyDraft = {}
  for (const p of PROVIDERS) {
    draft[p.key] = (config[p.key] as string | null) ?? ''
  }
  return draft
}

/** Overlay the in-progress key edits onto a config, for previews (model picker). */
export function configWithDraftKeys(config: Config, keys: ApiKeyDraft): Config {
  const merged = { ...config } as Config
  for (const p of PROVIDERS) {
    (merged[p.key] as string | null) = keys[p.key] || null
  }
  return merged
}

/** The API-key slice of a save patch. */
export function keyPatch(keys: ApiKeyDraft): Partial<Config> {
  const patch: Partial<Config> = {}
  for (const p of PROVIDERS) {
    (patch[p.key] as string | null) = keys[p.key]?.trim() || null
  }
  return patch
}
