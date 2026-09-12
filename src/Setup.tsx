import { useEffect, useState } from 'react'
import type { Config } from './types'
import ModelChainPicker from './components/ModelChainPicker'
import KeybindingsEditor from './components/KeybindingsEditor'

interface Props {
  config: Config
  onSaved: (c: Config) => void
}

interface OllamaState {
  available: boolean
  baseUrl: string
  models: Array<{ name: string }>
}

interface ProviderSpec {
  key: keyof Config          // config field
  label: string
  console: string             // where to get the key
  consoleUrl: string
  placeholder: string
  slugExample: string
  hint: string
}

const PROVIDERS: ProviderSpec[] = [
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

export default function Setup({ config, onSaved }: Props) {
  const [keys, setKeys] = useState<Record<string, string>>({
    openrouterApiKey: config.openrouterApiKey ?? '',
    anthropicApiKey: config.anthropicApiKey ?? '',
    openaiApiKey: config.openaiApiKey ?? '',
    geminiApiKey: config.geminiApiKey ?? '',
    groqApiKey: config.groqApiKey ?? '',
    xaiApiKey: config.xaiApiKey ?? ''
  })
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
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
      openrouterApiKey: keys.openrouterApiKey.trim() || null,
      anthropicApiKey: keys.anthropicApiKey.trim() || null,
      openaiApiKey: keys.openaiApiKey.trim() || null,
      geminiApiKey: keys.geminiApiKey.trim() || null,
      groqApiKey: keys.groqApiKey.trim() || null,
      xaiApiKey: keys.xaiApiKey.trim() || null,
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

  function toggleReveal(k: string) {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }

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

        {/* Workspace */}
        <section className="settings-section">
          <div className="settings-section-title">Workspace</div>
          <div className="settings-section-body">
            <div className="settings-field">
              <label>Project folder</label>
              <div className="row-inline">
                <input
                  value={workspace}
                  onChange={e => setWorkspace(e.target.value)}
                  placeholder="C:\path\to\your\project"
                />
                <button onClick={pickWorkspace}>Browse…</button>
              </div>
              <p className="hint">A git repo (with a sensible <code>.gitignore</code>) will be initialized here if one doesn't exist.</p>
            </div>

            <div className="settings-field">
              <label>Concurrent agents (1–8)</label>
              <input
                type="number"
                min={1}
                max={8}
                value={agentCount}
                onChange={e => setAgentCount(parseInt(e.target.value) || 1)}
                style={{ width: 100 }}
              />
              <p className="hint">More agents = more parallelism, more RAM, more API load.</p>
            </div>

            <div className="settings-field">
              <label>Steps per agent turn budget (5–200)</label>
              <input
                type="number"
                min={5}
                max={200}
                value={maxSteps}
                onChange={e => setMaxSteps(parseInt(e.target.value) || 25)}
                style={{ width: 100 }}
              />
              <p className="hint">
                Max tool-call turns before an agent pauses for user input. Hitting the limit shows a
                Continue button — click to add another {maxSteps} steps of runway.
              </p>
            </div>
          </div>
        </section>

        {/* Model */}
        <section className="settings-section">
          <div className="settings-section-title">Default model chain</div>
          <div className="settings-section-body">
            <div className="settings-field">
              <label>Coding-agent model chain (in order of priority)</label>
              <ModelChainPicker
                value={model}
                onChange={setModel}
                config={{
                  ...config,
                  openrouterApiKey: keys.openrouterApiKey || null,
                  anthropicApiKey: keys.anthropicApiKey || null,
                  openaiApiKey: keys.openaiApiKey || null,
                  geminiApiKey: keys.geminiApiKey || null,
                  groqApiKey: keys.groqApiKey || null,
                  xaiApiKey: keys.xaiApiKey || null
                }}
              />
              <p className="hint">
                Applies globally to coding agents. Individual agents can override in their header. First model is primary; if it fails, Vibe falls through to the next.
              </p>
            </div>

            <div className="settings-field">
              <label>PM-agent model chain (optional — uses coding chain if empty)</label>
              <ModelChainPicker
                value={pmModel}
                onChange={setPmModel}
                config={{
                  ...config,
                  openrouterApiKey: keys.openrouterApiKey || null,
                  anthropicApiKey: keys.anthropicApiKey || null,
                  openaiApiKey: keys.openaiApiKey || null,
                  geminiApiKey: keys.geminiApiKey || null,
                  groqApiKey: keys.groqApiKey || null,
                  xaiApiKey: keys.xaiApiKey || null
                }}
              />
              <p className="hint">
                PM agent maintains the project summary and manages tasks — a cheaper/faster model is usually a good fit here.
              </p>
            </div>
          </div>
        </section>

        {/* API keys */}
        <section className="settings-section">
          <div className="settings-section-title">API keys</div>
          <div className="settings-section-body">
            <div className="trust-note">
              <strong>Where your keys live.</strong> Encrypted at rest on macOS/Windows (or plaintext on Linux w/o keyring). Stored locally
              in Electron's per-user data directory — never sent to Vibe. Full path in the README.
            </div>

            {PROVIDERS.map(p => {
              const currentValue = keys[p.key] ?? ''
              const isSet = !!currentValue.trim()
              const isRevealed = revealed.has(p.key)
              return (
                <div key={p.key} className="provider-row">
                  <div className="provider-head">
                    <span className="provider-name">{p.label}</span>
                    <span className={`provider-status ${isSet ? 'set' : ''}`}>
                      {isSet ? '● configured' : 'not set'}
                    </span>
                  </div>
                  <div className="row-inline">
                    <input
                      type={isRevealed ? 'text' : 'password'}
                      value={currentValue}
                      onChange={e => setKeys(prev => ({ ...prev, [p.key]: e.target.value }))}
                      placeholder={p.placeholder}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => toggleReveal(p.key)}
                      title={isRevealed ? 'Hide' : 'Reveal'}
                      style={{ minWidth: 68 }}
                    >
                      {isRevealed ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                  <div className="provider-hint">
                    {p.hint} · Get a key at{' '}
                    <span style={{ color: 'var(--accent)', fontFamily: 'monospace', fontSize: 11 }}>{p.console}</span>{' '}
                    · slug format <code>{p.slugExample}</code>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">Keybindings</div>
          <div className="settings-section-body">
            <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginBottom: 12 }}>
              Click <strong>Rebind</strong>, then press the target key combination. Changes save immediately and update the app menu.
            </div>
            <KeybindingsEditor />
          </div>
        </section>

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
