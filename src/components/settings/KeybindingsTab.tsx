// Settings → Keybindings. The editor saves each rebind immediately (it has to
// — the main process owns the menu and rebuilds it on write), so unlike the
// other tabs nothing here participates in Setup's Save.

import KeybindingsEditor from '../KeybindingsEditor'

export default function KeybindingsTab() {
  return (
    <section className="settings-section">
      <div className="settings-section-title">Keybindings</div>
      <div className="settings-section-body">
        <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginBottom: 12 }}>
          Click <strong>Rebind</strong>, then press the target key combination. Changes save immediately and update the app menu.
        </div>
        <KeybindingsEditor />
      </div>
    </section>
  )
}
