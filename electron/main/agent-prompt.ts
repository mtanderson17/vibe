// Pure prompt-building for agents. Extracted so we can test the composition
// logic without pulling in the whole agent loop.

import type { AgentState } from './types'

const ACTIVE_STATUSES: AgentState['status'][] = ['running', 'awaiting_input', 'awaiting_merge']

export function siblingsSummary(
  currentId: string,
  agents: Iterable<AgentState>
): string {
  const others: AgentState[] = []
  for (const a of agents) {
    if (a.id === currentId) continue
    if (!ACTIVE_STATUSES.includes(a.status)) continue
    others.push(a)
  }
  if (others.length === 0) return '(no other agents active)'
  return others
    .map(a => `- ${a.id} [${a.status}] on branch \`${a.branch ?? '?'}\`: ${a.task ?? '(no task)'}`)
    .join('\n')
}

export function buildSystemPrompt(opts: {
  agentsGuide: string
  sharedContext: string
  summary: string
  agentId: string
  worktreePath: string
  siblings: string
}): string {
  return `${opts.agentsGuide}

---

# Project Context
${opts.sharedContext}

---

# Recent Project State (maintained by PM agent)
${opts.summary}

---

# Concurrent Agents
Other agents may be working on this same codebase in parallel branches. Be mindful
if your changes might overlap with theirs — you'll get merge conflicts otherwise.
${opts.siblings}

---

# Your Session
- You are agent: ${opts.agentId}
- Your worktree root: ${opts.worktreePath}`
}
