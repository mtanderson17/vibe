import { useEffect, useState, useMemo, memo, useCallback } from 'react'
import type { Config } from './types'
import { useAgents } from './stores/agents'
import Setup from './Setup'
import AgentPanel from './AgentPanel'
import ContextView from './ContextView'
import CostView from './CostView'
import TasksView from './TasksView'
import ControlCenter from './ControlCenter'
import Icon, { type IconName } from './Icon'
import CommandPalette, { type Command } from './components/CommandPalette'
import ShortcutsModal from './components/ShortcutsModal'

type SidebarView = 'control' | 'tasks' | 'cost' | 'context' | 'settings'

interface ApprovalReq {
  id: string
  agentId: string
  command: string
  reason: string
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [sidebarView, setSidebarView] = useState<SidebarView>('control')
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null)
  const [approvals, setApprovals] = useState<ApprovalReq[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const agentSummaries = useAgents(s => s.agents)
  const applyEvent = useAgents(s => s.applyEvent)
  const hydrate = useAgents(s => s.hydrate)
  const addAgent = useAgents(s => s.addAgent)
  const removeAgent = useAgents(s => s.removeAgent)

  useEffect(() => {
    window.vibe.config.get().then(setConfig)
  }, [])

  useEffect(() => {
    window.vibe.agents.list().then(list => {
      if (list?.length) hydrate(list)
    })
  }, [hydrate, config?.workspacePath])

  useEffect(() => {
    const off = window.vibe.onAgentEvent(applyEvent)
    return off
  }, [applyEvent])

  useEffect(() => {
    const off = window.vibe.onApprovalRequest(req => {
      setApprovals(prev => [...prev, req])
    })
    return off
  }, [])

  // Cmd+K to open the command palette; Cmd+/ shortcuts help.
  // Other shortcuts are wired via the app menu (see menu.ts) which delivers via onMenuCommand.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShortcutsOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function respondApproval(id: string, approved: boolean) {
    setApprovals(prev => prev.filter(a => a.id !== id))
    await window.vibe.approval.respond(id, approved)
  }

  const agentIds = useMemo(() => {
    return Object.keys(agentSummaries).sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, '')) || 0
      const nb = parseInt(b.replace(/\D/g, '')) || 0
      return na - nb
    })
  }, [agentSummaries])

  const atAgentCap = agentIds.length >= (config?.agentCount ?? 4)

  async function handleSpawn() {
    if (atAgentCap) return
    const newAgent = await window.vibe.agents.spawn()
    addAgent(newAgent)
    setFocusedAgent(newAgent.id)
    setSidebarView('control')
  }

  const handleClose = useCallback(async (id: string) => {
    const a = agentSummaries[id]
    if (a && a.status !== 'idle') {
      if (!confirm(`Close ${id}? Any in-flight work, worktree, and branch will be cleaned up.`)) return
    }
    removeAgent(id)
    if (focusedAgent === id) setFocusedAgent(null)
    window.vibe.agents.close(id).catch(err => console.error('[vibe] close failed', err))
  }, [agentSummaries, focusedAgent, removeAgent])

  const handleFocus = useCallback((id: string) => setFocusedAgent(id), [])

  // Menu commands (from the native app menu). Placed after agentIds/handleClose/handleSpawn
  // declarations to satisfy TDZ in the closure.
  useEffect(() => {
    const off = window.vibe.onMenuCommand((channel, ...args) => {
      switch (channel) {
        case 'menu:new-agent':      handleSpawn(); break
        case 'menu:close-agent':    if (focusedAgent) handleClose(focusedAgent); break
        case 'menu:settings':       setSidebarView('settings'); break
        case 'menu:view': {
          const view = args[0] as SidebarView
          setSidebarView(view); setFocusedAgent(null); break
        }
        case 'menu:focus-next': {
          const cur = agentIds.indexOf(focusedAgent ?? '')
          if (agentIds.length) { setSidebarView('control'); setFocusedAgent(agentIds[(cur + 1) % agentIds.length]) }
          break
        }
        case 'menu:focus-prev': {
          const cur = agentIds.indexOf(focusedAgent ?? '')
          if (agentIds.length) {
            setSidebarView('control')
            setFocusedAgent(agentIds[(cur - 1 + agentIds.length) % agentIds.length])
          }
          break
        }
        case 'menu:stop-current':
          if (focusedAgent) window.vibe.agents.kill(focusedAgent)
          break
        case 'menu:pm-regenerate': window.vibe.pm.run('manual'); break
        case 'menu:shortcuts':     setShortcutsOpen(true); break
        case 'menu:palette':       setPaletteOpen(prev => !prev); break
        case 'menu:open-project': {
          const path = typeof args[0] === 'string' ? args[0] as string : undefined
          window.vibe.workspace.switch(path).catch(err => console.error('[vibe] open project failed', err))
          break
        }
      }
    })
    return off
  }, [agentIds, focusedAgent, handleClose, handleSpawn])

  // Reload the app when workspace switches — cheapest way to reset all view state
  useEffect(() => {
    const off = window.vibe.onWorkspaceSwitched(() => {
      window.location.reload()
    })
    return off
  }, [])

  const commands: Command[] = useMemo(() => {
    const cmds: Command[] = []

    // Views
    cmds.push({ id: 'view.control', label: 'Go to Control Center', group: 'Navigate', run: () => { setSidebarView('control'); setFocusedAgent(null) } })
    cmds.push({ id: 'view.tasks',   label: 'Go to Tasks',          group: 'Navigate', run: () => { setSidebarView('tasks'); setFocusedAgent(null) } })
    cmds.push({ id: 'view.cost',    label: 'Go to Cost',           group: 'Navigate', run: () => { setSidebarView('cost'); setFocusedAgent(null) } })
    cmds.push({ id: 'view.context', label: 'Go to Context',        group: 'Navigate', run: () => { setSidebarView('context'); setFocusedAgent(null) } })
    cmds.push({ id: 'view.settings', label: 'Open Settings',       group: 'Navigate', run: () => setSidebarView('settings') })

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
        cmds.push({
          id: `kill.${id}`,
          label: `Stop ${label}`,
          group: 'Agents',
          run: () => { window.vibe.agents.kill(id) }
        })
      }
      cmds.push({
        id: `close.${id}`,
        label: `Close ${label}`,
        hint: 'removes worktree + branch',
        group: 'Agents',
        run: () => handleClose(id)
      })
    }

    // Spawn
    if (!atAgentCap) {
      cmds.push({ id: 'spawn', label: 'New agent', group: 'Agents', run: handleSpawn })
    }

    // PM
    cmds.push({ id: 'pm.regenerate', label: 'Regenerate project summary (PM)', group: 'PM', run: () => { window.vibe.pm.run('manual') } })
    cmds.push({ id: 'pm.clear', label: 'Clear PM chat', group: 'PM', run: () => { window.vibe.pm.clear() } })

    // Project switcher
    cmds.push({
      id: 'project.open',
      label: 'Open project…',
      hint: `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+O`,
      group: 'Project',
      run: () => { window.vibe.workspace.switch() }
    })
    for (const path of (config?.recentWorkspaces ?? []).slice(0, 8)) {
      if (path === config?.workspacePath) continue
      const short = path.split(/[\\/]/).slice(-2).join('/')
      cmds.push({
        id: `project.open.${path}`,
        label: `Open recent: ${short}`,
        hint: path,
        group: 'Project',
        run: () => { window.vibe.workspace.switch(path) }
      })
    }

    // Help
    cmds.push({ id: 'help.shortcuts', label: 'Show keyboard shortcuts', hint: `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+/`, group: 'Help', run: () => setShortcutsOpen(true) })

    return cmds
  }, [agentIds, agentSummaries, atAgentCap, handleClose, handleSpawn, config])

  if (!config) return null

  const hasAnyKey = !!(
    config.openrouterApiKey || config.anthropicApiKey || config.openaiApiKey ||
    config.geminiApiKey || config.groqApiKey || config.xaiApiKey
  )
  const missingCreds = !config.workspacePath || (!hasAnyKey && !config.model.startsWith('ollama/'))
  if (missingCreds) {
    return <Setup config={config} onSaved={setConfig} />
  }

  if (sidebarView === 'settings') {
    return <Setup config={config} onSaved={(c) => { setConfig(c); setSidebarView('control') }} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">VIBE</div>
        <div className="sidebar-nav">
          <SidebarItem icon="grid" label="Control Center" active={sidebarView === 'control'} onClick={() => { setSidebarView('control'); setFocusedAgent(null) }} />
          <SidebarItem icon="list" label="Tasks" active={sidebarView === 'tasks'} onClick={() => { setSidebarView('tasks'); setFocusedAgent(null) }} />
          <SidebarItem icon="coin" label="Cost" active={sidebarView === 'cost'} onClick={() => { setSidebarView('cost'); setFocusedAgent(null) }} />
          <SidebarItem icon="note" label="Context" active={sidebarView === 'context'} onClick={() => { setSidebarView('context'); setFocusedAgent(null) }} />
        </div>
        <div className="sidebar-footer">
          <button onClick={() => setSidebarView('settings')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="settings" size={14} />
            <span>Settings</span>
          </button>
          <div
            className="sidebar-workspace"
            title={`Click to switch project · ${config.workspacePath ?? ''}`}
            onClick={() => window.vibe.workspace.switch()}
            style={{ cursor: 'pointer' }}
          >
            {config.workspacePath?.split(/[\\/]/).slice(-2).join('/')}
          </div>
        </div>
      </aside>

      <main className="main">
        {sidebarView === 'control' && (
          <>
            <div className="agent-tabbar">
              {agentIds.map(id => (
                <AgentTab
                  key={id}
                  id={id}
                  active={focusedAgent === id}
                  onFocus={handleFocus}
                  onClose={handleClose}
                />
              ))}
              <button
                className="agent-tab-add"
                onClick={handleSpawn}
                disabled={atAgentCap}
                title={atAgentCap ? `Reached max of ${config.agentCount} agents (change in Settings)` : 'Add agent'}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {atAgentCap ? `max ${config.agentCount}` : <><Icon name="plus" size={12} /> agent</>}
              </button>
              {focusedAgent && (
                <button className="agent-tab-grid" onClick={() => setFocusedAgent(null)} title="Show all agents">
                  ⊞ show all
                </button>
              )}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {focusedAgent && agentSummaries[focusedAgent]
                ? <AgentPanel agentId={focusedAgent} />
                : <ControlCenter
                    agentIds={agentIds}
                    onFocus={setFocusedAgent}
                    onSpawn={handleSpawn}
                    onClose={handleClose}
                    atCap={atAgentCap}
                    maxAgents={config.agentCount}
                  />
              }
            </div>
          </>
        )}
        {sidebarView === 'tasks' && <TasksView agentIds={agentIds} />}
        {sidebarView === 'cost' && <CostView />}
        {sidebarView === 'context' && <ContextView />}
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {approvals.length > 0 && (
        <div className="approval-overlay">
          <div className="approval-modal">
            <div className="approval-header">
              <span className="status-dot status-error" />
              <strong>Command requires approval</strong>
            </div>
            <div className="approval-body">
              <div style={{ fontSize: 12, color: 'var(--fg-dim)' }}>
                <strong>{approvals[0].agentId}</strong> wants to run — reason: {approvals[0].reason}
              </div>
              <pre className="approval-command">{approvals[0].command}</pre>
              <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 8 }}>
                {approvals.length > 1 && `+ ${approvals.length - 1} more waiting`}
              </div>
            </div>
            <div className="approval-actions">
              <button onClick={() => respondApproval(approvals[0].id, false)}>Deny</button>
              <button className="primary" onClick={() => respondApproval(approvals[0].id, true)}>Allow this once</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Each tab subscribes only to its own agent's status. When another agent streams,
// this tab doesn't re-render.
const AgentTab = memo(function AgentTab({
  id, active, onFocus, onClose
}: { id: string; active: boolean; onFocus: (id: string) => void; onClose: (id: string) => void }) {
  const agent = useAgents(s => s.agents[id])
  const status = agent?.status ?? 'idle'
  const label = agent?.displayName || id
  return (
    <div
      className={`agent-tab ${active ? 'active' : ''}`}
      onClick={() => onFocus(id)}
      title={agent?.displayName ? `${agent.displayName} (${id})` : id}
    >
      <span className={`status-dot status-${status}`} />
      <span className="agent-tab-label">{label}</span>
      <button
        className="agent-tab-close"
        title="Close agent"
        onClick={(e) => { e.stopPropagation(); onClose(id) }}
      >×</button>
    </div>
  )
})

function SidebarItem({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  return (
    <div className={`sidebar-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="sidebar-icon"><Icon name={icon} size={16} /></span>
      <span>{label}</span>
    </div>
  )
}
