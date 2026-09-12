import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises'
import { execFile, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { requiresApproval, requestApproval } from './approval'
import { isMcpTool, callMcpTool, mcpToolsAsOpenAISchemas } from './mcp'

// Track spawned child processes per agent so we can kill them on interrupt
const activeProcesses = new Map<string, Set<ChildProcess>>()

export function trackChildProcess(agentId: string, child: ChildProcess): void {
  if (!activeProcesses.has(agentId)) activeProcesses.set(agentId, new Set())
  activeProcesses.get(agentId)!.add(child)
  child.on('exit', () => activeProcesses.get(agentId)?.delete(child))
}

export function killAgentProcesses(agentId: string): void {
  const procs = activeProcesses.get(agentId)
  if (!procs) return
  for (const p of procs) {
    try { p.kill('SIGKILL') } catch { /* ignore */ }
  }
  procs.clear()
}

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file, relative to the agent worktree root. Optionally provide offset (line number, 1-indexed) and limit (max lines) to page through large files. Returns numbered lines. If the file is > 40k chars and no limit given, output is truncated with a marker.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to worktree root' },
          offset: { type: 'integer', description: 'Line number to start reading from (1-indexed)' },
          limit: { type: 'integer', description: 'Max lines to return' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write (create or overwrite) a file. Prefer `replace_in_file` for existing files when you only need targeted edits — it preserves formatting around the change and is safer against accidentally clobbering unrelated content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Replace exact string(s) in a file. Each block gets applied in order. Fails atomically if any `search` string isn\'t found (or occurs multiple times when `all: false`). Prefer this over write_file when editing existing code — it preserves surrounding content and catches errors when the file has changed unexpectedly.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                search: { type: 'string', description: 'Exact string to find. Must be unique in the file unless `all` is true.' },
                replace: { type: 'string', description: 'Replacement text.' },
                all: { type: 'boolean', description: 'If true, replace all occurrences. Default: false (fail if search matches != 1 occurrence).' }
              },
              required: ['search', 'replace']
            },
            minItems: 1
          }
        },
        required: ['path', 'edits']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories at the given path (relative to worktree). Use "." for the root.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_bash',
      description: 'Run a shell command inside the agent worktree. Returns stdout+stderr. Use for build/test/git status queries. Do not use for long-running processes.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_human',
      description: 'Ask the human a free-form clarifying question and stop for their reply. Use when you need open-ended input. If you have specific discrete choices in mind, prefer `ask_human_choice` — the human can click a button instead of typing.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_human_choice',
      description: 'Ask the human a question with 2-6 discrete options. UI renders as clickable buttons — much faster for the human than typing. Use for decisions like "which of these files?" or "keep old behavior or new one?". If options are open-ended, use `ask_human` instead.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 6
          }
        },
        required: ['question', 'options']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description: 'Maintain a structured todo list for the current task. Use at the START of any non-trivial multi-step task to plan, and UPDATE as you complete steps. Each todo has content + status (pending/in_progress/done). Overwrites the whole list on each call — pass the full desired state.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Short imperative description (e.g. "Read main.py")' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'] }
              },
              required: ['content', 'status']
            }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'todo_read',
      description: 'Read the current todo list. Use when resuming after a long tool loop to remember what remains.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Call ONLY when the task is fully complete and you have no open questions. Provide a short summary for the human reviewer. If you have questions, use `ask_human` instead.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary']
      }
    }
  }
] as const

function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  if (!abs.startsWith(path.resolve(root))) {
    throw new Error(`Path escapes worktree: ${rel}`)
  }
  return abs
}

// Combines built-in TOOL_SCHEMAS with any live MCP tools. Agents get both.
export function allToolSchemas(): Array<Record<string, unknown>> {
  return [...TOOL_SCHEMAS as unknown as Array<Record<string, unknown>>, ...mcpToolsAsOpenAISchemas()]
}

export async function executeTool(
  worktreeRoot: string,
  name: string,
  args: Record<string, unknown>,
  agentId?: string
): Promise<string> {
  // MCP tools are namespaced "mcp_<server>_<tool>" — dispatch out.
  if (isMcpTool(name)) {
    return await callMcpTool(name, args)
  }
  switch (name) {
    case 'read_file': {
      const p = resolveInside(worktreeRoot, String(args.path))
      const content = await readFile(p, 'utf8')
      const offset = typeof args.offset === 'number' ? Math.max(1, args.offset) : undefined
      const limit = typeof args.limit === 'number' ? Math.max(1, args.limit) : undefined
      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n')
        const start = (offset ?? 1) - 1
        const end = limit !== undefined ? start + limit : lines.length
        const slice = lines.slice(start, end)
        const numbered = slice.map((l, i) => `${(start + i + 1).toString().padStart(6, ' ')}\t${l}`).join('\n')
        const suffix = end < lines.length ? `\n... [${lines.length - end} more lines]` : ''
        return numbered + suffix
      }
      return content.length > 40000
        ? content.slice(0, 40000) + '\n... [truncated at 40k chars — use offset/limit to page through]'
        : content
    }
    case 'write_file': {
      const p = resolveInside(worktreeRoot, String(args.path))
      await mkdir(path.dirname(p), { recursive: true })
      await writeFile(p, String(args.content), 'utf8')
      return `Wrote ${args.path} (${String(args.content).length} bytes)`
    }
    case 'replace_in_file': {
      const p = resolveInside(worktreeRoot, String(args.path))
      const original = await readFile(p, 'utf8')
      const edits = Array.isArray(args.edits) ? args.edits : []
      let current = original
      const applied: string[] = []
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i] as { search: string; replace: string; all?: boolean }
        if (typeof e.search !== 'string' || typeof e.replace !== 'string') {
          return `[error] edit ${i}: search and replace must be strings`
        }
        const count = current.split(e.search).length - 1
        if (count === 0) {
          return `[error] edit ${i}: search text not found in ${args.path}\nsearch was:\n${e.search.slice(0, 200)}${e.search.length > 200 ? '…' : ''}`
        }
        if (count > 1 && !e.all) {
          return `[error] edit ${i}: search text appears ${count} times in ${args.path} (need unique match, or set all: true to replace every occurrence)`
        }
        current = e.all ? current.split(e.search).join(e.replace) : current.replace(e.search, e.replace)
        applied.push(`edit ${i}: ${count} occurrence${count === 1 ? '' : 's'} replaced`)
      }
      await writeFile(p, current, 'utf8')
      return `Applied ${edits.length} edit(s) to ${args.path}:\n${applied.join('\n')}`
    }
    case 'list_files': {
      const p = resolveInside(worktreeRoot, String(args.path ?? '.'))
      const entries = await readdir(p, { withFileTypes: true })
      const lines = await Promise.all(entries.map(async e => {
        const kind = e.isDirectory() ? 'dir' : 'file'
        let size = ''
        if (e.isFile()) {
          try {
            const s = await stat(path.join(p, e.name))
            size = ` (${s.size}b)`
          } catch { /* ignore */ }
        }
        return `${kind}\t${e.name}${size}`
      }))
      return lines.join('\n') || '(empty)'
    }
    case 'run_bash': {
      const command = String(args.command)
      // Approval gate for dangerous commands. If no agentId (shouldn't happen
      // during normal runs), skip the gate to avoid deadlock.
      if (agentId) {
        const reason = requiresApproval(command)
        if (reason) {
          const approved = await requestApproval(agentId, command, reason)
          if (!approved) {
            return `[denied by user] Command not run: ${command}\nReason it required approval: ${reason}`
          }
        }
      }
      return await new Promise<string>(resolve => {
        const isWin = process.platform === 'win32'
        const child = execFile(
          isWin ? 'powershell' : (process.env.SHELL || 'bash'),
          isWin ? ['-NoProfile', '-Command', command] : ['-lc', command],
          { cwd: worktreeRoot, windowsHide: true, maxBuffer: 5 * 1024 * 1024, timeout: 60_000 },
          (err, stdout, stderr) => {
            if (err) {
              const e = err as { stdout?: string; stderr?: string; message: string }
              resolve(`[error]\n${e.stderr || stderr || e.stdout || stdout || e.message}`)
              return
            }
            const out = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
            resolve(out || '(no output)')
          }
        )
        if (agentId) trackChildProcess(agentId, child)
      })
    }
    case 'ask_human': {
      return `Question posted to human. Waiting for reply.`
    }
    case 'ask_human_choice': {
      const opts = Array.isArray(args.options) ? args.options : []
      return `Question posted to human with ${opts.length} choices. Waiting for reply.`
    }
    case 'todo_write': {
      const todos = Array.isArray(args.todos) ? args.todos : []
      const todoPath = path.join(worktreeRoot, '.vibe-todos.json')
      await writeFile(todoPath, JSON.stringify({ todos, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
      return `Todos updated (${todos.length} items).`
    }
    case 'todo_read': {
      const todoPath = path.join(worktreeRoot, '.vibe-todos.json')
      try {
        const raw = await readFile(todoPath, 'utf8')
        const parsed = JSON.parse(raw)
        const todos = parsed.todos ?? []
        if (!todos.length) return '(no todos)'
        return todos.map((t: { status: string; content: string }, i: number) =>
          `${i + 1}. [${t.status}] ${t.content}`
        ).join('\n')
      } catch {
        return '(no todo list yet — use todo_write to create one)'
      }
    }
    case 'finish': {
      return `Task finished: ${args.summary}`
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
