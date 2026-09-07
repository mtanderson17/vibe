import Store from 'electron-store'
import type { Config } from './types'

const store = new Store<Config>({
  defaults: {
    workspacePath: null,
    openrouterApiKey: null,
    model: 'openrouter/free,minimax/minimax-m3:free',
    maxSteps: 25,
    agentCount: 4
  }
})

export function getConfig(): Config {
  return {
    workspacePath: store.get('workspacePath'),
    openrouterApiKey: store.get('openrouterApiKey'),
    model: store.get('model'),
    maxSteps: store.get('maxSteps'),
    agentCount: store.get('agentCount') ?? 4
  }
}

export function setConfig(partial: Partial<Config>): Config {
  for (const [k, v] of Object.entries(partial)) {
    store.set(k as keyof Config, v as never)
  }
  return getConfig()
}
