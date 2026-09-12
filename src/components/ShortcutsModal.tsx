// Read-only overlay that shows the current keybindings. Sources them from
// the main-process registry (respects user overrides) so it always agrees
// with what's actually wired into the menu.

import { useEffect, useState } from 'react'
import type { ResolvedKeybinding } from '../types'

const isMac = navigator.platform.toLowerCase().includes('mac')

function displayAccelerator(accel: string): string {
  if (!accel) return '—'
  return accel
    .replace(/CommandOrControl|CmdOrCtrl/g, isMac ? '⌘' : 'Ctrl')
    .replace(/Cmd\b/g, '⌘')
    .replace(/Shift/g, isMac ? '⇧' : 'Shift')
    .replace(/Alt|Option/g, isMac ? '⌥' : 'Alt')
    .replace(/Ctrl/g, isMac ? '⌃' : 'Ctrl')
}

const CATEGORY_LABELS: Record<string, string> = {
  file: 'File',
  navigate: 'Navigate',
  agent: 'Agents',
  pm: 'PM agent',
  help: 'Help'
}

export default function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [bindings, setBindings] = useState<ResolvedKeybinding[]>([])

  useEffect(() => {
    if (!open) return
    window.vibe.keybindings.list().then(setBindings)
  }, [open])

  if (!open) return null

  const groups: Record<string, ResolvedKeybinding[]> = {}
  for (const b of bindings) {
    if (!groups[b.category]) groups[b.category] = []
    groups[b.category].push(b)
  }

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <strong>Keyboard shortcuts</strong>
          <button onClick={onClose} style={{ fontSize: 11, padding: '3px 10px' }}>Close</button>
        </div>
        <div className="shortcuts-body">
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat} className="shortcuts-group">
              <div className="shortcuts-group-title">{CATEGORY_LABELS[cat] ?? cat}</div>
              {items.map(b => (
                <div key={b.id} className="shortcuts-row">
                  <span className="shortcuts-label">{b.label}</span>
                  <span className="shortcuts-keys">
                    {b.current
                      ? displayAccelerator(b.current).split('+').map((k, ki) => <kbd key={ki}>{k}</kbd>)
                      : <span style={{ opacity: 0.5, fontSize: 11 }}>(unbound)</span>}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <div className="shortcuts-group">
            <div className="shortcuts-group-title">In-chat</div>
            <div className="shortcuts-row">
              <span className="shortcuts-label">Submit task / send reply</span>
              <span className="shortcuts-keys"><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd>Enter</kbd></span>
            </div>
            <div className="shortcuts-row">
              <span className="shortcuts-label">Cancel edit / dismiss modal</span>
              <span className="shortcuts-keys"><kbd>Esc</kbd></span>
            </div>
          </div>
        </div>
        <div className="shortcuts-footer">
          Customize these in Settings → Keybindings.
        </div>
      </div>
    </div>
  )
}
