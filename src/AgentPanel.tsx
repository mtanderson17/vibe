import { useEffect, useRef, useState } from 'react'
import { useAgents } from './stores/agents'
import MessageView from './components/MessageView'
import FriendlyError from './components/FriendlyError'
import ResolvedFileView, { type ResolvedFile } from './components/ResolvedFileView'

interface Props {
  agentId: string
}

export default function AgentPanel({ agentId }: Props) {
  const storeAgent = useAgents(s => s.agents[agentId])
  // Render a synthetic idle-state placeholder if this agent hasn't been touched yet.
  // The composer still works — starting a task will create the real state via events.
  const agent = storeAgent ?? {
    id: agentId,
    status: 'idle' as const,
    task: null,
    branch: null,
    worktreePath: null,
    messages: []
  }
  const [task, setTask] = useState('')
  const [mergeResult, setMergeResult] = useState<{ ok: boolean; conflicts: string[]; output: string } | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState<{ files: ResolvedFile[]; servedBy?: string; error?: string } | null>(null)
  const [overlap, setOverlap] = useState<{ own: string[]; overlaps: Record<string, string[]> } | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Check for sibling-agent file overlap when we're about to merge
    if (agent.status === 'awaiting_merge') {
      window.vibe.agents.checkOverlap(agentId).then(setOverlap)
    } else {
      setOverlap(null)
    }
  }, [agent.status, agentId])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [agent.messages.length])

  const isFreshStart = agent.status === 'idle' || agent.status === 'merged' || agent.status === 'error'
  const isFollowUp = agent.status === 'awaiting_input' || agent.status === 'awaiting_merge'
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
        {agent.pinnedModel && <><span>·</span><span style={{ opacity: 0.7 }}>{agent.pinnedModel}</span></>}
        {agent.step && agent.maxSteps && (
          <><span>·</span><span style={{ opacity: 0.7 }}>step {agent.step}/{agent.maxSteps}</span></>
        )}
        {agent.usage && (
          <>
            <span>·</span>
            <span style={{ opacity: 0.7 }}>
              {agent.usage.total.toLocaleString()} tok
              {agent.pinnedModel?.includes(':free') ? ' (free)' : ''}
            </span>
          </>
        )}
        <div style={{ flex: 1 }} />
        {agent.status === 'running' && (
          <button className="danger" onClick={() => window.vibe.agents.kill(agentId)}>
            Stop
          </button>
        )}
      </div>

      {agent.status === 'awaiting_merge' && (
        <div className={`merge-banner ${overlap && Object.keys(overlap.overlaps).length > 0 ? 'conflict' : ''}`}>
          <div className="msg-text">
            <div>Agent finished. Ready to merge <code>{agent.branch}</code> into main?</div>
            {overlap && Object.keys(overlap.overlaps).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: 'var(--yellow)' }}>⚠ Overlaps with sibling agents:</div>
                {Object.entries(overlap.overlaps).map(([sib, files]) => (
                  <div key={sib} style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11 }}>
                    <span style={{ color: 'var(--accent)' }}>{sib}</span> also modified: {files.join(', ')}
                  </div>
                ))}
                <div style={{ marginTop: 4, opacity: 0.8 }}>Merge conflicts are likely — you can still proceed.</div>
              </div>
            )}
          </div>
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
        <div className="resolution-view">
          {resolution.error ? (
            <div className="merge-banner conflict">
              <div className="msg-text">Resolution failed: {resolution.error}</div>
              <button onClick={rejectResolution}>Abort merge</button>
            </div>
          ) : (
            <>
              <div className="resolution-header">
                <div>
                  <strong>AI resolved {resolution.files.filter(f => f.resolved).length} of {resolution.files.length} files</strong>
                  {resolution.servedBy && <span style={{ opacity: 0.7, marginLeft: 8 }}>via {resolution.servedBy}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="primary" onClick={acceptResolution}>Accept &amp; commit</button>
                  <button onClick={rejectResolution}>Abort merge</button>
                </div>
              </div>
              <div className="resolution-files">
                {resolution.files.map(f => <ResolvedFileView key={f.path} file={f} />)}
              </div>
            </>
          )}
        </div>
      )}

      {agent.error && (
        <div className="merge-banner conflict">
          <div className="msg-text">
            <FriendlyError raw={agent.error} />
          </div>
        </div>
      )}

      <div className="chat" ref={chatRef}>
        {agent.messages.filter(m => m.role !== 'system').map((m, i) => (
          <MessageView key={i} message={m} />
        ))}
        {agent.status === 'running' &&
          agent.messages[agent.messages.length - 1]?.role !== 'assistant' && (
          <div className="msg system">agent is thinking…</div>
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
            agent.status === 'awaiting_merge'
              ? 'Merge below — or reply to keep working (this cancels the pending merge)'
              : isFollowUp
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

