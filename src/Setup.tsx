// Settings screen, and the first-run wizard — same component, different copy.
//
// Owns the draft state for everything that participates in Save (keys,
// workspace, models, budgets) and hands slices of it to the tab components.
// The Keybindings tab is the exception: it writes through immediately.

import { useEffect, useState } from 'react'
import type { Config } from './types'
import { usePrefs } from './stores/prefs'
import WorkspaceTab from './components/settings/WorkspaceTab'
import ModelsTab from './components/settings/ModelsTab'
import ApiKeysTab from './components/settings/ApiKeysTab'
import KeybindingsTab from './components/settings/KeybindingsTab'
import { emptyKeyDraft, keyPatch, type ApiKeyDraft } from './components/settings/providers'

interface Props {
  config: Config
  onSaved: (c: Config) => void
  initialTab?: string  // e.g. 'keybindings' to land the user on that tab
}

type Tab = 'workspace' | 'model' | 'keys' | 'keybindings'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'workspace',   label: 'Workspace' },
  { id: 'model',       label: 'Models' },
  { id: 'keys',        label: 'API Keys' },
  { id: 'keybindings', label: 'Keybindings' }
]

interface OllamaState {
  available: boolean
  baseUrl: string
  models: Array<{ name: string }>
}

export default function Setup({ config, onSaved, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(
    TABS.some(t => t.id === initialTab) ? (initialTab as Tab) : 'workspace'
  )
  const submitOnEnter = usePrefs(s => s.submitOnEnter)
  const setSubmitOnEnter = usePrefs(s => s.setSubmitOnEnter)
  const [keys, setKeys] = useState<ApiKeyDraft>(() => emptyKeyDraft(config))
  const [workspace, setWorkspace] = useState(config.workspacePath ?? '')
  const [model, setModel] = useState(config.model)
  const [pmModel, setPmModel] = useState(config.pmModel ?? '')
  const [agentCount, setAgentCount] = useState(config.agentCount ?? 4)
  const [maxSteps, setMaxSteps] = useState(config.maxSteps ?? 25)
  const [saving, setSaving] = useState(false)
  const [ollama, setOllama] = useState<OllamaState | null>(null)

  useEffect(() => {
    window.vibe.probe.ollama().then(r => setOllama(r as OllamaState))
  }, [])

  async function pickWorkspace() {
    const p = await window.vibe.workspace.pick()
    if (p) setWorkspace(p)
  }

  async function save() {
    setSaving(true)
    const patch: Partial<Config> = {
      ...keyPatch(keys),
      workspacePath: workspace.trim() || null,
      model,
      pmModel: pmModel.trim() || null,
      agentCount: Math.max(1, Math.min(8, agentCount)),
      maxSteps: Math.max(5, Math.min(200, maxSteps))
    }
    const next = await window.vibe.config.set(patch)
    setSaving(false)
    onSaved(next)
  }

  const isFirstRun = !config.workspacePath
  const hasAnyKey = Object.values(keys).some(v => v?.trim())
  const ready = (hasAnyKey || ollama?.available) && workspace.trim() && model.trim()

  return (
    <div className="settings-page">
      <div className="settings-inner">
        <header className="settings-header">
          <div>
            <h1>{isFirstRun ? 'Welcome to Vibe.' : 'Settings'}</h1>
            <p className="settings-subtitle">
              {isFirstRun
                ? 'A command center for agent-driven development. Free forever, open source.'
                : 'API keys, model routing, workspace, and agent limits.'}
            </p>
          </div>
        </header>

        <div className="settings-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`settings-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'workspace' && (
          <WorkspaceTab
            workspace={workspace}
            setWorkspace={setWorkspace}
            onPickWorkspace={pickWorkspace}
            agentCount={agentCount}
            setAgentCount={setAgentCount}
            maxSteps={maxSteps}
            setMaxSteps={setMaxSteps}
            submitOnEnter={submitOnEnter}
            setSubmitOnEnter={setSubmitOnEnter}
          />
        )}

        {tab === 'model' && (
          <ModelsTab
            config={config}
            keys={keys}
            model={model}
            setModel={setModel}
            pmModel={pmModel}
            setPmModel={setPmModel}
          />
        )}

        {tab === 'keys' && <ApiKeysTab keys={keys} setKeys={setKeys} />}

        {tab === 'keybindings' && <KeybindingsTab />}

        <footer className="settings-footer">
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            {!ready && !hasAnyKey && !ollama?.available && (
              <>Need at least one API key or a local Ollama install.</>
            )}
            {!ready && (!workspace.trim() || !model.trim()) && (
              <>Workspace folder and model are required.</>
            )}
          </div>
          <button className="primary" onClick={save} disabled={!ready || saving} style={{ padding: '10px 20px' }}>
            {saving ? 'Saving…' : isFirstRun ? 'Start' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}
