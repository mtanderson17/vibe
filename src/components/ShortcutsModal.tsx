interface Group {
  title: string
  items: Array<{ keys: string; label: string }>
}

const isMac = navigator.platform.toLowerCase().includes('mac')
const mod = isMac ? '⌘' : 'Ctrl'

const GROUPS: Group[] = [
  {
    title: 'Global',
    items: [
      { keys: `${mod}+K`,   label: 'Open command palette' },
      { keys: `${mod}+/`,   label: 'Show this shortcuts sheet' },
      { keys: `${mod}+,`,   label: 'Open Settings' }
    ]
  },
  {
    title: 'Navigate views',
    items: [
      { keys: `${mod}+1`, label: 'Control Center' },
      { keys: `${mod}+2`, label: 'Tasks' },
      { keys: `${mod}+3`, label: 'Cost' },
      { keys: `${mod}+4`, label: 'Context' }
    ]
  },
  {
    title: 'Agents',
    items: [
      { keys: `${mod}+T`,   label: 'New agent' },
      { keys: `${mod}+W`,   label: 'Close current agent' },
      { keys: `${mod}+]`,   label: 'Focus next agent' },
      { keys: `${mod}+[`,   label: 'Focus previous agent' },
      { keys: `${mod}+.`,   label: 'Stop current agent (if running)' }
    ]
  },
  {
    title: 'PM agent',
    items: [
      { keys: `${mod}+Shift+R`, label: 'Regenerate project summary' }
    ]
  },
  {
    title: 'In-chat',
    items: [
      { keys: `${mod}+Enter`, label: 'Submit task / send reply' },
      { keys: 'Esc',          label: 'Cancel edit / dismiss modal' }
    ]
  }
]

export default function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <strong>Keyboard shortcuts</strong>
          <button onClick={onClose} style={{ fontSize: 11, padding: '3px 10px' }}>Close</button>
        </div>
        <div className="shortcuts-body">
          {GROUPS.map(g => (
            <div key={g.title} className="shortcuts-group">
              <div className="shortcuts-group-title">{g.title}</div>
              {g.items.map((item, i) => (
                <div key={i} className="shortcuts-row">
                  <span className="shortcuts-label">{item.label}</span>
                  <span className="shortcuts-keys">{item.keys.split('+').map((k, ki) => (
                    <kbd key={ki}>{k}</kbd>
                  ))}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="shortcuts-footer">
          These are also in the app menu (View / Agent / Help) and in the command palette.
        </div>
      </div>
    </div>
  )
}
