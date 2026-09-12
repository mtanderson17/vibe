// Lightweight preferences store. Mirrors selected config fields so components
// can read them without prop-drilling. Loads once on app boot (see App.tsx).

import { create } from 'zustand'

interface PrefsStore {
  submitOnEnter: boolean
  loaded: boolean
  load: () => Promise<void>
  setSubmitOnEnter: (value: boolean) => Promise<void>
}

export const usePrefs = create<PrefsStore>((set) => ({
  submitOnEnter: true,   // default: chat-style Enter=send
  loaded: false,
  load: async () => {
    const cfg = await window.vibe.config.get()
    set({ submitOnEnter: cfg.submitOnEnter ?? true, loaded: true })
  },
  setSubmitOnEnter: async (value) => {
    await window.vibe.config.set({ submitOnEnter: value })
    set({ submitOnEnter: value })
  }
}))

// Hook that returns a submit-key matcher + a hint string for placeholders,
// based on the current preference. `isSubmit(e)` returns true if the event
// should trigger a form submit.
const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

export function useSubmitKey(): {
  isSubmit: (e: React.KeyboardEvent | KeyboardEvent) => boolean
  hint: string
} {
  const submitOnEnter = usePrefs(s => s.submitOnEnter)
  if (submitOnEnter) {
    return {
      isSubmit: (e) => e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey,
      hint: 'Enter to send · Shift+Enter for newline'
    }
  }
  return {
    isSubmit: (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey),
    hint: `${isMac ? '⌘' : 'Ctrl'}+Enter to send`
  }
}
