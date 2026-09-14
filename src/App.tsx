// App shell: owns the top-level view state (which screen, which agent is
// focused, which modal is open) and wires the main-process bridges — config,
// agent events, approvals, workspace switches.
//
// Anything with more shape than that lives elsewhere: the menu/palette command
// lists are in src/hooks, the pieces of chrome are in src/components.

import { useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react'
import type { Config, SidebarView } from './types'
import { useAgents } from './stores/agents'
import Setup from './Setup'
import AgentPanel from './AgentPanel'
import ContextView from './ContextView'
import CostView from './CostView'
// Monaco is ~8 MB — lazy-load so it only downloads when the user opens Files.
// Cuts cold-start significantly.
const FilesView = lazy(() => import('./FilesView'))
import TasksView from './TasksView'
import ControlCenter from './ControlCenter'
import Icon from './Icon'
import CommandPalette from './components/CommandPalette'
import ShortcutsModal from './components/ShortcutsModal'
import ErrorBoundary from './components/ErrorBoundary'
import NewTaskModal from './components/NewTaskModal'
import SidebarItem from './components/SidebarItem'
import AgentTab from './components/AgentTab'
import ApprovalModal, { type ApprovalReq } from './components/ApprovalModal'
import { useMenuCommands } from './hooks/useMenuCommands'
import { useCommands } from './hooks/useCommands'
import { usePrefs } from './stores/prefs'
import vibeLogo from './assets/vibe-logo.webp'

export default function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [sidebarView, setSidebarView] = useState<SidebarView>('control')
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null)
  const [approvals, setApprovals] = useState<ApprovalReq[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const agentSummaries = useAgents(s => s.agents)
  const applyEvent = useAgents(s => s.applyEvent)
  const hydrate = useAgents(s => s.hydrate)
  const addAgent = useAgents(s => s.addAgent)
  const removeAgent = useAgents(s => s.removeAgent)

  useEffect(() => {
    window.vibe.config.get().then(setConfig)
    usePrefs.getState().load()
  }, [])

  // Preload the Files bundle (Monaco) after 3s of idle so the first click on
  // the Files tab is instant. Runs once — no-op if user has already opened it.
  useEffect(() => {
    const t = setTimeout(() => { import('./FilesView').catch(() => {}) }, 3000)
    return () => clearTimeout(t)
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

  // Reload the app when workspace switches — cheapest way to reset all view state
  useEffect(() => {
    const off = window.vibe.onWorkspaceSwitched(() => {
      window.location.reload()
    })
    return off
  }, [])

  const respondApproval = useCallback(async (id: string, approved: boolean) => {
    setApprovals(prev => prev.filter(a => a.id !== id))
    await window.vibe.approval.respond(id, approved)
  }, [])

  const agentIds = useMemo(() => {
    return Object.keys(agentSummaries).sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, '')) || 0
      const nb = parseInt(b.replace(/\D/g, '')) || 0
      return na - nb
    })
  }, [agentSummaries])

  const atAgentCap = agentIds.length >= (config?.agentCount ?? 4)

  const spawnAgent = useCallback(async () => {
    if (atAgentCap) return
    const newAgent = await window.vibe.agents.spawn()
    addAgent(newAgent)
    setFocusedAgent(newAgent.id)
    setSidebarView('control')
  }, [atAgentCap, addAgent])

  const closeAgent = useCallback(async (id: string) => {
    const a = agentSummaries[id]
    if (a && a.status !== 'idle') {
      if (!confirm(`Close ${id}? Any in-flight work, worktree, and branch will be cleaned up.`)) return
    }
    removeAgent(id)
    if (focusedAgent === id) setFocusedAgent(null)
    window.vibe.agents.close(id).catch(err => console.error('[vibe] close failed', err))
  }, [agentSummaries, focusedAgent, removeAgent])

  const openNewTask = useCallback(() => setNewTaskOpen(true), [])
  const openShortcuts = useCallback(() => setShortcutsOpen(true), [])
  const togglePalette = useCallback(() => setPaletteOpen(prev => !prev), [])

  // Keybindings all arrive as menu commands — see useMenuCommands for why.
  useMenuCommands({
    agentIds, focusedAgent, spawnAgent, closeAgent,
    setSidebarView, setFocusedAgent, openNewTask, openShortcuts, togglePalette
  })

  const commands = useCommands({
    agentIds, agentSummaries, atAgentCap, config,
    spawnAgent, closeAgent, setSidebarView, setFocusedAgent, openNewTask, openShortcuts
  })

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
    return <Setup
      config={config}
      onSaved={(c) => { setConfig(c); setSidebarView('control'); setSettingsInitialTab(undefined) }}
      initialTab={settingsInitialTab}
    />
  }

  const goTo = (view: SidebarView) => () => { setSidebarView(view); setFocusedAgent(null) }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={vibeLogo} alt="Vibe" />
        </div>
        <div className="sidebar-nav">
          <SidebarItem icon="grid" label="Control Center" active={sidebarView === 'control'} onClick={goTo('control')} />
          <SidebarItem icon="list" label="Tasks"          active={sidebarView === 'tasks'}   onClick={goTo('tasks')} />
          <SidebarItem icon="note" label="Files"          active={sidebarView === 'files'}   onClick={goTo('files')} />
          <SidebarItem icon="coin" label="Cost"           active={sidebarView === 'cost'}    onClick={goTo('cost')} />
          <SidebarItem icon="note" label="Context"        active={sidebarView === 'context'} onClick={goTo('context')} />
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
                  onFocus={setFocusedAgent}
                  onClose={closeAgent}
                />
              ))}
              <button
                className="agent-tab-add"
                onClick={spawnAgent}
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
                ? <AgentPanel key={focusedAgent} agentId={focusedAgent} />
                : <ControlCenter
                    agentIds={agentIds}
                    onFocus={setFocusedAgent}
                    onSpawn={spawnAgent}
                    onClose={closeAgent}
                    atCap={atAgentCap}
                    maxAgents={config.agentCount}
                  />
              }
            </div>
          </>
        )}
        {sidebarView === 'tasks' && <ErrorBoundary label="Tasks"><TasksView agentIds={agentIds} /></ErrorBoundary>}
        {sidebarView === 'files' && (
          <ErrorBoundary label="Files">
            <Suspense fallback={<div className="screen" style={{ padding: 24, color: 'var(--fg-dim)' }}>Loading editor…</div>}>
              <FilesView />
            </Suspense>
          </ErrorBoundary>
        )}
        {sidebarView === 'cost' && <ErrorBoundary label="Cost"><CostView /></ErrorBoundary>}
        {sidebarView === 'context' && <ErrorBoundary label="Context"><ContextView /></ErrorBoundary>}
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        onEditKeybindings={() => { setSettingsInitialTab('keybindings'); setSidebarView('settings') }}
      />
      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        hasWorkspace={!!config.workspacePath}
      />
      <ApprovalModal queue={approvals} onRespond={respondApproval} />
    </div>
  )
}
