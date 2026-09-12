// Top-level "Files" view. Left: workspace tree. Right: tab bar + Monaco editor.
// Multiple files can be open at once; each tracks its own dirty state.
// Cmd/Ctrl+S saves the active tab. Closing a dirty tab prompts.
//
// Tab/active state lives in useFiles (Zustand) so navigating to another top-
// level view doesn't blow away the user's open tabs.

import { useCallback, useState } from 'react'
import FileTree, { type Entry } from './components/FileTree'
import MonacoEditor, { detectLanguage } from './components/MonacoEditor'
import ContextMenu, { type MenuItem } from './components/ContextMenu'
import { useFiles } from './stores/files'

export default function FilesView() {
  const openFiles = useFiles(s => s.open)
  const activePath = useFiles(s => s.activePath)
  const setActive = useFiles(s => s.setActive)
  const addFile = useFiles(s => s.add)
  const updateFile = useFiles(s => s.update)
  const removeFile = useFiles(s => s.remove)

  const [saveError, setSaveError] = useState<string | null>(null)
  const [treeVersion, setTreeVersion] = useState(0)  // bump to force tree reload after create
  const [draft, setDraft] = useState<{ kind: 'file' | 'folder'; value: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry | null } | null>(null)

  const active = openFiles.find(f => f.path === activePath) ?? null

  const openFile = useCallback(async (path: string) => {
    setSaveError(null)
    if (openFiles.some(f => f.path === path)) {
      setActive(path)
      return
    }
    try {
      const res = await window.vibe.files.read(path)
      addFile({
        path,
        original: res.content,
        current: res.content,
        binary: res.binary,
        truncated: res.truncated
      })
    } catch (e) {
      addFile({ path, original: '', current: '', binary: false, truncated: false, loadError: (e as Error).message })
    }
  }, [openFiles, setActive, addFile])

  const closeFile = useCallback((path: string) => {
    const f = openFiles.find(x => x.path === path)
    if (f && f.current !== f.original) {
      if (!confirm(`Discard unsaved changes to ${path}?`)) return
    }
    removeFile(path)
  }, [openFiles, removeFile])

  const updateActive = useCallback((value: string) => {
    if (activePath) updateFile(activePath, { current: value })
  }, [activePath, updateFile])

  const saveActive = useCallback(async () => {
    if (!active || active.binary || active.loadError) return
    if (active.current === active.original) return
    try {
      setSaveError(null)
      await window.vibe.files.write(active.path, active.current)
      updateFile(active.path, { original: active.current })
    } catch (e) {
      setSaveError((e as Error).message)
    }
  }, [active, updateFile])

  const submitDraft = useCallback(async () => {
    if (!draft) return
    const rel = draft.value.trim().replace(/^[/\\]+/, '')
    if (!rel) { setDraft(null); return }
    try {
      if (draft.kind === 'folder') {
        await window.vibe.files.mkdir(rel)
        setTreeVersion(v => v + 1)
        setDraft(null)
        return
      }
      if (openFiles.some(f => f.path === rel)) { setActive(rel); setDraft(null); return }
      const existing = await window.vibe.files.read(rel).catch(() => null)
      if (existing) {
        addFile({ path: rel, original: existing.content, current: existing.content, binary: existing.binary, truncated: existing.truncated })
        setDraft(null)
        return
      }
      await window.vibe.files.write(rel, '')
      addFile({ path: rel, original: '', current: '', binary: false, truncated: false })
      setTreeVersion(v => v + 1)
      setDraft(null)
    } catch (e) {
      setSaveError((e as Error).message)
      setDraft(null)
    }
  }, [draft, openFiles, addFile, setActive])

  // Derive "where should a new item be created?" from the right-clicked entry.
  // Right-click on a file → its parent dir. On a dir → inside that dir. On
  // empty space → workspace root.
  function dirPrefixFor(entry: Entry | null): string {
    if (!entry) return ''
    if (entry.kind === 'dir') return entry.path + '/'
    const idx = entry.path.lastIndexOf('/')
    return idx >= 0 ? entry.path.slice(0, idx + 1) : ''
  }

  const menuItems: MenuItem[] = menu ? [
    { label: 'New file…',   onSelect: () => setDraft({ kind: 'file',   value: dirPrefixFor(menu.entry) }) },
    { label: 'New folder…', onSelect: () => setDraft({ kind: 'folder', value: dirPrefixFor(menu.entry) }) },
    { label: 'Refresh',     onSelect: () => setTreeVersion(v => v + 1) }
  ] : []

  return (
    <div className="screen files-screen">
      <div className="files-layout">
        <aside className="files-tree-pane">
          <div className="files-tree-header">
            <span>Workspace</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="files-tree-btn" onClick={() => setDraft({ kind: 'file', value: '' })} title="New file">＋</button>
              <button className="files-tree-btn" onClick={() => setTreeVersion(v => v + 1)} title="Refresh">↻</button>
            </div>
          </div>
          {draft !== null && (
            <div className="new-file-inline">
              <input
                autoFocus
                type="text"
                placeholder={draft.kind === 'folder' ? 'path/to/newfolder' : 'path/to/newfile.py'}
                value={draft.value}
                onChange={(e) => setDraft({ kind: draft.kind, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitDraft() }
                  if (e.key === 'Escape') { e.preventDefault(); setDraft(null) }
                }}
                onBlur={() => { if (draft.value.trim()) submitDraft(); else setDraft(null) }}
              />
              <div className="new-file-hint">
                {draft.kind === 'folder' ? 'New folder' : 'New file'} · Enter to create · Esc to cancel
              </div>
            </div>
          )}
          <FileTree
            key={treeVersion}
            activePath={activePath}
            onOpenFile={openFile}
            onContextMenu={(e, entry) => setMenu({ x: e.clientX, y: e.clientY, entry })}
          />
        </aside>

        <section className="files-editor-pane">
          <div className="editor-tabs">
            {openFiles.length === 0 && (
              <div className="editor-tabs-empty">Open a file from the tree to start editing.</div>
            )}
            {openFiles.map(f => {
              const dirty = f.current !== f.original
              const short = f.path.split('/').pop() ?? f.path
              return (
                <div
                  key={f.path}
                  className={`editor-tab ${activePath === f.path ? 'active' : ''}`}
                  onClick={() => setActive(f.path)}
                  title={f.path}
                >
                  <span className="editor-tab-name">{short}</span>
                  {dirty && <span className="editor-tab-dirty" title="Unsaved changes">●</span>}
                  <button
                    className="editor-tab-close"
                    onClick={(e) => { e.stopPropagation(); closeFile(f.path) }}
                    title="Close"
                  >×</button>
                </div>
              )
            })}
          </div>

          {saveError && (
            <div className="editor-save-error">Save failed: {saveError}</div>
          )}

          <div className="editor-body">
            {!active ? (
              <div className="editor-placeholder">
                <div style={{ fontSize: 13, marginBottom: 6 }}>No file open</div>
                <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>
                  Pick a file from the tree · Cmd/Ctrl+S to save
                </div>
              </div>
            ) : active.loadError ? (
              <div className="editor-placeholder">
                <div style={{ color: 'var(--red)', fontSize: 13 }}>Could not read: {active.loadError}</div>
              </div>
            ) : active.binary ? (
              <div className="editor-placeholder">
                <div style={{ fontSize: 13, marginBottom: 6 }}>Binary file</div>
                <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{active.path}</div>
              </div>
            ) : (
              <>
                {active.truncated && (
                  <div className="editor-truncation-banner">
                    File is very large — showing only the first 4 MB. Saving will overwrite the file with just this portion, so treat it as read-only.
                  </div>
                )}
                <MonacoEditor
                  value={active.current}
                  language={detectLanguage(active.path)}
                  readOnly={active.truncated}
                  onChange={updateActive}
                  onSave={saveActive}
                />
              </>
            )}
          </div>
        </section>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
