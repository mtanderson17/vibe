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
    maxSteps: 25,
    agentCount: 4
  }
})

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
    agentCount: store.get('agentCount') ?? 4
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

// Push a workspace path to the front of the recent list (MRU, capped at 10).
export function pushRecentWorkspace(path: string): void {
  const list = (store.get('recentWorkspaces') ?? []).filter(p => p !== path)
  list.unshift(path)
  store.set('recentWorkspaces', list.slice(0, 10))
}
