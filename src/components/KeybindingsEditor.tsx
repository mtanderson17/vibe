// Settings pane for rebinding shortcuts. Click a row's "Rebind" button, then
// press the target key combo. Esc cancels. The captured combo becomes the new
// accelerator; the app menu is rebuilt immediately in the main process.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ResolvedKeybinding } from '../types'

// Turn a KeyboardEvent into Electron's accelerator format.
// Returns '' if the event has no non-modifier key (e.g. user just pressed Cmd).
function eventToAccelerator(e: KeyboardEvent): string {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const parts: string[] = []
  if (e.ctrlKey || (isMac && e.metaKey)) parts.push('CommandOrControl')
  if (e.altKey)   parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // Skip if user only pressed modifier keys (Meta/Ctrl/Alt/Shift alone)
  const bareModifiers = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'])
  if (bareModifiers.has(e.key)) return ''

  // Map special keys to Electron names
  const specialMap: Record<string, string> = {
    ' ': 'Space',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Escape': 'Esc',
    'Enter': 'Return',
    'Tab': 'Tab',
    'Backspace': 'Backspace',
    'Delete': 'Delete'
  }
  let key = specialMap[e.key] ?? e.key
  // Single letters → uppercase for the accelerator format
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

function displayAccelerator(accel: string): string {
  if (!accel) return '—'
  const isMac = navigator.platform.toLowerCase().includes('mac')
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
  pm: 'PM',
  help: 'Help'
}

export default function KeybindingsEditor() {
  const [bindings, setBindings] = useState<ResolvedKeybinding[]>([])
  const [listeningFor, setListeningFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBindings(await window.vibe.keybindings.list())
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!listeningFor) return
    const id: string = listeningFor  // narrowed for closure
    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setListeningFor(null)
        return
      }
      const accel = eventToAccelerator(e)
      if (!accel) return  // waiting for a non-modifier key
      // Warn on conflicts (same accelerator already used by another binding)
      const conflict = bindings.find(b => b.id !== id && b.current === accel)
      if (conflict && !confirm(`"${displayAccelerator(accel)}" is already bound to "${conflict.label}". Reassign?`)) {
        setListeningFor(null)
        return
      }
      window.vibe.keybindings.set(id, accel)
        .then(setBindings)
        .catch(err => setError((err as Error).message))
        .finally(() => setListeningFor(null))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listeningFor, bindings])

  const grouped = useMemo(() => {
    const g: Record<string, ResolvedKeybinding[]> = {}
    for (const b of bindings) {
      if (!g[b.category]) g[b.category] = []
      g[b.category].push(b)
    }
    return g
  }, [bindings])

  async function resetOne(id: string) {
    setBindings(await window.vibe.keybindings.reset(id))
  }
  async function resetAll() {
    if (!confirm('Reset all keybindings to their defaults?')) return
    setBindings(await window.vibe.keybindings.reset())
  }

  return (
    <div>
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="kb-group">
          <div className="kb-group-title">{CATEGORY_LABELS[cat] ?? cat}</div>
          {items.map(b => {
            const isListening = listeningFor === b.id
            const modified = b.current !== b.defaultAccelerator
            return (
              <div key={b.id} className="kb-row">
                <div className="kb-label">
                  {b.label}
                  {modified && <span className="kb-modified" title="Modified from default">•</span>}
                </div>
                <div className="kb-current">
                  {isListening
                    ? <span className="kb-listening">press keys… (Esc to cancel)</span>
                    : <kbd className="kb-accel">{displayAccelerator(b.current)}</kbd>}
                </div>
                <div className="kb-actions">
                  <button onClick={() => setListeningFor(isListening ? null : b.id)}>
                    {isListening ? 'Cancel' : 'Rebind'}
                  </button>
                  {modified && !isListening && (
                    <button onClick={() => resetOne(b.id)} title="Reset to default">Reset</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <button onClick={resetAll}>Reset all to defaults</button>
      </div>
    </div>
  )
}
