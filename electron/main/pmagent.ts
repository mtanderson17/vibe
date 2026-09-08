import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { WebContents } from 'electron'
import type { Message, TokenUsage } from './types'
import { chatCompletion } from './providers'
import { getConfig } from './config'
import { executeToolCalls, accumulateUsage, pinnedModelFor } from './tool-loop'
import { readContext, readSummary, writeSummary, summaryLastModified } from './context'
import { createTask, loadTasks } from './tasks'

const exec = promisify(execFile)

export type PmStatus = 'idle' | 'running' | 'error'

export interface PmState {
  status: PmStatus
  lastRun: string | null
  lastTrigger: 'merge' | 'manual' | 'chat' | null
  messages: Message[]
  error?: string
  usage?: TokenUsage
  pinnedModel?: string
}

const state: PmState = {
  status: 'idle',
  lastRun: null,
  lastTrigger: null,
  messages: []
}

let sender: WebContents | null = null

export function bindPmSender(webContents: WebContents): void { sender = webContents }
function emit(type: string, data: unknown): void { sender?.send('pm:event', { type, data }) }

export function getPmState(): PmState { return state }

const PM_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the workspace root (main branch view). Path is relative to workspace root.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files/directories at a path relative to workspace root. Use "." for root.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Return the most recent N git commits with subject and short stats.',
      parameters: { type: 'object', properties: { count: { type: 'integer', default: 10 } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Return the diff of the last N commits (default 1).',
      parameters: { type: 'object', properties: { count: { type: 'integer', default: 1 } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_summary',
      description: 'Overwrite the project summary file with new content. Keep it concise — under 1500 tokens. Include: what the project is, current state, recent significant changes, known issues, active focus.',
      parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_task',
      description: 'Propose a new task for the human to review. Use for follow-up work, obvious tech debt, or gaps you notice. Do not propose speculative or unrequested features.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_current_tasks',
      description: 'Return the current tasks list so you can see what already exists before proposing new ones.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Call when done. Provide a short summary of what you updated or proposed.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }
    }
  }
]

function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  if (!abs.startsWith(path.resolve(root))) throw new Error(`Path escapes workspace: ${rel}`)
  return abs
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, windowsHide: true, maxBuffer: 5 * 1024 * 1024 })
  return stdout.trim()
}

async function executePmTool(
  workspace: string,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case 'read_file': {
      const p = resolveInside(workspace, String(args.path))
      if (!existsSync(p)) return `[error] File not found: ${args.path}`
      const content = await readFile(p, 'utf8')
      return content.length > 40000 ? content.slice(0, 40000) + '\n... [truncated]' : content
    }
    case 'list_files': {
      const p = resolveInside(workspace, String(args.path ?? '.'))
      const entries = await readdir(p, { withFileTypes: true })
      return entries.map(e => `${e.isDirectory() ? 'dir' : 'file'}\t${e.name}`).join('\n') || '(empty)'
    }
    case 'git_log': {
      const n = Number(args.count ?? 10)
      const out = await git(workspace, ['log', `-${n}`, '--pretty=format:%h %s (%an, %ar)', '--shortstat'])
      return out || '(no commits)'
    }
    case 'git_diff': {
      const n = Number(args.count ?? 1)
      const out = await git(workspace, ['diff', `HEAD~${n}..HEAD`])
      return out.length > 40000 ? out.slice(0, 40000) + '\n... [truncated]' : out || '(no changes)'
    }
    case 'update_summary': {
      await writeSummary(workspace, String(args.content))
      return `Summary updated (${String(args.content).length} chars)`
    }
    case 'propose_task': {
      const t = await createTask(workspace, String(args.title), args.description ? String(args.description) : undefined, { proposed: true, proposedBy: 'pm-agent' })
      return `Proposed task: ${t.title} (id: ${t.id})`
    }
    case 'list_current_tasks': {
      const tasks = await loadTasks(workspace)
      if (!tasks.length) return '(no tasks)'
      return tasks.map(t => `[${t.status}${t.proposed ? '/proposed' : ''}] ${t.title}${t.assignedTo ? ` → ${t.assignedTo}` : ''}`).join('\n')
    }
    case 'finish':
      return `Done: ${args.summary}`
    default:
      return `[error] Unknown tool: ${name}`
  }
}

function buildPmSystemPrompt(projectContext: string, currentSummary: string, tasksBrief: string): string {
  return `You are the Project Manager agent for a coding project managed via the Vibe IDE.

Your job:
- Maintain a concise, current project summary that other coding agents read at every turn
- Watch git history and update the summary to reflect real changes (not speculation)
- Propose follow-up tasks for genuine gaps or tech debt, not aspirational features
- Answer human questions about project state when they chat with you

Rules:
- Be terse. The summary is prepended to every agent prompt — every wasted word costs.
- Only propose tasks that follow from observed reality (a broken test, a TODO in code, a partial implementation). No feature-brainstorming.
- Check existing tasks before proposing — never propose duplicates.
- Call \`finish\` when done. If asked a question you can just answer, call finish with the answer.

Existing project context (human-owned, do not edit):
${projectContext}

Current summary (yours to update):
${currentSummary}

Current tasks:
${tasksBrief}`
}

async function runPmLoop(workspace: string, model: string, kickoff: string): Promise<void> {
  const cfg = getConfig()
  const projectContext = await readContext(workspace).catch(() => '(no project context)')
  const currentSummary = await readSummary(workspace).catch(() => '(no summary yet)')
  const tasks = await loadTasks(workspace)
  const tasksBrief = tasks.length
    ? tasks.map(t => `- [${t.status}${t.proposed ? '/proposed' : ''}] ${t.title}`).join('\n')
    : '(no tasks yet)'

  const systemMsg: Message = {
    role: 'system',
    content: buildPmSystemPrompt(projectContext, currentSummary, tasksBrief)
  }
  const userMsg: Message = { role: 'user', content: kickoff }

  // For chat mode we preserve history; for merge/manual we start fresh
  const messages = state.lastTrigger === 'chat' && state.messages.length
    ? [systemMsg, ...state.messages.filter(m => m.role !== 'system'), userMsg]
    : [systemMsg, userMsg]

  state.messages = messages.filter(m => m.role !== 'system')
  emit('message', userMsg)

  let steps = 0
  const MAX = 12

  while (steps < MAX) {
    steps++
    const { message, usage } = await chatCompletion({
      keys: { openrouter: cfg.openrouterApiKey, anthropic: cfg.anthropicApiKey },
      model: state.pinnedModel ?? model,
      messages,
      tools: PM_TOOL_SCHEMAS as unknown as Array<Record<string, unknown>>
    })
    messages.push(message)
    state.messages.push(message)
    emit('message', message)

    state.pinnedModel = pinnedModelFor(state.pinnedModel, model, message.servedBy)
    const nextUsage = accumulateUsage(state.usage, usage)
    if (nextUsage !== state.usage) {
      state.usage = nextUsage
      emit('usage', state.usage)
    }

    if (!message.toolCalls || message.toolCalls.length === 0) break

    const result = await executeToolCalls({
      toolCalls: message.toolCalls,
      execute: (name, args) => executePmTool(workspace, name, args)
    })
    messages.push(...result.messages)
    state.messages.push(...result.messages)
    result.messages.forEach(m => emit('message', m))
    if (result.calledFinish) break
  }
}

export async function runPmAgent(trigger: 'merge' | 'manual' | 'chat', userInput?: string): Promise<void> {
  if (state.status === 'running') throw new Error('PM agent already running')
  const cfg = getConfig()
  if (!cfg.workspacePath) throw new Error('No workspace')
  if (!cfg.openrouterApiKey && !cfg.anthropicApiKey && !cfg.model.startsWith('ollama/')) {
    throw new Error('No API key or Ollama model')
  }

  state.status = 'running'
  state.lastTrigger = trigger
  state.error = undefined
  emit('status', 'running')

  const kickoff = trigger === 'merge'
    ? 'A merge just completed on the main branch. Review the recent git changes and update the project summary. Propose follow-up tasks only for real, observed gaps or debt.'
    : trigger === 'manual'
    ? 'Regenerate the project summary based on the current state of the codebase.'
    : (userInput ?? 'Continue.')

  try {
    await runPmLoop(cfg.workspacePath, cfg.model, kickoff)
    state.status = 'idle'
    state.lastRun = new Date().toISOString()
    emit('status', 'idle')
  } catch (e) {
    state.status = 'error'
    state.error = (e as Error).message
    emit('error', state.error)
    emit('status', 'error')
  }
}

export function clearPmChat(): void {
  state.messages = []
  state.usage = undefined
  state.pinnedModel = undefined
  emit('cleared', null)
}
