// Central keybinding registry. All customizable shortcuts live here so the
// menu, the Settings UI, and the ShortcutsModal all read from one source.
//
// User overrides live in config.keybindings (Record<id, accelerator>). Empty
// string in an override means "unbound" (menu item still exists, no shortcut).
//
// Accelerators use Electron's format: "CommandOrControl+Shift+K", "Ctrl+/",
// "Cmd+,". See https://www.electronjs.org/docs/latest/api/accelerator

export type KeybindingCategory = 'navigate' | 'agent' | 'pm' | 'help' | 'file'

export interface KeybindingSpec {
  id: string
  label: string
  category: KeybindingCategory
  defaultAccelerator: string   // uses "CommandOrControl" — Electron picks Cmd/Ctrl per platform
}

// Order here is the display order in Settings + ShortcutsModal.
export const KEYBINDINGS: KeybindingSpec[] = [
  // File
  { id: 'open-project',   label: 'Open project…',        category: 'file',     defaultAccelerator: 'CommandOrControl+O' },
  { id: 'settings',       label: 'Open Settings',        category: 'file',     defaultAccelerator: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,' },

  // Navigate
  { id: 'view-control',   label: 'Control Center',       category: 'navigate', defaultAccelerator: 'CommandOrControl+1' },
  { id: 'view-tasks',     label: 'Tasks',                category: 'navigate', defaultAccelerator: 'CommandOrControl+2' },
  { id: 'view-files',     label: 'Files',                category: 'navigate', defaultAccelerator: 'CommandOrControl+3' },
  { id: 'view-cost',      label: 'Cost',                 category: 'navigate', defaultAccelerator: 'CommandOrControl+4' },
  { id: 'view-context',   label: 'Context',              category: 'navigate', defaultAccelerator: 'CommandOrControl+5' },

  // Agents
  { id: 'new-agent',      label: 'New agent',            category: 'agent',    defaultAccelerator: 'CommandOrControl+T' },
  { id: 'close-agent',    label: 'Close current agent',  category: 'agent',    defaultAccelerator: 'CommandOrControl+W' },
  { id: 'focus-next',     label: 'Focus next agent',     category: 'agent',    defaultAccelerator: 'CommandOrControl+]' },
  { id: 'focus-prev',     label: 'Focus previous agent', category: 'agent',    defaultAccelerator: 'CommandOrControl+[' },
  { id: 'stop-current',   label: 'Stop current agent',   category: 'agent',    defaultAccelerator: 'CommandOrControl+.' },

  // PM
  { id: 'pm-regenerate',  label: 'Regenerate project summary', category: 'pm', defaultAccelerator: 'CommandOrControl+Shift+R' },

  // Help
  { id: 'palette',        label: 'Command palette',      category: 'help',     defaultAccelerator: 'CommandOrControl+K' },
  { id: 'shortcuts',      label: 'Keyboard shortcuts',   category: 'help',     defaultAccelerator: 'CommandOrControl+/' }
]

// Resolve the accelerator for a given command id given user overrides.
// Returns '' if the user has unbound it (menu item still renders but no accel).
export function resolveAccelerator(id: string, overrides: Record<string, string> | undefined): string {
  const spec = KEYBINDINGS.find(k => k.id === id)
  if (!spec) return ''
  const override = overrides?.[id]
  if (override === undefined) return spec.defaultAccelerator
  return override  // '' = unbound, non-empty = user's chosen accelerator
}

// Return the current effective accelerator for every spec — used by the
// Settings UI and the ShortcutsModal to render rows.
export function listResolvedBindings(overrides: Record<string, string> | undefined): Array<KeybindingSpec & { current: string }> {
  return KEYBINDINGS.map(spec => ({
    ...spec,
    current: resolveAccelerator(spec.id, overrides)
  }))
}
