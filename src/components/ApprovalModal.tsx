// Blocking prompt for a command an agent wants to run but isn't allowed to
// without a human. Requests queue up; we only ever show the head of the queue
// and tell the user how many more are behind it.

export interface ApprovalReq {
  id: string
  agentId: string
  command: string
  reason: string
}

interface Props {
  queue: ApprovalReq[]
  onRespond: (id: string, approved: boolean) => void
}

export default function ApprovalModal({ queue, onRespond }: Props) {
  const req = queue[0]
  if (!req) return null

  return (
    <div className="approval-overlay">
      <div className="approval-modal">
        <div className="approval-header">
          <span className="status-dot status-error" />
          <strong>Command requires approval</strong>
        </div>
        <div className="approval-body">
          <div style={{ fontSize: 12, color: 'var(--fg-dim)' }}>
            <strong>{req.agentId}</strong> wants to run — reason: {req.reason}
          </div>
          <pre className="approval-command">{req.command}</pre>
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 8 }}>
            {queue.length > 1 && `+ ${queue.length - 1} more waiting`}
          </div>
        </div>
        <div className="approval-actions">
          <button onClick={() => onRespond(req.id, false)}>Deny</button>
          <button className="primary" onClick={() => onRespond(req.id, true)}>Allow this once</button>
        </div>
      </div>
    </div>
  )
}
