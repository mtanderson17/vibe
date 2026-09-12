// Owns the merge → preview → conflict-resolve → accept/abort flow.
// Extracted from AgentPanel to keep that component focused on chat/task input.
//
// State ownership: all merge-related state lives here (mergeResult, resolution,
// overlap, diff, loading flags). We watch agent.status transitions and clear
// ourselves when the agent leaves the merge-eligible states, which is what
// used to happen via the parent's submit() calling setMergeResult(null).

import { useEffect, useState } from 'react'
import type { AgentStatus } from '../types'
import DiffView, { type FileDiff } from './DiffView'
import ResolvedFileView, { type ResolvedFile } from './ResolvedFileView'

interface Props {
  agentId: string
  branch: string | null
  status: AgentStatus
}

export default function MergePanel({ agentId, branch, status }: Props) {
  const [mergeResult, setMergeResult] = useState<{ ok: boolean; conflicts: string[]; output: string } | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState<{ files: ResolvedFile[]; servedBy?: string; error?: string } | null>(null)
  const [overlap, setOverlap] = useState<{ own: string[]; overlaps: Record<string, string[]> } | null>(null)
  const [diff, setDiff] = useState<{ files: FileDiff[]; totalAdded: number; totalRemoved: number } | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  // Overlap check runs whenever we enter awaiting_merge for this agent.
  useEffect(() => {
    if (status === 'awaiting_merge') {
      window.vibe.agents.checkOverlap(agentId).then(setOverlap)
    } else {
      setOverlap(null)
    }
  }, [status, agentId])

  // Clear stale merge state when the agent runs again (e.g. user submitted a
  // follow-up task). We deliberately keep state through 'merged' and 'awaiting_merge'
  // so the "✓ Merged successfully" / conflict banner stays visible.
  useEffect(() => {
    if (status === 'running' || status === 'idle') {
      setMergeResult(null)
      setResolution(null)
      setDiff(null)
    }
  }, [status])

  async function merge() {
    setResolution(null)
    setDiff(null)
    const result = await window.vibe.agents.merge(agentId)
    setMergeResult(result)
  }

  async function previewDiff() {
    if (diff) { setDiff(null); return }
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
    <>
      {status === 'awaiting_merge' && (
        <>
          <div className={`merge-banner ${overlap && Object.keys(overlap.overlaps).length > 0 ? 'conflict' : ''}`}>
            <div className="msg-text">
              <div>Agent finished. Ready to merge <code>{branch}</code> into main?</div>
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
    </>
  )
}
