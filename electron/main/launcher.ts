// Detached process launcher for long-running apps (dev servers, build watchers, etc.)
// Used by the PM agent so it can `launch_app("npm run dev")` and return immediately
// while the process keeps running.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, openSync, readSync, closeSync, statSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

interface Launched {
  pid: number
  command: string
  cwd: string
  startedAt: string
  child: ChildProcess
  logPath: string
}

const running = new Map<number, Launched>()
const MAX_TAIL = 4000  // bytes of output to report per process

export interface LaunchedApp {
  pid: number
  command: string
  cwd: string
  startedAt: string
  alive: boolean
  earlyOutput?: string   // first 1.5s of output, useful for detecting startup errors
  logPath?: string       // where the full output is, for anyone who wants more than the tail
}

// Output goes to a log file rather than a pipe, because a piped stdio does not
// survive `detached: true` on Windows: the intermediate cmd.exe puts the real
// process on a new console and nothing ever reaches our pipes. A redirect works
// identically on all three platforms — and as a bonus the log outlives the Vibe
// session, so `tailApp` still has something to show after a restart.
//
// Logs live in the OS temp dir, not the workspace: it keeps them out of the
// user's repo, and it keeps this module free of any `electron` import, which is
// what lets it be unit-tested outside Electron.
const LOG_DIR = path.join(tmpdir(), 'vibe-app-logs')
const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function newLogPath(): string {
  mkdirSync(LOG_DIR, { recursive: true })
  pruneOldLogs()
  return path.join(LOG_DIR, `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`)
}

// Best-effort housekeeping so the temp dir doesn't grow without bound. A log
// still being written is locked on Windows and simply fails to delete.
function pruneOldLogs(): void {
  try {
    const cutoff = Date.now() - LOG_MAX_AGE_MS
    for (const name of readdirSync(LOG_DIR)) {
      if (!name.endsWith('.log')) continue
      const full = path.join(LOG_DIR, name)
      try {
        if (statSync(full).mtimeMs < cutoff) rmSync(full, { force: true })
      } catch { /* in use, or vanished */ }
    }
  } catch { /* dir unreadable — not worth failing a launch over */ }
}

/** Last `maxBytes` of a log file. Returns '' when it doesn't exist yet. */
export function readLogTail(logPath: string, maxBytes = MAX_TAIL): string {
  try {
    if (!existsSync(logPath)) return ''
    const size = statSync(logPath).size
    if (size === 0) return ''
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const buf = Buffer.alloc(length)
    const fd = openSync(logPath, 'r')
    try {
      readSync(fd, buf, 0, length, start)
    } finally {
      closeSync(fd)
    }
    return buf.toString('utf8')
  } catch {
    return ''
  }
}

// Wait `ms` for the process to exit, then report what it logged. Gives the
// caller a real signal about whether the process actually started.
function waitEarly(
  child: ChildProcess,
  logPath: string,
  ms: number
): Promise<{ exitedEarly: boolean; earlyOutput: string; exitCode: number | null }> {
  return new Promise(resolve => {
    let settled = false
    const finish = (exitedEarly: boolean, exitCode: number | null) => {
      if (settled) return
      settled = true
      resolve({ exitedEarly, earlyOutput: readLogTail(logPath), exitCode })
    }
    child.once('exit', (code) => {
      // Let the shell flush the redirect before we read the file — otherwise a
      // process that printed and exited immediately looks silent.
      setTimeout(() => finish(true, code), 60)
    })
    setTimeout(() => finish(false, null), ms)
  })
}

// Whether to put the child in its own process group / console.
//
// POSIX: yes. `stopApp` kills the whole group with `process.kill(-pid)`, which
// is how a shell and everything it spawned go down together.
//
// Windows: NO, deliberately. `detached` there means CREATE_NEW_CONSOLE, and an
// intermediate shell re-attaches its *children's* standard handles to that new
// console — so anything the launched process prints is unreachable, whether we
// use pipes, an inherited file descriptor, or the shell's own `>` redirect.
// (Measured: `node` spawned directly with detached keeps its output; the same
// command behind cmd.exe or powershell loses it. cmd's own stderr still
// arrives, which is why failures to *start* were visible and everything after
// was not.)
//
// Nothing is lost by dropping it: `stopApp` uses `taskkill /T`, which kills the
// tree without needing a process group, and the "keeps running after Vibe
// closes" rationale never held anyway — index.ts calls `shutdownAllApps()` on
// both `window-all-closed` and `before-quit`, so these processes are killed
// with the app by design.
const DETACH = process.platform !== 'win32'

export async function launchApp(command: string, cwd: string): Promise<LaunchedApp> {
  const isWin = process.platform === 'win32'
  // Use cmd.exe (not powershell) on Windows for launch_app: PowerShell 5.1
  // refuses to run bare `.bat`/`.cmd` filenames from cwd (only from PATH), so
  // `launch.bat` silently exits 0 with no output. cmd.exe runs them naturally,
  // and handles `python script.py`, `npm run dev` etc. equally well.
  // Respect the user's shell on Unix ($SHELL is zsh on macOS Catalina+) so PATH,
  // nvm, pyenv, brew shims etc. resolve the way the user's terminal would.
  const shell = isWin ? 'cmd.exe' : (process.env.SHELL || 'bash')
  const args = isWin ? ['/d', '/s', '/c', command] : ['-lc', command]

  // The child inherits the log file handle directly as its stdout and stderr —
  // no shell redirection, so the command string stays exactly as the user wrote
  // it and never has to survive cmd's quote mangling.
  const logPath = newLogPath()
  const logFd = openSync(logPath, 'a')
  let child: ChildProcess
  try {
    child = spawn(shell, args, {
      cwd,
      detached: DETACH,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true
    })
  } finally {
    closeSync(logFd)   // the child holds its own duplicate of the handle
  }

  const pid = child.pid ?? -1
  if (pid < 0) throw new Error('Failed to spawn process')

  const startedAt = new Date().toISOString()
  running.set(pid, { pid, command, cwd, startedAt, child, logPath })

  child.on('exit', () => running.delete(pid))
  child.on('error', () => running.delete(pid))

  const { exitedEarly, earlyOutput, exitCode } = await waitEarly(child, logPath, 1500)

  if (exitedEarly) {
    const codeHint = exitCode !== null ? ` (exit code ${exitCode})` : ''
    const output = earlyOutput.trim()
      || '(no output — process produced no stdout/stderr before exiting; the command likely does not exist on PATH, or a launcher script exited immediately)'
    throw new Error(`Command exited within 1.5s${codeHint}. Command was: ${command}\n--- output ---\n${output}`)
  }

  child.unref()
  return { pid, command, cwd, startedAt, alive: true, earlyOutput, logPath }
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
  return Array.from(running.values()).map(({ pid, command, cwd, startedAt, child, logPath }) => ({
    pid,
    command,
    cwd,
    startedAt,
    alive: !child.killed,
    logPath
  }))
}

// Get the last ~4KB of output from a running app. Useful for the PM agent to
// diagnose why a launched app doesn't seem to be responding.
export function tailApp(pid: number): { ok: boolean; output: string; alive: boolean } {
  const entry = running.get(pid)
  if (!entry) return { ok: false, output: '(no tracked process — may have exited)', alive: false }
  const output = readLogTail(entry.logPath)
  return {
    ok: true,
    output: output || '(no output yet)',
    alive: !entry.child.killed
  }
}

export function shutdownAllApps(): void {
  for (const pid of running.keys()) {
    stopApp(pid)
  }
}
