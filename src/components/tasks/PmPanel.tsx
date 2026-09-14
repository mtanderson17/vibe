// The PM-agent drawer at the bottom of the Tasks screen.
//
// Owns its own chat state and the onPmEvent subscription — nothing above it
// needs to know about PM messages. The one thing it does report upward is
// `onTasksChanged`: when the PM goes idle it may have proposed tasks, and the
// board has to reload.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message } from '../../types'

interface PmState {
  status: 'idle' | 'running' | 'error'
  lastRun: string | null
  messages: Message[]
  error?: string
  usage?: { total: number }
  pinnedModel?: string
}

interface Props {
  onTasksChanged: () => void
}

export default function PmPanel({ onTasksChanged }: Props) {
  const [state, setState] = useState<PmState>({ status: 'idle', lastRun: null, messages: [] })
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    setState(await window.vibe.pm.state() as PmState)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const off = window.vibe.onPmEvent(evt => {
      if (evt.type === 'status') {
        setState(prev => ({ ...prev, status: evt.data as PmState['status'] }))
        if (evt.data === 'idle') onTasksChanged() // proposed tasks might have appeared
      } else if (evt.type === 'message') {
        setState(prev => ({ ...prev, messages: [...prev.messages, evt.data as Message] }))
      } else if (evt.type === 'usage') {
        setState(prev => ({ ...prev, usage: evt.data as { total: number } }))
      } else if (evt.type === 'cleared') {
        setState(prev => ({ ...prev, messages: [], usage: undefined }))
      }
    })
    return off
  }, [onTasksChanged])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [state.messages.length])

  async function send() {
    if (!input.trim() || state.status === 'running') return
    const text = input.trim()
    setInput('')
    setOpen(true)
    await window.vibe.pm.run('chat', text)
  }

  const dot = state.status === 'running' ? 'running' : state.status === 'error' ? 'error' : 'idle'

  return (
    <div className={`pm-panel ${open ? 'open' : ''}`}>
      <div className="pm-panel-header" onClick={() => setOpen(!open)}>
        <span className={`status-dot status-${dot}`} />
        <strong>PM agent</strong>
        <span style={{ opacity: 0.7, fontSize: 11 }}>
          {state.status === 'running' ? 'working…'
            : state.lastRun ? `last run ${new Date(state.lastRun).toLocaleTimeString()}`
            : 'idle'}
        </span>
        {state.usage && <span style={{ opacity: 0.7, fontSize: 11 }}>· {state.usage.total.toLocaleString()} tok</span>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12 }}>{open ? '▼' : '▲'}</span>
      </div>
      {open && (
        <>
          <div className="pm-chat" ref={scrollRef}>
            {state.messages.filter(m => m.role !== 'system').map((m, i) => (
              <div key={i} className={`msg ${m.role}`} style={{ fontSize: 12 }}>
                <div className="role">{m.role === 'tool' ? `tool: ${m.name}` : m.role}</div>
                {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
                {m.toolCalls?.map(tc => (
                  <div key={tc.id} className="toolcall">→ {tc.name}({Object.keys(tc.arguments).join(', ')})</div>
                ))}
              </div>
            ))}
            {state.messages.length === 0 && (
              <div className="msg system">Ask the PM agent about the project, or trigger a summary update.</div>
            )}
          </div>
          <div className="pm-composer">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              // Single-line composer: plain Enter always sends, regardless of
              // the submitOnEnter pref — there's no newline to ambiguate.
              onKeyDown={e => { if (e.key === 'Enter') send() }}
              placeholder="Ask PM: 'add a task for X', 'what's the current state?', 'regenerate summary'…"
              disabled={state.status === 'running'}
            />
            {state.status === 'running' ? (
              <button className="danger" onClick={() => window.vibe.pm.kill()}>Stop</button>
            ) : (
              <button className="primary" onClick={send} disabled={!input.trim()}>Send</button>
            )}
            <button onClick={() => window.vibe.pm.clear()}>Clear chat</button>
          </div>
        </>
      )}
    </div>
  )
}
