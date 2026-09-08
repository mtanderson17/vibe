import { useEffect, useState, useCallback, useMemo } from 'react'
import type { Config } from '../types'

interface Props {
  value: string   // comma-separated slug chain
  onChange: (value: string) => void
  config: Config
  compact?: boolean
}

interface ModelOption {
  slug: string
  label: string
  source: 'openrouter-free' | 'openrouter-paid' | 'anthropic' | 'openai' | 'gemini' | 'groq' | 'xai' | 'ollama'
  meta?: string        // e.g. 'rate limited', '256k ctx'
  available: boolean   // clickable?
}

// Curated slugs per BYOK provider. Shown when the corresponding key is set.
// Users can still paste custom slugs for anything not in this list.
const CURATED: Record<string, string[]> = {
  anthropic: [
    'anthropic/claude-opus-4-7',
    'anthropic/claude-opus-4-6',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-sonnet-4-5',
    'anthropic/claude-haiku-4-5'
  ],
  openai: [
    'openai/gpt-5',
    'openai/gpt-5-mini',
    'openai/gpt-5-nano'
  ],
  gemini: [
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash',
    'google/gemini-2.5-flash-lite'
  ],
  groq: [
    'groq/llama-3.3-70b-versatile',
    'groq/deepseek-r1-distill-llama-70b',
    'groq/qwen-2.5-coder-32b'
  ],
  xai: [
    'xai/grok-4',
    'xai/grok-4-mini'
  ]
}

export default function ModelChainPicker({ value, onChange, config, compact = false }: Props) {
  const [freeProbe, setFreeProbe] = useState<Array<{ slug: string; status: string; contextLength?: number }>>([])
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [byokCatalogs, setByokCatalogs] = useState<Record<string, string[]>>({})
  const [customInput, setCustomInput] = useState('')
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    window.vibe.probe.ollama().then(r => {
      if (r.available) setOllamaModels(r.models.map(m => m.name))
    })
  }, [])

  // Fetch each configured provider's live model catalog once
  useEffect(() => {
    const providers: Array<{ key: 'anthropic' | 'openai' | 'gemini' | 'groq' | 'xai'; hasKey: boolean }> = [
      { key: 'anthropic', hasKey: !!config.anthropicApiKey },
      { key: 'openai',    hasKey: !!config.openaiApiKey },
      { key: 'gemini',    hasKey: !!config.geminiApiKey },
      { key: 'groq',      hasKey: !!config.groqApiKey },
      { key: 'xai',       hasKey: !!config.xaiApiKey }
    ]
    for (const { key, hasKey } of providers) {
      if (!hasKey || byokCatalogs[key]) continue
      window.vibe.models.listProvider(key).then(list => {
        setByokCatalogs(prev => ({ ...prev, [key]: list }))
      }).catch(() => { /* keep curated fallback */ })
    }
  }, [config.anthropicApiKey, config.openaiApiKey, config.geminiApiKey, config.groqApiKey, config.xaiApiKey, byokCatalogs])

  const runProbe = useCallback(async () => {
    if (!config.openrouterApiKey) return
    setProbing(true)
    try {
      const results = await window.vibe.probe.openrouter(config.openrouterApiKey)
      setFreeProbe(results)
    } finally {
      setProbing(false)
    }
  }, [config.openrouterApiKey])

  // Auto-probe once if we have a key and haven't yet
  useEffect(() => {
    if (config.openrouterApiKey && freeProbe.length === 0) {
      runProbe()
    }
  }, [config.openrouterApiKey, freeProbe.length, runProbe])

  const selected = useMemo(
    () => value.split(',').map(s => s.trim()).filter(Boolean),
    [value]
  )

  const options: ModelOption[] = useMemo(() => {
    const opts: ModelOption[] = []

    // BYOK models: prefer dynamically fetched catalog, fall back to curated
    const listFor = (key: string, source: ModelOption['source']) => {
      const dynamic = byokCatalogs[key]
      const list = dynamic && dynamic.length > 0 ? dynamic : (CURATED[key] ?? [])
      for (const slug of list) opts.push({ slug, label: slug, source, available: true })
    }
    if (config.anthropicApiKey) listFor('anthropic', 'anthropic')
    if (config.openaiApiKey)    listFor('openai', 'openai')
    if (config.geminiApiKey)    listFor('gemini', 'gemini')
    if (config.groqApiKey)      listFor('groq', 'groq')
    if (config.xaiApiKey)       listFor('xai', 'xai')

    // Ollama detected locally
    for (const name of ollamaModels) {
      opts.push({ slug: `ollama/${name}`, label: `ollama/${name}`, source: 'ollama', available: true })
    }

    // OpenRouter free-tier from live probe
    for (const r of freeProbe) {
      let meta = ''
      if (r.contextLength) meta = `${(r.contextLength / 1000).toFixed(0)}k ctx`
      if (r.status !== 'ok') meta = r.status
      opts.push({
        slug: r.slug,
        label: r.slug,
        source: 'openrouter-free',
        meta,
        available: r.status === 'ok'
      })
    }

    return opts
  }, [config, freeProbe, ollamaModels, byokCatalogs])

  const grouped = useMemo(() => {
    const byGroup: Record<string, ModelOption[]> = {}
    for (const opt of options) {
      if (!byGroup[opt.source]) byGroup[opt.source] = []
      byGroup[opt.source].push(opt)
    }
    return byGroup
  }, [options])

  function toggleSlug(slug: string) {
    const list = [...selected]
    const idx = list.indexOf(slug)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(slug)
    onChange(list.join(','))
  }

  function removeSlug(slug: string) {
    onChange(selected.filter(s => s !== slug).join(','))
  }

  function moveSlug(slug: string, delta: number) {
    const list = [...selected]
    const idx = list.indexOf(slug)
    if (idx < 0) return
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= list.length) return
    ;[list[idx], list[newIdx]] = [list[newIdx], list[idx]]
    onChange(list.join(','))
  }

  function addCustom() {
    const trimmed = customInput.trim()
    if (!trimmed) return
    if (selected.includes(trimmed)) return
    onChange([...selected, trimmed].join(','))
    setCustomInput('')
  }

  const anyByokKey = !!(config.anthropicApiKey || config.openaiApiKey || config.geminiApiKey || config.groqApiKey || config.xaiApiKey)

  return (
    <div className={`model-picker ${compact ? 'compact' : ''}`}>
      {/* Selected chain, in order */}
      <div className="model-chain">
        {selected.length === 0 && (
          <span style={{ color: 'var(--fg-dim)', fontSize: 12, fontStyle: 'italic' }}>
            No models selected
          </span>
        )}
        {selected.map((slug, i) => (
          <span key={slug} className="model-pill">
            <span style={{ opacity: 0.6, fontSize: 10 }}>{i + 1}.</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{slug}</span>
            <button
              className="model-pill-btn"
              onClick={() => moveSlug(slug, -1)}
              disabled={i === 0}
              title="Move up (higher priority)"
            >↑</button>
            <button
              className="model-pill-btn"
              onClick={() => moveSlug(slug, 1)}
              disabled={i === selected.length - 1}
              title="Move down (lower priority)"
            >↓</button>
            <button
              className="model-pill-btn"
              onClick={() => removeSlug(slug)}
              title="Remove"
            >×</button>
          </span>
        ))}
      </div>

      {selected.length > 1 && (
        <p className="hint" style={{ marginTop: 4 }}>
          First is primary. If it fails (rate limit, deprecated), Vibe tries the next.
        </p>
      )}

      {/* Available models grouped */}
      <div className="model-groups">
        {config.openrouterApiKey && (
          <div className="model-group-header">
            <strong>OpenRouter free tier</strong>
            <button style={{ fontSize: 11, padding: '2px 8px' }} onClick={runProbe} disabled={probing}>
              {probing ? 'Testing…' : 'Refresh'}
            </button>
          </div>
        )}
        {grouped['openrouter-free']?.map(opt => renderOption(opt, selected.includes(opt.slug), toggleSlug))}

        {ollamaModels.length > 0 && <div className="model-group-header"><strong>Local Ollama</strong></div>}
        {grouped.ollama?.map(opt => renderOption(opt, selected.includes(opt.slug), toggleSlug))}

        {config.anthropicApiKey && <div className="model-group-header"><strong>Anthropic (BYOK)</strong></div>}
        {grouped.anthropic?.map(opt => renderOption(opt, selected.includes(opt.slug), toggleSlug))}

        {config.openaiApiKey && <div className="model-group-header"><strong>OpenAI (BYOK)</strong></div>}
        {grouped.openai?.map(opt => renderOption(opt, selected.includes(opt.slug), toggleSlug))}

        {config.geminiApiKey && <div className="model-group-header"><strong>Google Gemini (BYOK)</strong></div>}
        {grouped.gemini?.map(opt => renderOption(opt, selected.includes(opt.slug), toggleSlug))}

        {config.groqApiKey && <div className="model-group-header"><strong>Groq (BYOK)</strong></div>}
        {grouped.groq?.map(opt => renderOption(opt, selected.includes(opt.slug), toggleSlug))}

        {config.xaiApiKey && <div className="model-group-header"><strong>xAI Grok (BYOK)</strong></div>}
        {grouped.xai?.map(opt => renderOption(opt, selected.includes(opt.slug), toggleSlug))}

        {!config.openrouterApiKey && !anyByokKey && ollamaModels.length === 0 && (
          <p className="hint">Add an API key or install Ollama to see model options.</p>
        )}
      </div>

      {/* Custom slug paste-in */}
      <div className="model-custom">
        <input
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
          placeholder="Paste a custom slug (e.g. openrouter/some-obscure-model)"
          style={{ flex: 1, fontSize: 12 }}
        />
        <button onClick={addCustom} disabled={!customInput.trim()}>Add</button>
      </div>
    </div>
  )
}

function renderOption(opt: ModelOption, selected: boolean, onToggle: (slug: string) => void) {
  return (
    <div
      key={opt.slug}
      className={`model-option ${selected ? 'selected' : ''} ${opt.available ? '' : 'dim'}`}
      onClick={() => opt.available && onToggle(opt.slug)}
    >
      <span className="model-option-check">{selected ? '✓' : ''}</span>
      <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{opt.label}</span>
      {opt.meta && <span style={{ fontSize: 10, opacity: 0.6 }}>{opt.meta}</span>}
    </div>
  )
}
