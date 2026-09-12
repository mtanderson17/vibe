// Open-files state, held above FilesView so tabs survive navigation to other
// top-level views. Not persisted across app restarts — that's intentional for
// now (avoids stale references to files that were deleted while Vibe was off).

import { create } from 'zustand'

export interface OpenFile {
  path: string
  original: string
  current: string
  binary: boolean
  truncated: boolean
  loadError?: string
}

interface FilesStore {
  open: OpenFile[]
  activePath: string | null
  setActive: (path: string | null) => void
  add: (file: OpenFile) => void
  update: (path: string, patch: Partial<OpenFile>) => void
  remove: (path: string) => void
  reset: () => void
}

export const useFiles = create<FilesStore>((set) => ({
  open: [],
  activePath: null,
  setActive: (path) => set({ activePath: path }),
  add: (file) => set(state => {
    if (state.open.some(f => f.path === file.path)) return { activePath: file.path }
    return { open: [...state.open, file], activePath: file.path }
  }),
  update: (path, patch) => set(state => ({
    open: state.open.map(f => f.path === path ? { ...f, ...patch } : f)
  })),
  remove: (path) => set(state => {
    const idx = state.open.findIndex(f => f.path === path)
    const next = state.open.filter(f => f.path !== path)
    let nextActive = state.activePath
    if (state.activePath === path) {
      const neighbor = next[idx] ?? next[idx - 1] ?? null
      nextActive = neighbor?.path ?? null
    }
    return { open: next, activePath: nextActive }
  }),
  reset: () => set({ open: [], activePath: null })
}))
