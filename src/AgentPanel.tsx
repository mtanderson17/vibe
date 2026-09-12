import { useEffect, useRef, useState } from 'react'
import { useAgents } from './stores/agents'
import MessageView from './components/MessageView'
import FriendlyError from './components/FriendlyError'
import ResolvedFileView, { type ResolvedFile } from './components/ResolvedFileView'
import DiffView, { type FileDiff } from './components/DiffView'
import AgentNameEditor from './components/AgentNameEditor'
import ModelOverrideEditor from './components/ModelOverrideEditor'

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
  const [diff, setDiff] = useState<{ files: FileDiff[]; totalAdded: number; totalRemoved: number } | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)
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
    setDiff(null)
    const result = await window.vibe.agents.merge(agentId)
    setMergeResult(result)
  }

  async function previewDiff() {
    if (diff) { setDiff(null); return }  // toggle
    setLoadingDiff(true)
    try {
      const d = await window.vibe.agents.previewDiff(agentId)
      setDiff(d)
    } finally {
      setLoadingDiff(false)
    }
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
        <AgentNameEditor agentId={agentId} displayName={agent.displayName} />
        <span>·</span>
        <span>{agent.status}</span>
        {agent.branch && <><span>·</span><span className="branch">{agent.branch}</span></>}
        {agent.task && <><span>·</span><span style={{ opacity: 0.7 }}>{agent.task}</span></>}
        {agent.pinnedModel && <><span>·</span><span style={{ opacity: 0.7 }}>{agent.pinnedModel}</span></>}
        {!agent.pinnedModel && agent.modelOverride && (
          <><span>·</span><span style={{ opacity: 0.7 }}>{agent.modelOverride}</span></>
        )}
        <span>·</span>
        <ModelOverrideEditor
          agentId={agentId}
          current={agent.modelOverride ?? ''}
          disabled={agent.status === 'running'}
        />
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
        <>
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
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={previewDiff} disabled={loadingDiff}>
                {loadingDiff ? 'Loading…' : diff ? 'Hide diff' : 'Preview diff'}
              </button>
              <button className="primary" onClick={merge}>Merge</button>
            </div>
          </div>
          {diff && (
            <div style={{ margin: '0 12px 12px', maxHeight: '60vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
              <DiffView files={diff.files} totalAdded={diff.totalAdded} totalRemoved={diff.totalRemoved} />
            </div>
          )}
        </>
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
        {agent.messages
          .filter(m => {
            // Hide our synthetic system markers (rendered as banners elsewhere) and
            // empty assistant bubbles (model returned nothing — the system marker
            // above will explain what happened).
            if (m.role === 'system') return false
            if (m.role === 'assistant' && !m.content && !m.toolCalls?.length) return false
            return true
          })
          .map((m, i) => (
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

      {(() => {
        // System-marker triggered Continue banners. The runtime stamps a typed
        // `marker` field on system messages when the agent stops — the UI just
        // switches on it (no content parsing).
        const lastMsg = agent.messages[agent.messages.length - 1]
        const kind = agent.status === 'awaiting_input' ? lastMsg?.marker : undefined
        const hitLimit = kind === 'hit_limit'
        const emptyResp = kind === 'empty_response'
        const stoppedNoTool = kind === 'stopped_no_tool'
        if (hitLimit || emptyResp || stoppedNoTool) {
          const title = hitLimit
            ? `Agent paused after ${agent.maxSteps ?? '?'} steps`
            : emptyResp
            ? 'Model returned an empty response'
            : 'Model stopped without calling a tool'
          const banner = hitLimit
            ? 'It hit the configured step budget without calling finish. Continue to give it more runway, wrap it up now, or redirect below.'
            : emptyResp
            ? 'Common with weak free-tier models. Retry, or send guidance below.'
            : 'It wrote a message but didn\'t call finish or another tool. Continue if there\'s more to do, wrap it up if it\'s done, or redirect below.'
          return (
            <div className="stop-banner">
              <div className="stop-banner-title">{title}</div>
              <div className="stop-banner-body">{banner}</div>
              <div className="stop-banner-actions">
                <button
                  className="primary"
                  onClick={() => window.vibe.agents.continue(agentId, hitLimit || stoppedNoTool ? 'Continue.' : 'Please respond — call a tool, ask a question via ask_human, or call finish if done.')}
                >
                  {emptyResp ? 'Retry' : 'Continue'}
                </button>
                {(hitLimit || stoppedNoTool) && (
                  <button
                    onClick={() => window.vibe.agents.continue(agentId, 'Wrap up. Summarize what you did and call finish.')}
                  >
                    Wrap up &amp; finish
                  </button>
                )}
              </div>
            </div>
          )
        }

        // If the agent just called ask_human (free-form question), surface it prominently
        // so the user knows they need to reply — the tool call display alone truncates
        // long questions.
        const pendingQuestion = isFollowUp ? findPendingQuestion(agent.messages) : null
        if (pendingQuestion) {
          return (
            <div className="composer choice-composer">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  Agent asks:
                </div>
                <div style={{ fontSize: 13, color: 'var(--fg)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                  {pendingQuestion}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 6 }}>
                  Type your reply below.
                </div>
              </div>
            </div>
          )
        }

        // If the agent just called ask_human_choice, show clickable options instead
        // of the free-form composer. Click sends the chosen option as the continue input.
        const pendingChoice = isFollowUp ? findPendingChoice(agent.messages) : null
        if (pendingChoice) {
          return (
            <div className="composer choice-composer">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginBottom: 8 }}>
                  Choose one:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {pendingChoice.options.map((opt, i) => (
                    <button
                      key={i}
                      className="primary"
                      onClick={async () => {
                        await window.vibe.agents.continue(agentId, opt)
                      }}
                      style={{ padding: '8px 14px' }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--fg-dim)' }}>
                  Or type a custom reply below:
                </div>
              </div>
            </div>
          )
        }
        return null
      })()}

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

// AgentNameEditor and ModelOverrideEditor extracted to their own files under components/.

// Find an unanswered ask_human call in the tail of messages. Walks backwards; if
// we hit a user message before finding the tool call at the end, no question pending.
function findPendingQuestion(messages: import('./types').Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') return null
    if (m.role === 'assistant' && m.toolCalls) {
      const q = m.toolCalls.find(tc => tc.name === 'ask_human')
      if (q) {
        return String((q.arguments as { question?: unknown }).question ?? '')
      }
    }
  }
  return null
}

// Find an unanswered ask_human_choice call in the tail of messages.
// The last assistant message must contain a tool call for ask_human_choice, and
// the next tool result (if any) is the pending marker. We show choice buttons
// as long as no user reply has been sent yet.
function findPendingChoice(messages: import('./types').Message[]): { question: string; options: string[] } | null {
  // Walk backwards; if we hit a user message before finding an ask_human_choice
  // tool result at the end, no choice pending.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') return null
    if (m.role === 'assistant' && m.toolCalls) {
      const choice = m.toolCalls.find(tc => tc.name === 'ask_human_choice')
      if (choice) {
        const options = Array.isArray((choice.arguments as { options?: unknown }).options)
          ? ((choice.arguments as { options: unknown[] }).options as string[]).map(String)
          : []
        const question = String((choice.arguments as { question?: unknown }).question ?? '')
        return { question, options }
      }
    }
  }
  return null
}

