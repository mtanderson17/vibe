import { useEffect, useState, useCallback } from 'react'

type Tab = 'project' | 'summary'

export default function ContextView() {
  const [tab, setTab] = useState<Tab>('project')
  const [projectContent, setProjectContent] = useState('')
  const [projectDirty, setProjectDirty] = useState(false)
  const [summaryContent, setSummaryContent] = useState('')
  const [summaryModified, setSummaryModified] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pmStatus, setPmStatus] = useState<'idle' | 'running' | 'error'>('idle')

  const refreshSummary = useCallback(async () => {
    const [content, modified] = await Promise.all([
      window.vibe.pm.readSummary(),
      window.vibe.pm.lastModified()
    ])
    setSummaryContent(content)
    setSummaryModified(modified)
  }, [])

  useEffect(() => {
    window.vibe.context.read().then(setProjectContent)
    refreshSummary()
    window.vibe.pm.state().then(s => setPmStatus(s.status))
  }, [refreshSummary])

  useEffect(() => {
    const off = window.vibe.onPmEvent(evt => {
      if (evt.type === 'status') {
        setPmStatus(evt.data as 'idle' | 'running' | 'error')
        if (evt.data === 'idle') refreshSummary()
      }
    })
    return off
  }, [refreshSummary])

  async function saveProject() {
    setSaving(true)
    await window.vibe.context.write(projectContent)
    setProjectDirty(false)
    setSaving(false)
  }

  async function regenerate() {
    await window.vibe.pm.run('manual')
  }

  return (
    <div className="context-view">
      <div className="header">
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setTab('project')}
            className={tab === 'project' ? 'primary' : ''}
          >Project</button>
          <button
            onClick={() => setTab('summary')}
            className={tab === 'summary' ? 'primary' : ''}
          >
            Summary
            {pmStatus === 'running' && <span style={{ marginLeft: 6 }}>●</span>}
          </button>
        </div>
        {tab === 'project' && (
          <button className="primary" onClick={saveProject} disabled={!projectDirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {tab === 'summary' && (
          <button className="primary" onClick={regenerate} disabled={pmStatus === 'running'}>
            {pmStatus === 'running' ? 'Regenerating…' : 'Regenerate now'}
          </button>
        )}
      </div>

      {tab === 'project' && (
        <>
          <div className="screen-help">
            <strong>What belongs here:</strong> timeless project knowledge every agent needs before starting <em>any</em>
            work — stack, conventions, architecture, current focus. Human-owned; PM agent never edits this file.
            <br />
            <span style={{ opacity: 0.7 }}>Example: "Python 3.14 + pygame-ce. Single-file OOP. PEP8 with type hints."</span>
          </div>
          <textarea
            value={projectContent}
            onChange={e => { setProjectContent(e.target.value); setProjectDirty(true) }}
          />
        </>
      )}

      {tab === 'summary' && (
        <>
          <div className="screen-help">
            <strong>What this is:</strong> the PM agent's rolling summary of project state, updated after every merge
            and prepended to every agent's system prompt. Read-only here — regenerate to trigger the PM agent.
            <br />
            {summaryModified && (
              <span style={{ opacity: 0.7 }}>Last updated: {new Date(summaryModified).toLocaleString()}</span>
            )}
          </div>
          <textarea value={summaryContent} readOnly style={{ background: 'var(--bg)', opacity: 0.85 }} />
        </>
      )}
    </div>
  )
}
