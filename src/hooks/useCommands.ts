// Builds the command-palette list. Kept out of App.tsx because it's a long,
// mostly-declarative block that churns whenever a feature is added, and it has
// no state of its own — it's a pure projection of agents + config + handlers.

import { useMemo } from 'react'
import type { Command } from '../components/CommandPalette'
import type { AgentState, Config, SidebarView } from '../types'

const MOD = typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'

export interface CommandActions {
  agentIds: string[]
  agentSummaries: Record<string, AgentState>
  atAgentCap: boolean
  config: Config | null
  spawnAgent: () => void
  closeAgent: (id: string) => void
  setSidebarView: (view: SidebarView) => void
  setFocusedAgent: (id: string | null) => void
  openNewTask: () => void
  openShortcuts: () => void
}

export function useCommands(actions: CommandActions): Command[] {
  const {
    agentIds, agentSummaries, atAgentCap, config,
    spawnAgent, closeAgent, setSidebarView, setFocusedAgent, openNewTask, openShortcuts
  } = actions

  return useMemo(() => {
    const cmds: Command[] = []
    const goTo = (view: SidebarView) => () => { setSidebarView(view); setFocusedAgent(null) }

    // Views
    cmds.push({ id: 'view.control',  label: 'Go to Control Center', group: 'Navigate', run: goTo('control') })
    cmds.push({ id: 'view.tasks',    label: 'Go to Tasks',          group: 'Navigate', run: goTo('tasks') })
    cmds.push({ id: 'view.files',    label: 'Go to Files',          group: 'Navigate', run: goTo('files') })
    cmds.push({ id: 'view.cost',     label: 'Go to Cost',           group: 'Navigate', run: goTo('cost') })
    cmds.push({ id: 'view.context',  label: 'Go to Context',        group: 'Navigate', run: goTo('context') })
    cmds.push({ id: 'view.settings', label: 'Open Settings',        group: 'Navigate', run: () => setSidebarView('settings') })

    // Per-agent commands
    for (const id of agentIds) {
      const a = agentSummaries[id]
      const label = a?.displayName || id
      cmds.push({
        id: `focus.${id}`,
        label: `Focus ${label}`,
        hint: a?.status ? `Status: ${a.status}` : undefined,
        group: 'Agents',
        run: () => { setSidebarView('control'); setFocusedAgent(id) }
      })
      if (a?.status === 'running') {
        cmds.push({ id: `kill.${id}`, label: `Stop ${label}`, group: 'Agents', run: () => { window.vibe.agents.kill(id) } })
      }
      cmds.push({
        id: `close.${id}`,
        label: `Close ${label}`,
        hint: 'removes worktree + branch',
        group: 'Agents',
        run: () => closeAgent(id)
      })
    }

    if (!atAgentCap) {
      cmds.push({ id: 'spawn', label: 'New agent', group: 'Agents', run: spawnAgent })
    }

    // Tasks
    cmds.push({ id: 'task.new', label: 'New task…', group: 'Tasks', run: openNewTask })

    // PM
    cmds.push({ id: 'pm.regenerate', label: 'Regenerate project summary (PM)', group: 'PM', run: () => { window.vibe.pm.run('manual') } })
    cmds.push({ id: 'pm.clear',      label: 'Clear PM chat',                   group: 'PM', run: () => { window.vibe.pm.clear() } })

    // Project switcher
    cmds.push({
      id: 'project.open',
      label: 'Open project…',
      hint: `${MOD}+O`,
      group: 'Project',
      run: () => { window.vibe.workspace.switch() }
    })
    for (const path of (config?.recentWorkspaces ?? []).slice(0, 8)) {
      if (path === config?.workspacePath) continue
      cmds.push({
        id: `project.open.${path}`,
        label: `Open recent: ${path.split(/[\\/]/).slice(-2).join('/')}`,
        hint: path,
        group: 'Project',
        run: () => { window.vibe.workspace.switch(path) }
      })
    }

    // Help
    cmds.push({ id: 'help.shortcuts', label: 'Show keyboard shortcuts', hint: `${MOD}+/`, group: 'Help', run: openShortcuts })

    return cmds
  }, [
    agentIds, agentSummaries, atAgentCap, config,
    spawnAgent, closeAgent, setSidebarView, setFocusedAgent, openNewTask, openShortcuts
  ])
}
