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
}

const running = new Map<number, Launched>()

export interface LaunchedApp {
  pid: number
  command: string
  cwd: string
  startedAt: string
  alive: boolean
}

// Spawn detached — process keeps running after this function returns and after
// Vibe closes. Stdio is ignored so we don't fill buffers.
export function launchApp(command: string, cwd: string): LaunchedApp {
  const isWin = process.platform === 'win32'
  const shell = isWin ? 'powershell.exe' : 'bash'
  const args = isWin ? ['-NoProfile', '-Command', command] : ['-lc', command]

  const child = spawn(shell, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })

  const pid = child.pid ?? -1
  if (pid < 0) throw new Error('Failed to spawn process')

  running.set(pid, {
    pid,
    command,
    cwd,
    startedAt: new Date().toISOString(),
    child
  })

  child.on('exit', () => {
    running.delete(pid)
  })
  child.unref()

  return { pid, command, cwd, startedAt: new Date().toISOString(), alive: true }
}

export function stopApp(pid: number): { ok: boolean; message: string } {
  const entry = running.get(pid)
  if (!entry) return { ok: false, message: `No tracked process with pid ${pid}` }
  try {
    if (process.platform === 'win32') {
      // On Windows, spawning kills the whole tree if we use taskkill
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      // Kill process group (negative pid) since we spawned detached
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

// Clean up on Vibe exit — best-effort, doesn't block quit
export function shutdownAllApps(): void {
  for (const pid of running.keys()) {
    stopApp(pid)
  }
}
