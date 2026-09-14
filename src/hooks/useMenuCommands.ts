// Bridges the native app menu to renderer state.
//
// Every customizable shortcut is owned by the main process (see menu.ts +
// keybindings.ts) and arrives here as an IPC channel name. That's deliberate:
// it means a user's keybinding override applies without the renderer knowing
// anything about accelerators. Adding a shortcut means adding it to
// KEYBINDINGS and handling its channel here — never a local keydown listener.

import { useEffect } from 'react'
import type { SidebarView } from '../types'

export interface MenuCommandActions {
  agentIds: string[]
  focusedAgent: string | null
  spawnAgent: () => void
  closeAgent: (id: string) => void
  setSidebarView: (view: SidebarView) => void
  setFocusedAgent: (id: string | null) => void
  openNewTask: () => void
  openShortcuts: () => void
  togglePalette: () => void
}

export function useMenuCommands(actions: MenuCommandActions): void {
  const {
    agentIds, focusedAgent, spawnAgent, closeAgent,
    setSidebarView, setFocusedAgent, openNewTask, openShortcuts, togglePalette
  } = actions

  useEffect(() => {
    const off = window.vibe.onMenuCommand((channel, ...args) => {
      switch (channel) {
        case 'menu:new-agent':   spawnAgent(); break
        case 'menu:new-task':    openNewTask(); break
        case 'menu:close-agent': if (focusedAgent) closeAgent(focusedAgent); break
        case 'menu:settings':    setSidebarView('settings'); break
        case 'menu:shortcuts':   openShortcuts(); break
        case 'menu:palette':     togglePalette(); break
        case 'menu:view': {
          setSidebarView(args[0] as SidebarView)
          setFocusedAgent(null)
          break
        }
        case 'menu:focus-next':
        case 'menu:focus-prev': {
          if (!agentIds.length) break
          const step = channel === 'menu:focus-next' ? 1 : -1
          const cur = agentIds.indexOf(focusedAgent ?? '')
          const next = (cur + step + agentIds.length) % agentIds.length
          setSidebarView('control')
          setFocusedAgent(agentIds[next])
          break
        }
        case 'menu:stop-current':
          if (focusedAgent) window.vibe.agents.kill(focusedAgent)
          break
        case 'menu:pm-regenerate':
          window.vibe.pm.run('manual')
          break
        case 'menu:open-project': {
          const path = typeof args[0] === 'string' ? args[0] as string : undefined
          window.vibe.workspace.switch(path).catch(err => console.error('[vibe] open project failed', err))
          break
        }
      }
    })
    return off
  }, [
    agentIds, focusedAgent, spawnAgent, closeAgent,
    setSidebarView, setFocusedAgent, openNewTask, openShortcuts, togglePalette
  ])
}
