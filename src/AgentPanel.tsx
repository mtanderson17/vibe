import { useEffect, useRef, useState } from 'react'
import { useAgents } from './stores/agents'
import type { Message } from './types'

interface Props {
  agentId: string
}

interface ResolvedFile { path: string; originalConflict: string; resolved: string }

export default function AgentPanel({ agentId }: Props) {
  const agent = useAgents(s => s.agents[agentId])
  const [task, setTask] = useState('')
  const [mergeResult, setMergeResult] = useState<{ ok: boolean; conflicts: string[]; output: string } | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState<{ files: ResolvedFile[]; servedBy?: string; error?: string } | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [agent?.messages.length])

  if (!agent) return null

  const isFreshStart = agent.status === 'idle' || agent.status === 'merged' || agent.status === 'error'
  const isFollowUp = agent.status === 'awaiting_input'
  const canType = isFreshStart || isFollowUp

  async function submit() {
    if (!task.trim()) return
    setMergeResult(null)
    if (isFollowUp) {
      await window.vibe.agents.continue(agentId, task.trim())
    } else {
      await window.vibe.agents.start(agentId, task.trim())
    }
    setTask('')
  }

  async function merge() {
    setResolution(null)
    const result = await window.vibe.agents.merge(agentId)
    setMergeResult(result)
  }

  async function resolveWithAI() {
    if (!mergeResult || mergeResult.ok) return
    setResolving(true)
    try {
      const r = await window.vibe.agents.resolveConflicts(agentId, mergeResult.conflicts)
      setResolution(r)
    } finally {
      setResolving(false)
    }
  }

  async function acceptResolution() {
    if (!resolution) return
    await window.vibe.agents.acceptResolution(agentId, resolution.files)
    setResolution(null)
    setMergeResult({ ok: true, conflicts: [], output: 'Merged with AI-resolved conflicts' })
  }

  async function rejectResolution() {
    await window.vibe.agents.abortMerge()
    setResolution(null)
    setMergeResult(null)
  }

  return (
    <div className="panel">
      <div className="agent-meta">
        <span className={`status-dot status-${agent.status}`} />
        <strong>{agentId}</strong>
        <span>·</span>
        <span>{agent.status}</span>
        {agent.branch && <><span>·</span><span className="branch">{agent.branch}</span></>}
        {agent.task && <><span>·</span><span style={{ opacity: 0.7 }}>{agent.task}</span></>}
        {agent.pinnedModel && <><span>·</span><span style={{ opacity: 0.7 }}>pinned: {agent.pinnedModel}</span></>}
        <div style={{ flex: 1 }} />
        {agent.status === 'running' && (
          <button className="danger" onClick={() => window.vibe.agents.kill(agentId)}>
            Stop
          </button>
        )}
      </div>

      {agent.status === 'awaiting_merge' && (
        <div className="merge-banner">
          <div className="msg-text">Agent finished. Ready to merge <code>{agent.branch}</code> into main?</div>
          <button className="primary" onClick={merge}>Merge</button>
        </div>
      )}

      {mergeResult && !resolution && (
        <div className={`merge-banner ${mergeResult.ok ? '' : 'conflict'}`}>
          <div className="msg-text" style={{ whiteSpace: 'pre-wrap', fontFamily: mergeResult.ok ? 'inherit' : 'monospace', fontSize: 11 }}>
            {mergeResult.ok
              ? '✓ Merged successfully'
              : `Merge conflicts:\n${mergeResult.conflicts.join('\n')}`}
          </div>
          {!mergeResult.ok && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={resolveWithAI} disabled={resolving}>
                {resolving ? 'Resolving…' : 'Resolve with AI'}
              </button>
              <button onClick={async () => { await window.vibe.agents.abortMerge(); setMergeResult(null) }}>
                Abort
              </button>
            </div>
          )}
        </div>
      )}

      {resolution && (
        <div className={`merge-banner ${resolution.error ? 'conflict' : ''}`}>
          <div className="msg-text" style={{ flex: 1 }}>
            {resolution.error ? (
              <>Resolution failed: {resolution.error}</>
            ) : (
              <>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  AI resolved {resolution.files.filter(f => f.resolved).length} of {resolution.files.length} files
                  {resolution.servedBy && <span style={{ opacity: 0.7, fontWeight: 400 }}> · {resolution.servedBy}</span>}
                </div>
                {resolution.files.map(f => (
                  <div key={f.path} style={{ fontSize: 11, fontFamily: 'monospace', opacity: f.resolved ? 1 : 0.5 }}>
                    {f.resolved ? '✓' : '⨯'} {f.path} {!f.resolved && '(binary/unresolvable — inspect manually)'}
                  </div>
                ))}
                <div style={{ fontSize: 11, marginTop: 6, opacity: 0.7 }}>
                  Review files in your editor before accepting. Accept commits the merge.
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!resolution.error && (
              <button className="primary" onClick={acceptResolution}>Accept & commit</button>
            )}
            <button onClick={rejectResolution}>Abort merge</button>
          </div>
        </div>
      )}

      {agent.error && (
        <div className="merge-banner conflict">
          <div className="msg-text">Error: {agent.error}</div>
        </div>
      )}

      <div className="chat" ref={chatRef}>
        {agent.messages.filter(m => m.role !== 'system').map((m, i) => (
          <MessageView key={i} message={m} />
        ))}
        {agent.status === 'running' && (
          <div className="msg system">agent is working…</div>
        )}
        {agent.messages.length === 0 && (
          <div className="msg system">Give this agent a task to begin.</div>
        )}
      </div>

      <div className="composer">
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              if (canType) submit()
            }
          }}
          placeholder={
            isFollowUp
              ? 'Reply to the agent… (Cmd/Ctrl+Enter to send)'
              : canType
                ? 'Describe the task… (Cmd/Ctrl+Enter to submit)'
                : 'Agent is busy…'
          }
          disabled={!canType}
        />
        <button className="primary" onClick={submit} disabled={!canType || !task.trim()}>
          {isFollowUp ? 'Send' : 'Start'}
        </button>
      </div>
    </div>
  )
}

function MessageView({ message }: { message: Message }) {
  const cls = `msg ${message.role}`
  const hasToolCalls = message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0

  return (
    <div className={cls}>
      <div className="role">
        {message.role === 'tool' ? `tool: ${message.name}` : message.role}
        {message.servedBy && (
          <span style={{ marginLeft: 8, opacity: 0.7, textTransform: 'none', letterSpacing: 0 }}>
            · served by {message.servedBy}
          </span>
        )}
      </div>
      {message.content && <div>{message.content}</div>}
      {hasToolCalls && message.toolCalls!.map(tc => (
        <div key={tc.id} className="toolcall">
          → {tc.name}({Object.keys(tc.arguments).map(k => {
            const v = tc.arguments[k]
            const s = typeof v === 'string' ? v : JSON.stringify(v)
            return `${k}: ${s.length > 80 ? s.slice(0, 80) + '…' : s}`
          }).join(', ')})
        </div>
      ))}
    </div>
  )
}
