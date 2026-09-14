// Settings → API Keys. One row per provider, masked by default.
//
// Keys are never rendered anywhere else in the app — this tab is the only
// place a raw key is visible, and only after an explicit Reveal.

import { useState } from 'react'
import { PROVIDERS, type ApiKeyDraft } from './providers'

interface Props {
  keys: ApiKeyDraft
  setKeys: (update: (prev: ApiKeyDraft) => ApiKeyDraft) => void
}

export default function ApiKeysTab({ keys, setKeys }: Props) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  function toggleReveal(k: string) {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }

  return (
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
  )
}
