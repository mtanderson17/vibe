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
import { appendLedgerEntry, estimateCost } from './ledger'
import { getPricing } from './pricing'
import { readContext, readSummary, writeSummary, summaryLastModified } from './context'
import { createTask, loadTasks, updateTask } from './tasks'
import { launchApp, stopApp, listRunningApps, tailApp } from './launcher'

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
      description: 'Read a file from the project directory. Paths MUST be RELATIVE (e.g. "src/main.py", "README.md"). Do NOT use absolute paths starting with /, C:\\, /workspace/, etc. — those will fail. Use "." for the root.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path from project root, e.g. "src/index.ts"' } }, required: ['path'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files/directories at a path relative to project root. Use "." for root. Paths MUST be relative (no leading /, no /workspace/ prefix).',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path from project root, or "." for root' } }, required: ['path'] }
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
      description: 'Return the current tasks list (including task IDs) so you can see what already exists before proposing new ones or updating them.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description: 'Change a task\'s status. Common uses: reset an abandoned in_progress task back to backlog after the assigned agent was killed; mark a task done that was completed outside Vibe. Get task IDs from list_current_tasks first.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The task id (e.g. "task-lg8x2f-abc1")' },
          status: { type: 'string', enum: ['backlog', 'in_progress', 'awaiting_merge', 'done'] },
          unassign: { type: 'boolean', description: 'If true, also clear the assignedTo field. Use when resetting to backlog.' }
        },
        required: ['task_id', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'launch_app',
      description: `Launch a long-running process (dev server, build watcher, tests in watch mode). Spawns detached from workspace root. Waits 1.5s — if it exited in that window, returns an error with startup output. If it stays running, returns pid + first output burst (useful to see the real port). Use tail_app(pid) later for more output.

How to pick the command (INSPECT THE PROJECT FIRST via list_files):
- Has package.json with "scripts.dev" or "scripts.start" → \`npm run dev\` or \`npm start\`
- Has vite.config.* → \`npx vite\`
- Has next.config.* → \`npx next dev\`
- Static HTML site (index.html at root, no package.json / no build step) → \`npx --yes serve -l 8000 .\` OR \`python -m http.server 8000\`
- Python: \`python main.py\` (or \`app.py\`, \`server.py\` — whichever exists)
- Rust: \`cargo run\`
- Go: \`go run .\`

If the first attempt exits immediately, READ THE ERROR OUTPUT — it usually says what's missing (e.g. "npm: no such script: dev" means try a different command).`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to launch, e.g. "npm run dev" or "python main.py"' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stop_app',
      description: 'Stop a previously launched app by its pid. Kills the whole process tree.',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'integer' } },
        required: ['pid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_running_apps',
      description: 'List all apps currently running that were launched via launch_app.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'tail_app',
      description: 'Get the last ~4KB of stdout/stderr from a launched app. Use to diagnose "why is the server not responding" — you can see the actual port it bound to, or crash traces.',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'integer' } },
        required: ['pid']
      }
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
      return tasks
        .map(t => `${t.id} [${t.status}${t.proposed ? '/proposed' : ''}] ${t.title}${t.assignedTo ? ` → ${t.assignedTo}` : ''}`)
        .join('\n')
    }
    case 'update_task_status': {
      const patch: Record<string, unknown> = { status: String(args.status) }
      if (args.unassign) patch.assignedTo = null
      const updated = await updateTask(workspace, String(args.task_id), patch)
      if (!updated) return `[error] task ${args.task_id} not found`
      return `Updated ${updated.id}: status=${updated.status}${args.unassign ? ' (unassigned)' : ''}`
    }
    case 'launch_app': {
      try {
        const launched = await launchApp(String(args.command), workspace)
        const outHint = launched.earlyOutput?.trim()
          ? `\n--- initial output ---\n${launched.earlyOutput}`
          : ''
        return `Launched (pid=${launched.pid}): ${launched.command}\nRunning in background. Use stop_app(pid=${launched.pid}) to stop, or tail_app(pid=${launched.pid}) to see recent output.${outHint}`
      } catch (e) {
        return `[error] Failed to launch: ${(e as Error).message}`
      }
    }
    case 'stop_app': {
      const result = stopApp(Number(args.pid))
      return result.message
    }
    case 'list_running_apps': {
      const apps = listRunningApps()
      if (apps.length === 0) return '(no apps running)'
      return apps.map(a => `pid=${a.pid} · started ${a.startedAt} · ${a.command}`).join('\n')
    }
    case 'tail_app': {
      const t = tailApp(Number(args.pid))
      return `alive=${t.alive}\n--- output ---\n${t.output || '(no output yet)'}`
    }
    case 'finish':
      return `Done: ${args.summary}`
    default:
      return `[error] Unknown tool: ${name}`
  }
}

function buildPmSystemPrompt(projectContext: string, currentSummary: string, tasksBrief: string, trigger: 'merge' | 'manual' | 'chat'): string {
  const summaryDirective = trigger === 'chat'
    ? 'If the user asked a question you can just answer, call finish with the answer. If they asked you to change something (update summary, propose task, launch app), do that first, THEN call finish.'
    : `You MUST call \`update_summary\` at least once this run — even if changes since last summary are small, produce a fresh version that reflects the current state. Do NOT call \`finish\` before calling \`update_summary\`. If you truly have nothing to change, write the existing summary back verbatim so the file's timestamp updates and users see PM ran.`

  return `You are the Project Manager agent for a coding project managed via the Vibe IDE.

Your job:
- Maintain a concise, current project summary that other coding agents read at every turn
- Watch git history and update the summary to reflect real changes (not speculation)
- Propose follow-up tasks for genuine gaps or tech debt, not aspirational features
- Answer human questions about project state when they chat with you
- Launch/stop the project's dev server or app when asked (use launch_app / stop_app)

Rules:
- Be terse. The summary is prepended to every agent prompt — every wasted word costs.
- ${summaryDirective}
- Only propose tasks that follow from observed reality (a broken test, a TODO in code, a partial implementation). No feature-brainstorming.
- Check existing tasks before proposing — never propose duplicates.
- Use ONLY the tools listed above. Do NOT invent tool names like \`exec\`, \`shell\`, \`bash\`, \`run\`, \`fetch\`, \`http\`. If you need to run a shell command, that's not available to you — describe what would need to run in your finish summary.
- File paths for read_file/list_files are RELATIVE to the project root. Never use absolute paths (no leading /, no /workspace/, no C:\\).

Existing project context (human-owned, do not edit):
${projectContext}

Current summary (yours to update):
${currentSummary}

Current tasks:
${tasksBrief}`
}

async function runPmLoop(workspace: string, model: string, kickoff: string, trigger: 'merge' | 'manual' | 'chat'): Promise<void> {
  const cfg = getConfig()
  const projectContext = await readContext(workspace).catch(() => '(no project context)')
  const currentSummary = await readSummary(workspace).catch(() => '(no summary yet)')
  const tasks = await loadTasks(workspace)
  const tasksBrief = tasks.length
    ? tasks.map(t => `- [${t.status}${t.proposed ? '/proposed' : ''}] ${t.title}`).join('\n')
    : '(no tasks yet)'

  const systemMsg: Message = {
    role: 'system',
    content: buildPmSystemPrompt(projectContext, currentSummary, tasksBrief, trigger)
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
  let updateSummaryWasCalled = false

  while (steps < MAX) {
    steps++
    const { message, usage } = await chatCompletion({
      keys: {
        openrouter: cfg.openrouterApiKey,
        anthropic: cfg.anthropicApiKey,
        openai: cfg.openaiApiKey,
        gemini: cfg.geminiApiKey,
        groq: cfg.groqApiKey,
        xai: cfg.xaiApiKey
      },
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

    // Log to persistent ledger
    if (usage) {
      const modelForLedger = state.pinnedModel ?? model.split(',')[0].trim()
      getPricing().then(pricing => {
        const cost = estimateCost(modelForLedger, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, pricing)
        return appendLedgerEntry(workspace, {
          timestamp: new Date().toISOString(),
          source: 'pm-agent',
          model: modelForLedger,
          branch: null,
          task: kickoff.slice(0, 80),
          prompt_tokens: usage.prompt_tokens ?? 0,
          completion_tokens: usage.completion_tokens ?? 0,
          total_tokens: usage.total_tokens ?? 0,
          cost_usd: cost
        })
      }).catch(err => console.error('[vibe] pm ledger write failed', err))
    }

    if (!message.toolCalls || message.toolCalls.length === 0) break

    const result = await executeToolCalls({
      toolCalls: message.toolCalls,
      execute: (name, args) => {
        if (name === 'update_summary') updateSummaryWasCalled = true
        return executePmTool(workspace, name, args)
      }
    })
    messages.push(...result.messages)
    state.messages.push(...result.messages)
    result.messages.forEach(m => emit('message', m))
    if (result.calledFinish) break
  }

  // Merge/manual triggers should always update the summary. If the model called
  // finish without touching update_summary, surface that so the UI at least shows
  // the PM ran but nothing changed — better than silent no-op.
  if (!updateSummaryWasCalled && trigger !== 'chat') {
    state.messages.push({
      role: 'system',
      content: `[PM finished without calling update_summary. The summary file was not touched. Try Regenerate again — the model may have skipped the tool call.]`
    })
    emit('message', state.messages[state.messages.length - 1])
  }
}

export async function runPmAgent(trigger: 'merge' | 'manual' | 'chat', userInput?: string): Promise<void> {
  if (state.status === 'running') throw new Error('PM agent already running')
  const cfg = getConfig()
  if (!cfg.workspacePath) throw new Error('No workspace')
  const hasKey = cfg.openrouterApiKey || cfg.anthropicApiKey || cfg.openaiApiKey || cfg.geminiApiKey || cfg.groqApiKey || cfg.xaiApiKey
  if (!hasKey && !cfg.model.startsWith('ollama/')) {
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
    // Use PM-specific model if configured, else the global default
    const effectiveModel = (cfg.pmModel && cfg.pmModel.trim()) || cfg.model
    await runPmLoop(cfg.workspacePath, effectiveModel, kickoff, trigger)
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
