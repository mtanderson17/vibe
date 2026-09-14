// Settings → Models. Two fallback chains: one for coding agents, one for the
// PM agent. Both pickers see the *draft* API keys so a key typed on the Keys
// tab immediately unlocks that provider's models without a save round-trip.

import ModelChainPicker from '../ModelChainPicker'
import { configWithDraftKeys, type ApiKeyDraft } from './providers'
import type { Config } from '../../types'

interface Props {
  config: Config
  keys: ApiKeyDraft
  model: string
  setModel: (v: string) => void
  pmModel: string
  setPmModel: (v: string) => void
}

export default function ModelsTab({ config, keys, model, setModel, pmModel, setPmModel }: Props) {
  const previewConfig = configWithDraftKeys(config, keys)

  return (
    <section className="settings-section">
      <div className="settings-section-title">Default model chain</div>
      <div className="settings-section-body">
        <div className="settings-field">
          <label>Coding-agent model chain (in order of priority)</label>
          <ModelChainPicker value={model} onChange={setModel} config={previewConfig} />
          <p className="hint">
            Applies globally to coding agents. Individual agents can override in their header. First model is primary; if it fails, Vibe falls through to the next.
          </p>
        </div>

        <div className="settings-field">
          <label>PM-agent model chain (optional — uses coding chain if empty)</label>
          <ModelChainPicker value={pmModel} onChange={setPmModel} config={previewConfig} />
          <p className="hint">
            PM agent maintains the project summary and manages tasks — a cheaper/faster model is usually a good fit here.
          </p>
        </div>
      </div>
    </section>
  )
}
