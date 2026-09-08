import { useAgents } from './stores/agents'
import type { AgentState, Message } from './types'

interface Props {
  agentIds: string[]
  onFocus: (id: string) => void
  onSpawn: () => void
  onClose: (id: string) => void
  atCap: boolean
  maxAgents: number
}

const STATUS_LABEL: Record<AgentState['status'], string> = {
  idle: 'idle',
  running: 'working',
  awaiting_input: 'needs input',
  awaiting_merge: 'ready to merge',
  merged: 'merged',
  error: 'error'
}

function lastAssistantContent(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.content) return m.content
    if (m.role === 'user' && m.content) return '(waiting for reply) ' + m.content
  }
  return ''
}

export default function ControlCenter({ agentIds, onFocus, onSpawn, onClose, atCap, maxAgents }: Props) {
  return (
    <div className="control-center">
      <div className="control-header">
        <div>
          <div className="control-title">Control Center</div>
          <div className="control-subtitle">
            All agents at a glance — click any tile to focus its chat · {agentIds.length}/{maxAgents} agents
          </div>
        </div>
      </div>

      <div className="control-grid">
        {agentIds.map(id => (
          <AgentTile key={id} agentId={id} onFocus={onFocus} onClose={onClose} />
        ))}

        {!atCap ? (
          <div className="control-tile control-tile-add" onClick={onSpawn}>
            <div style={{ fontSize: 28, opacity: 0.6 }}>+</div>
            <div>New agent</div>
          </div>
        ) : (
          <div className="control-tile control-tile-add disabled" title="Increase agent count in Settings">
            <div style={{ fontSize: 16, opacity: 0.6 }}>—</div>
            <div style={{ fontSize: 11 }}>max {maxAgents} agents · Settings to raise</div>
          </div>
        )}

        {agentIds.length === 0 && (
          <div className="control-empty">
            <div className="control-empty-title">Ready when you are.</div>
            <div>Spawn your first agent, then give it a task. Up to {maxAgents} can run in parallel.</div>
          </div>
        )}
      </div>
    </div>
  )
}

// Extracted so each tile subscribes only to its own agent — a stream_delta on
// agent-3 won't cause every other tile to re-render.
function AgentTile({ agentId, onFocus, onClose }: {
  agentId: string
  onFocus: (id: string) => void
  onClose: (id: string) => void
}) {
  const a = useAgents(s => s.agents[agentId])
  const status = a?.status ?? 'idle'
  const preview = a ? lastAssistantContent(a.messages) : ''

  return (
    <div className={`control-tile status-${status}`} onClick={() => onFocus(agentId)}>
      <div className="control-tile-head">
        <span className={`status-dot status-${status}`} />
        <strong
          title="Click to rename"
          style={{ cursor: 'text' }}
          onClick={(e) => {
            e.stopPropagation()
            const next = prompt(`Rename ${agentId} (leave empty to reset):`, a?.displayName || '')
            if (next !== null) window.vibe.agents.setName(agentId, next.trim() || null)
          }}
        >
          {a?.displayName || agentId}
        </strong>
        <span style={{ opacity: 0.6 }}>· {STATUS_LABEL[status]}</span>
        <div style={{ flex: 1 }} />
        {a?.step && a?.maxSteps && (
          <span style={{ fontSize: 10, opacity: 0.6 }}>step {a.step}/{a.maxSteps}</span>
        )}
        {status === 'running' && (
          <button
            className="danger"
            style={{ fontSize: 10, padding: '2px 6px' }}
            onClick={(e) => { e.stopPropagation(); window.vibe.agents.kill(agentId) }}
            title="Stop this agent"
          >
            Stop
          </button>
        )}
        <button
          className="tile-close"
          onClick={(e) => { e.stopPropagation(); onClose(agentId) }}
          title="Close agent (removes worktree + branch)"
        >×</button>
      </div>
      {a?.task && <div className="control-tile-task">{a.task}</div>}
      {a?.branch && <div className="control-tile-branch">{a.branch}</div>}
      {preview && <div className="control-tile-preview">{preview}</div>}
      {!a?.task && !preview && (
        <div className="control-tile-empty">No task yet · click to give one</div>
      )}
      {a?.usage && (
        <div className="control-tile-footer">
          {a.usage.total.toLocaleString()} tokens
          {a.pinnedModel && <> · {a.pinnedModel.split('/').pop()}</>}
        </div>
      )}
    </div>
  )
}
