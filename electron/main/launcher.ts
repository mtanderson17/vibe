// Detached process launcher for long-running apps (dev servers, build watchers, etc.)
// Used by the PM agent so it can `launch_app("npm run dev")` and return immediately
// while the process keeps running.

import { spawn, type ChildProcess } from 'node:child_process'

interface Launched {
  pid: number
  command: string
  cwd: string
  startedAt: string
  child: ChildProcess
  outputTail: string     // last N chars of combined stdout/stderr — kept for diagnostics
}

const running = new Map<number, Launched>()
const MAX_TAIL = 4000  // chars of output to keep per process

export interface LaunchedApp {
  pid: number
  command: string
  cwd: string
  startedAt: string
  alive: boolean
  earlyOutput?: string   // first 1.5s of output, useful for detecting startup errors
}

// Wait `ms` for the process to either exit or produce output, then resolve.
// Used to give the caller a real-ish signal about whether the process started ok.
function waitEarly(child: ChildProcess, ms: number): Promise<{ exitedEarly: boolean; earlyOutput: string; exitCode: number | null }> {
  return new Promise(resolve => {
    let earlyOutput = ''
    let exitedEarly = false
    let exitCode: number | null = null
    let settled = false
    const finish = () => { if (!settled) { settled = true; resolve({ exitedEarly, earlyOutput: earlyOutput.slice(-MAX_TAIL), exitCode }) } }
    const onData = (buf: Buffer) => { earlyOutput += buf.toString('utf8'); if (earlyOutput.length > MAX_TAIL * 2) earlyOutput = earlyOutput.slice(-MAX_TAIL * 2) }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', (code) => { exitedEarly = true; exitCode = code; finish() })
    setTimeout(finish, ms)
  })
}

// Spawn detached — process keeps running after this function returns and after
// Vibe closes. We pipe stdio (rather than 'ignore') so we can report early
// output to the caller; buffered locally so we don't fill disk.
export async function launchApp(command: string, cwd: string): Promise<LaunchedApp> {
  const isWin = process.platform === 'win32'
  const shell = isWin ? 'powershell.exe' : 'bash'
  const args = isWin ? ['-NoProfile', '-Command', command] : ['-lc', command]

  const child = spawn(shell, args, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  const pid = child.pid ?? -1
  if (pid < 0) throw new Error('Failed to spawn process')

  const startedAt = new Date().toISOString()
  const entry: Launched = { pid, command, cwd, startedAt, child, outputTail: '' }
  running.set(pid, entry)

  // Keep buffering output for diagnostics even after early window
  const accum = (buf: Buffer) => {
    entry.outputTail += buf.toString('utf8')
    if (entry.outputTail.length > MAX_TAIL) entry.outputTail = entry.outputTail.slice(-MAX_TAIL)
  }
  child.stdout?.on('data', accum)
  child.stderr?.on('data', accum)
  child.on('exit', () => running.delete(pid))
  child.on('error', () => running.delete(pid))

  const { exitedEarly, earlyOutput, exitCode } = await waitEarly(child, 1500)

  if (exitedEarly) {
    const codeHint = exitCode !== null ? ` (exit code ${exitCode})` : ''
    const output = earlyOutput.trim() || '(no output — process produced no stdout/stderr before exiting; the command may not exist, or PowerShell silently swallowed the error)'
    throw new Error(`Command exited within 1.5s${codeHint}. Command was: ${command}\n--- output ---\n${output}`)
  }

  child.unref()
  return { pid, command, cwd, startedAt, alive: true, earlyOutput }
}

export function stopApp(pid: number): { ok: boolean; message: string } {
  const entry = running.get(pid)
  if (!entry) return { ok: false, message: `No tracked process with pid ${pid}` }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      try { process.kill(-pid, 'SIGTERM') } catch { entry.child.kill('SIGTERM') }
    }
    running.delete(pid)
    return { ok: true, message: `Stopped pid ${pid}` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export function listRunningApps(): LaunchedApp[] {
  return Array.from(running.values()).map(({ pid, command, cwd, startedAt, child }) => ({
    pid,
    command,
    cwd,
    startedAt,
    alive: !child.killed
  }))
}

// Get the last ~4KB of output from a running app. Useful for the PM agent to
// diagnose why a launched app doesn't seem to be responding.
export function tailApp(pid: number): { ok: boolean; output: string; alive: boolean } {
  const entry = running.get(pid)
  if (!entry) return { ok: false, output: '(no tracked process — may have exited)', alive: false }
  return { ok: true, output: entry.outputTail, alive: !entry.child.killed }
}

export function shutdownAllApps(): void {
  for (const pid of running.keys()) {
    stopApp(pid)
  }
}
