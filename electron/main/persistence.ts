import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentState } from './types'

function agentsDir(workspacePath: string): string {
  return path.join(workspacePath, '.vibe', 'agents')
}

export async function saveAgent(workspacePath: string, agent: AgentState): Promise<void> {
  const dir = agentsDir(workspacePath)
  await mkdir(dir, { recursive: true })
  // Never persist while actively running — status should reflect resting state
  const snapshot: AgentState = { ...agent, status: agent.status === 'running' ? 'awaiting_input' : agent.status }
  await writeFile(path.join(dir, `${agent.id}.json`), JSON.stringify(snapshot, null, 2), 'utf8')
}

export async function loadAgents(workspacePath: string): Promise<AgentState[]> {
  const dir = agentsDir(workspacePath)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir)
  const results: AgentState[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = await readFile(path.join(dir, name), 'utf8')
      const parsed = JSON.parse(raw) as AgentState
      // Sanity: force any "running" state to awaiting_input (loop can't be mid-flight after restart)
      if (parsed.status === 'running') parsed.status = 'awaiting_input'
      results.push(parsed)
    } catch { /* skip corrupt file */ }
  }
  return results
}

export async function deleteAgentFile(workspacePath: string, id: string): Promise<void> {
  const p = path.join(agentsDir(workspacePath), `${id}.json`)
  try { await unlink(p) } catch { /* ignore */ }
}
