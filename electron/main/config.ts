import Store from 'electron-store'
import type { Config } from './types'
import { encryptSecret, decryptSecret } from './secretstore'

// Fields that store API keys and should be encrypted at rest.
const SECRET_FIELDS: Array<keyof Config> = [
  'openrouterApiKey',
  'anthropicApiKey',
  'openaiApiKey',
  'geminiApiKey',
  'groqApiKey',
  'xaiApiKey'
]

const store = new Store<Config>({
  defaults: {
    workspacePath: null,
    recentWorkspaces: [],
    openrouterApiKey: null,
    anthropicApiKey: null,
    openaiApiKey: null,
    geminiApiKey: null,
    groqApiKey: null,
    xaiApiKey: null,
    model: 'openrouter/free,minimax/minimax-m3:free',
    pmModel: null,
    maxSteps: 100,
    agentCount: 4,
    keybindings: {}
  }
})

// One-time migration: users on the old 25-step default were hitting the limit
// too often for it to be a helpful signal. Bump exactly-25 to 100. Users who
// explicitly set something else (higher OR lower) keep their choice.
{
  const cur = store.get('maxSteps')
  const migrated = migrateMaxSteps(cur)
  if (migrated !== cur) store.set('maxSteps', migrated as number)
}

// Pure migration helper — extracted for testing. Returns the value to persist,
// or the input unchanged if no migration applies.
export function migrateMaxSteps(current: number | undefined, oldDefault = 25, newDefault = 100): number | undefined {
  if (current === oldDefault) return newDefault
  return current
}

// Read: decrypt any encrypted secret fields transparently.
export function getConfig(): Config {
  return {
    workspacePath: store.get('workspacePath'),
    recentWorkspaces: store.get('recentWorkspaces') ?? [],
    openrouterApiKey: decryptSecret(store.get('openrouterApiKey')),
    anthropicApiKey: decryptSecret(store.get('anthropicApiKey')),
    openaiApiKey: decryptSecret(store.get('openaiApiKey')),
    geminiApiKey: decryptSecret(store.get('geminiApiKey')),
    groqApiKey: decryptSecret(store.get('groqApiKey')),
    xaiApiKey: decryptSecret(store.get('xaiApiKey')),
    model: store.get('model'),
    pmModel: store.get('pmModel') ?? null,
    maxSteps: store.get('maxSteps'),
    agentCount: store.get('agentCount') ?? 4,
    keybindings: store.get('keybindings') ?? {}
  }
}

// Write: encrypt any incoming secret fields before persisting.
export function setConfig(partial: Partial<Config>): Config {
  for (const [k, v] of Object.entries(partial)) {
    const key = k as keyof Config
    if (SECRET_FIELDS.includes(key)) {
      store.set(key, encryptSecret(v as string | null) as never)
    } else {
      store.set(key, v as never)
    }
  }
  return getConfig()
}

// Pure MRU calculation — extracted for testability.
// Moves `path` to the front, dedups, caps at maxItems (default 10).
export function computeMru(currentList: string[], path: string, maxItems = 10): string[] {
  const list = currentList.filter(p => p !== path)
  list.unshift(path)
  return list.slice(0, maxItems)
}

// Push a workspace path to the front of the recent list (MRU, capped at 10).
export function pushRecentWorkspace(path: string): void {
  const current = store.get('recentWorkspaces') ?? []
  store.set('recentWorkspaces', computeMru(current, path))
}
