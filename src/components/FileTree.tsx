// Lazy workspace file tree. Directories load their children on first expand
// (and stay in memory afterward). No file watching yet — click the refresh
// button on FilesView to reload after external changes.

import { useCallback, useEffect, useState, memo } from 'react'
import Icon from '../Icon'

export interface Entry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
}

interface Props {
  activePath: string | null
  onOpenFile: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, entry: Entry | null) => void  // entry=null means empty-space (workspace root)
}

export default function FileTree({ activePath, onOpenFile, onContextMenu }: Props) {
  const [rootEntries, setRootEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const entries = await window.vibe.files.list('.')
      setRootEntries(entries)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (error) return <div className="file-tree-error">Failed to load: {error}</div>
  if (!rootEntries) return <div className="file-tree-loading">Loading…</div>

  return (
    <div
      className="file-tree"
      onContextMenu={(e) => {
        // Only fire empty-space handler if the click landed on the container itself,
        // not bubbled from a child row.
        if (e.target === e.currentTarget && onContextMenu) {
          e.preventDefault()
          onContextMenu(e, null)
        }
      }}
    >
      {rootEntries.map(e => (
        <TreeNode key={e.path} entry={e} depth={0} activePath={activePath} onOpenFile={onOpenFile} onContextMenu={onContextMenu} />
      ))}
      {/* filler to catch empty-space right-clicks below the tree */}
      <div
        style={{ minHeight: 120 }}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault()
            onContextMenu(e, null)
          }
        }}
      />
    </div>
  )
}

// Each directory node fetches its own children on expand. Files just render a row.
const TreeNode = memo(function TreeNode({
  entry, depth, activePath, onOpenFile, onContextMenu
}: {
  entry: Entry
  depth: number
  activePath: string | null
  onOpenFile: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, entry: Entry | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<Entry[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (entry.kind !== 'dir') return
    const next = !expanded
    setExpanded(next)
    if (next && !children) {
      setLoading(true)
      try {
        const list = await window.vibe.files.list(entry.path)
        setChildren(list)
      } catch { /* leave collapsed */ }
      finally { setLoading(false) }
    }
  }

  const isActive = entry.kind === 'file' && activePath === entry.path
  const indent = 4 + depth * 12

  return (
    <>
      <div
        className={`file-tree-row ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={() => entry.kind === 'dir' ? toggle() : onOpenFile(entry.path)}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault()
            e.stopPropagation()
            onContextMenu(e, entry)
          }
        }}
        title={entry.path}
      >
        <span className="file-tree-caret">
          {entry.kind === 'dir' ? (expanded ? '▾' : '▸') : ' '}
        </span>
        <span className="file-tree-icon">
          <Icon name={entry.kind === 'dir' ? 'note' : 'note'} size={12} />
        </span>
        <span className="file-tree-name">{entry.name}</span>
      </div>
      {entry.kind === 'dir' && expanded && (
        loading ? <div className="file-tree-loading" style={{ paddingLeft: indent + 16 }}>…</div>
          : children?.map(c => (
            <TreeNode key={c.path} entry={c} depth={depth + 1} activePath={activePath} onOpenFile={onOpenFile} onContextMenu={onContextMenu} />
          ))
      )}
    </>
  )
})
