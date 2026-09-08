import { useEffect, useRef, useState, useMemo } from 'react'

export interface Command {
  id: string
  label: string
  hint?: string
  group?: string
  run: () => void | Promise<void>
}

interface Props {
  open: boolean
  onClose: () => void
  commands: Command[]
}

export default function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // Autofocus on next tick to defeat any Enter-key propagation from the trigger
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    // Simple fuzzy: split query on whitespace, all tokens must appear in label
    const tokens = q.split(/\s+/)
    return commands.filter(c => {
      const hay = (c.label + ' ' + (c.hint ?? '') + ' ' + (c.group ?? '')).toLowerCase()
      return tokens.every(t => hay.includes(t))
    })
  }, [commands, query])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    if (!open) return
    const item = listRef.current?.querySelector(`[data-cmd-idx="${selected}"]`) as HTMLElement | null
    item?.scrollIntoView({ block: 'nearest' })
  }, [selected, open])

  if (!open) return null

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = filtered[selected]
      if (cmd) { onClose(); Promise.resolve(cmd.run()).catch(err => console.error('[vibe] command failed', err)) }
    }
  }

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="cmdk-empty">No matching commands</div>
          )}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              data-cmd-idx={i}
              className={`cmdk-item ${i === selected ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => { onClose(); c.run() }}
            >
              <div className="cmdk-item-body">
                <div className="cmdk-item-label">{c.label}</div>
                {c.hint && <div className="cmdk-item-hint">{c.hint}</div>}
              </div>
              {c.group && <div className="cmdk-item-group">{c.group}</div>}
            </div>
          ))}
        </div>
        <div className="cmdk-footer">
          <span>↑↓ navigate · Enter run · Esc close</span>
          <span>{filtered.length} of {commands.length}</span>
        </div>
      </div>
    </div>
  )
}
