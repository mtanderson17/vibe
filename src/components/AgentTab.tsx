// One tab in the agent tab bar.
//
// Subscribes only to its own agent's slice of the store, so when another agent
// streams tokens this tab doesn't re-render. Keep it that way — reading the
// whole `agents` map here would re-render every tab on every token.

import { memo } from 'react'
import { useAgents } from '../stores/agents'

interface Props {
  id: string
  active: boolean
  onFocus: (id: string) => void
  onClose: (id: string) => void
}

export default memo(function AgentTab({ id, active, onFocus, onClose }: Props) {
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
