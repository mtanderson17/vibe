// Simple absolute-positioned context menu. Closes on any outside click,
// Escape, or item selection. Position clamps to the viewport so it doesn't
// spawn under the taskbar / off-screen edges.

import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp to viewport (menu is ~180px wide, item ~28px tall).
  const menuW = 180
  const menuH = items.length * 28 + 8
  const left = Math.min(x, window.innerWidth - menuW - 8)
  const top = Math.min(y, window.innerHeight - menuH - 8)

  return (
    <div ref={ref} className="context-menu" style={{ left, top }}>
      {items.map((it, i) => (
        <div
          key={i}
          className={`context-menu-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}`}
          onClick={() => {
            if (it.disabled) return
            it.onSelect()
            onClose()
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  )
}
