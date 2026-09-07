import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises'
import { execFile, type ChildProcess } from 'node:child_process'
import path from 'node:path'

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
      description: 'Read the contents of a file, relative to the agent worktree root.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path relative to worktree root' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write (create or overwrite) a file with the given contents. Path is relative to worktree root.',
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
      name: 'finish',
      description: 'Call when the task is complete. Provide a short summary of what was done for the human reviewer.',
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

export async function executeTool(
  worktreeRoot: string,
  name: string,
  args: Record<string, unknown>,
  agentId?: string
): Promise<string> {
  switch (name) {
    case 'read_file': {
      const p = resolveInside(worktreeRoot, String(args.path))
      const content = await readFile(p, 'utf8')
      return content.length > 40000 ? content.slice(0, 40000) + '\n... [truncated]' : content
    }
    case 'write_file': {
      const p = resolveInside(worktreeRoot, String(args.path))
      await mkdir(path.dirname(p), { recursive: true })
      await writeFile(p, String(args.content), 'utf8')
      return `Wrote ${args.path} (${String(args.content).length} bytes)`
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
      return await new Promise<string>(resolve => {
        const child = execFile(
          process.platform === 'win32' ? 'powershell' : 'bash',
          process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-lc', command],
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
    case 'finish': {
      return `Task finished: ${args.summary}`
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
