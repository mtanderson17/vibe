import type { Message } from '../types'

export default function MessageView({ message }: { message: Message }) {
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
