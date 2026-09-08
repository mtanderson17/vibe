import { useEffect, useState, useMemo } from 'react'
import type { Config } from './types'
import { useAgents } from './stores/agents'
import Setup from './Setup'
import AgentPanel from './AgentPanel'
import ContextView from './ContextView'
import CostView from './CostView'
import TasksView from './TasksView'
import ControlCenter from './ControlCenter'
import Icon, { type IconName } from './Icon'

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

  async function handleClose(id: string) {
    const a = agentSummaries[id]
    if (a && a.status !== 'idle') {
      if (!confirm(`Close ${id}? Any in-flight work, worktree, and branch will be cleaned up.`)) return
    }
    // Optimistic UI: remove from store immediately so the tab disappears now.
    // Worktree/branch cleanup happens in the background (git ops on Windows are ~1-3s).
    removeAgent(id)
    if (focusedAgent === id) setFocusedAgent(null)
    window.vibe.agents.close(id).catch(err => console.error('[vibe] close failed', err))
  }

  if (!config) return null

  const missingCreds = !config.workspacePath || (
    !config.openrouterApiKey &&
    !config.anthropicApiKey &&
    !config.model.startsWith('ollama/')
  )
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
          <div className="sidebar-workspace" title={config.workspacePath ?? ''}>
            {config.workspacePath?.split(/[\\/]/).slice(-2).join('/')}
          </div>
        </div>
      </aside>

      <main className="main">
        {sidebarView === 'control' && (
          <>
            <div className="agent-tabbar">
              {agentIds.map(id => (
                <div
                  key={id}
                  className={`agent-tab ${focusedAgent === id ? 'active' : ''}`}
                  onClick={() => setFocusedAgent(id)}
                >
                  <span className={`status-dot status-${agentSummaries[id]?.status ?? 'idle'}`} />
                  <span className="agent-tab-label">{id}</span>
                  <button
                    className="agent-tab-close"
                    title="Close agent"
                    onClick={(e) => { e.stopPropagation(); handleClose(id) }}
                  >×</button>
                </div>
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

function SidebarItem({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  return (
    <div className={`sidebar-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="sidebar-icon"><Icon name={icon} size={16} /></span>
      <span>{label}</span>
    </div>
  )
}
