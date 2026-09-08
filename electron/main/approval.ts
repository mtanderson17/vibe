// Permission-gating shell. Detects potentially dangerous shell commands and
// asks the human before executing them. Small pattern list to start —
// intentionally conservative. Grows over time as we learn what matters.
//
// This is a shell — not a full sandbox. It doesn't cover:
//   - subshells / eval / complex pipelines that hide the real command
//   - agent writing a script and then executing it
//   - direct file writes via write_file to sensitive locations
//   - network calls made through node/python/etc.
//
// The real story for isolation is container-per-agent (BYOC roadmap). This
// module exists so that once we do add stricter gates or a rich approval UI,
// the plumbing is already here.

import type { WebContents } from 'electron'

// Command patterns that require user approval before running. Kept deliberately
// short. Add more as we hit specific worries.
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf]|--recursive|--force)/i, reason: 'recursive/force delete' },
  { pattern: /\bgit\s+push\b/i,                              reason: 'git push (writes to remote)' },
  { pattern: /\bgit\s+reset\s+--hard\b/i,                    reason: 'git reset --hard (destroys uncommitted work)' },
  { pattern: /\bnpm\s+publish\b/i,                           reason: 'npm publish' },
  { pattern: /\bnpm\s+install\s+-g\b/i,                      reason: 'global npm install' },
  { pattern: /\bpip\s+install\b(?!.*(?:-r|--requirement))/i, reason: 'pip install (skips venv guidance)' },
  { pattern: /\bcurl\s+.*\|\s*(?:sh|bash)/i,                 reason: 'curl piped to shell (arbitrary code execution)' },
  { pattern: /\bsudo\b/i,                                    reason: 'sudo' },
  { pattern: /\brm\s+-rf\s+\//,                              reason: 'rm -rf /' }
]

export interface ApprovalRequest {
  id: string
  agentId: string
  command: string
  reason: string
}

export interface ApprovalDecision {
  id: string
  approved: boolean
  reason?: string
}

// Returns null if command is safe. Otherwise the reason it needs approval.
export function requiresApproval(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return reason
  }
  return null
}

// --- Runtime IPC glue (approval flow) ---

let sender: WebContents | null = null
const pending = new Map<string, (approved: boolean) => void>()

export function bindApprovalSender(webContents: WebContents): void {
  sender = webContents
}

export function respondToApproval(id: string, approved: boolean): void {
  const resolve = pending.get(id)
  if (!resolve) return
  pending.delete(id)
  resolve(approved)
}

export function requestApproval(agentId: string, command: string, reason: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    if (!sender) {
      // No UI attached — deny by default rather than silently allow.
      resolve(false)
      return
    }
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    pending.set(id, resolve)
    sender.send('approval:request', { id, agentId, command, reason } satisfies ApprovalRequest)

    // Timeout: if no response in 5 minutes, deny.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve(false)
      }
    }, 5 * 60 * 1000)
  })
}
