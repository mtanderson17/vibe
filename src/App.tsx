import { useEffect, useState } from 'react'
import type { Config } from './types'
import { useAgents } from './stores/agents'
import Setup from './Setup'
import AgentPanel from './AgentPanel'
import ContextView from './ContextView'

type View = 'agent-1' | 'agent-2' | 'context' | 'settings'

export default function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [view, setView] = useState<View>('agent-1')
  const agents = useAgents(s => s.agents)
  const applyEvent = useAgents(s => s.applyEvent)

  useEffect(() => {
    window.vibe.config.get().then(setConfig)
  }, [])

  useEffect(() => {
    const off = window.vibe.onAgentEvent(applyEvent)
    return off
  }, [applyEvent])

  if (!config) return null

  if (!config.workspacePath || !config.openrouterApiKey) {
    return <Setup config={config} onSaved={setConfig} />
  }

  if (view === 'settings') {
    return <Setup config={config} onSaved={(c) => { setConfig(c); setView('agent-1') }} />
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">VIBE</div>
        <div className="tabs">
          {(['agent-1', 'agent-2'] as const).map(id => (
            <div
              key={id}
              className={`tab ${view === id ? 'active' : ''}`}
              onClick={() => setView(id)}
            >
              <span className={`status-dot status-${agents[id]?.status ?? 'idle'}`} />
              {id}
            </div>
          ))}
          <div
            className={`tab ${view === 'context' ? 'active' : ''}`}
            onClick={() => setView('context')}
          >
            context
          </div>
        </div>
        <div className="spacer" />
        <div className="meta">
          {config.model} · {config.workspacePath}
        </div>
        <button onClick={() => setView('settings')}>Settings</button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'agent-1' && <AgentPanel agentId="agent-1" />}
        {view === 'agent-2' && <AgentPanel agentId="agent-2" />}
        {view === 'context' && <ContextView />}
      </div>
    </div>
  )
}
