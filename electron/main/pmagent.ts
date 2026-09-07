import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { WebContents } from 'electron'
import type { Message, TokenUsage } from './types'
import { chatCompletion } from './openrouter'
import { getConfig } from './config'
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

async function chatCompletionWithTools(
  apiKey: string,
  model: string,
  messages: Message[],
  signal?: AbortSignal
) {
  // Reuse the existing chatCompletion but with a custom tool set — PM has different tools than agents.
  // Wrap it by patching the request. For simplicity we inline the fetch here.
  const slugs = model.split(',').map(s => s.trim()).filter(Boolean)
  const primary = slugs[0]
  const isOllama = primary?.startsWith('ollama/')
  const baseUrl = isOllama ? 'http://localhost:11434/v1' : 'https://openrouter.ai/api/v1'
  const modelName = isOllama ? primary.slice(7) : (slugs.length > 1 ? undefined : primary)

  const body: Record<string, unknown> = {
    messages: messages.map(m => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
          }))
        }
      }
      return { role: m.role, content: m.content ?? '' }
    }),
    tools: PM_TOOL_SCHEMAS,
    tool_choice: 'auto'
  }
  if (modelName) body.model = modelName
  else body.models = slugs

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!isOllama) {
    headers['Authorization'] = `Bearer ${apiKey}`
    headers['HTTP-Referer'] = 'https://github.com/vibe-ide/vibe'
    headers['X-Title'] = 'Vibe (PM)'
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) throw new Error(`${isOllama ? 'Ollama' : 'OpenRouter'} ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json() as {
    model?: string
    choices: Array<{ message: { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  }
  const choice = data.choices[0]
  const toolCalls = choice.message.tool_calls?.map(tc => {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(tc.function.arguments || '{}') } catch { args = { _raw: tc.function.arguments } }
    return { id: tc.id, name: tc.function.name, arguments: args }
  })
  return {
    message: { role: 'assistant' as const, content: choice.message.content, toolCalls, servedBy: data.model },
    usage: data.usage
  }
}

async function runPmLoop(workspace: string, apiKey: string, model: string, kickoff: string): Promise<void> {
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
    const { message, usage } = await chatCompletionWithTools(apiKey, state.pinnedModel ?? model, messages)
    messages.push(message)
    state.messages.push(message)
    emit('message', message)

    if (!state.pinnedModel && message.servedBy) state.pinnedModel = message.servedBy
    if (usage) {
      const prev = state.usage ?? { prompt: 0, completion: 0, total: 0 }
      state.usage = {
        prompt: prev.prompt + (usage.prompt_tokens ?? 0),
        completion: prev.completion + (usage.completion_tokens ?? 0),
        total: prev.total + (usage.total_tokens ?? 0)
      }
      emit('usage', state.usage)
    }

    if (!message.toolCalls || message.toolCalls.length === 0) break

    let done = false
    for (const call of message.toolCalls) {
      let result = ''
      try {
        result = await executePmTool(workspace, call.name, call.arguments)
      } catch (e) {
        result = `[error] ${(e as Error).message}`
      }
      const toolMsg: Message = { role: 'tool', content: result, toolCallId: call.id, name: call.name }
      messages.push(toolMsg)
      state.messages.push(toolMsg)
      emit('message', toolMsg)
      if (call.name === 'finish') done = true
    }
    if (done) break
  }
}

export async function runPmAgent(trigger: 'merge' | 'manual' | 'chat', userInput?: string): Promise<void> {
  if (state.status === 'running') throw new Error('PM agent already running')
  const cfg = getConfig()
  if (!cfg.workspacePath) throw new Error('No workspace')
  if (!cfg.openrouterApiKey && !cfg.model.startsWith('ollama/')) throw new Error('No API key or Ollama model')

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
    await runPmLoop(cfg.workspacePath, cfg.openrouterApiKey ?? '', cfg.model, kickoff)
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
