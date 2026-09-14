// Platform-behaviour tests: the branches that differ per OS and can only be
// verified by actually running on that OS. CI runs this file on Linux, Windows
// and macOS, which is the whole point — locally it only ever proves one third.
//
// Deliberately uses `node -e ...` for the shell payloads rather than
// echo/pwd/Write-Output: node is the one interpreter guaranteed present and
// identical on all three runners, so the *command* is constant and the only
// variable is the shell plumbing under test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { executeTool } from '../electron/main/tools'
import { launchApp, stopApp, listRunningApps, tailApp } from '../electron/main/launcher'

function scratch() {
  // realpath matters on macOS: $TMPDIR is a symlink (/var/… → /private/var/…),
  // so a child process reports the resolved path and a naive compare fails.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'vibe-platform-')))
  return {
    dir,
    // Best-effort: on Windows a just-stopped detached child can still hold the
    // directory as its cwd. A leaked temp dir is not worth failing a test over.
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      } catch { /* OS reclaims %TEMP% */ }
    }
  }
}

/** stopApp fires taskkill asynchronously on Windows, so it returns before the
 *  process is actually gone. Poll until it is (or give up). */
async function waitForExit(pid: number, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)   // throws ESRCH once the process is gone
    } catch {
      return
    }
    await new Promise(r => setTimeout(r, 50))
  }
}

// --- run_bash: PowerShell on Windows, $SHELL (zsh on macOS) elsewhere ---

test('run_bash: returns stdout from the platform shell', async () => {
  const { dir, cleanup } = scratch()
  try {
    const out = await executeTool(dir, 'run_bash', { command: 'node -e "console.log(42)"' })
    assert.equal(out, '42')
  } finally { cleanup() }
})

test('run_bash: runs inside the worktree, not the app cwd', async () => {
  const { dir, cleanup } = scratch()
  try {
    const out = await executeTool(dir, 'run_bash', { command: 'node -e "console.log(process.cwd())"' })
    assert.equal(realpathSync(out.trim()), dir)
  } finally { cleanup() }
})

test('run_bash: a non-zero exit is reported as [error], not silently swallowed', async () => {
  const { dir, cleanup } = scratch()
  try {
    const out = await executeTool(dir, 'run_bash', {
      command: 'node -e "console.error(\'boom\'); process.exit(3)"'
    })
    assert.ok(out.startsWith('[error]'), `expected an [error] prefix, got: ${out}`)
    assert.match(out, /boom/)
  } finally { cleanup() }
})

test('run_bash: stderr is appended to stdout on success', async () => {
  const { dir, cleanup } = scratch()
  try {
    const out = await executeTool(dir, 'run_bash', {
      command: 'node -e "console.log(\'out\'); console.error(\'warn\')"'
    })
    assert.match(out, /out/)
    assert.match(out, /\[stderr\][\s\S]*warn/)
  } finally { cleanup() }
})

test('run_bash: a silent command reports no output rather than an empty string', async () => {
  const { dir, cleanup } = scratch()
  try {
    const out = await executeTool(dir, 'run_bash', { command: 'node -e "0"' })
    assert.equal(out, '(no output)')
  } finally { cleanup() }
})

test('run_bash: the agent can see files in its own worktree', async () => {
  const { dir, cleanup } = scratch()
  try {
    await executeTool(dir, 'write_file', { path: 'marker.txt', content: 'present' })
    const out = await executeTool(dir, 'run_bash', {
      command: 'node -e "console.log(require(\'fs\').readFileSync(\'marker.txt\',\'utf8\'))"'
    })
    assert.equal(out.trim(), 'present')
  } finally { cleanup() }
})

// --- launch_app: cmd.exe on Windows (PowerShell 5.1 won't run bare .bat), $SHELL elsewhere ---

// launch_app commands go through `cmd.exe /d /s /c` on Windows, where /s strips
// the outer quotes of the whole string — so an inline `node -e "…"` payload gets
// mangled. Real launch commands (`npm run dev`, `python app.py`) carry no quotes,
// so these tests use script files: closer to reality and quote-free by
// construction.
function writeScript(dir: string, name: string, body: string): string {
  writeFileSync(path.join(dir, name), body, 'utf8')
  return `node ${name}`
}

test('launchApp: starts a long-lived process, tracks it, and stops it', async () => {
  const { dir, cleanup } = scratch()
  let pid: number | undefined
  try {
    // Must outlive launchApp's 1.5s early-exit window.
    const cmd = writeScript(dir, 'alive.mjs', 'setTimeout(() => {}, 30000)\n')
    const app = await launchApp(cmd, dir)
    pid = app.pid
    assert.ok(app.pid > 0)
    assert.equal(app.alive, true)

    const running = listRunningApps()
    assert.ok(running.some(a => a.pid === pid), 'launched app should be tracked')

    const tail = tailApp(pid)
    assert.equal(tail.alive, true)

    const stopped = stopApp(pid)
    assert.equal(stopped.ok, true)
    assert.equal(listRunningApps().some(a => a.pid === pid), false)
    await waitForExit(pid)
    pid = undefined
  } finally {
    if (pid !== undefined) { stopApp(pid); await waitForExit(pid) }
    cleanup()
  }
})

test('launchApp: a command that exits immediately throws with its output', async () => {
  const { dir, cleanup } = scratch()
  try {
    const cmd = writeScript(dir, 'die.mjs', 'console.log("died")\nprocess.exit(1)\n')
    await assert.rejects(
      () => launchApp(cmd, dir),
      (err: Error) => {
        assert.match(err.message, /exited within 1\.5s/)
        assert.match(err.message, /die\.mjs/)
        if (process.platform !== 'win32') {
          // The dead process's own output is what makes this error actionable.
          //
          // Excluded on Windows because it is currently always missing there:
          // `detached: true` + an intermediate cmd.exe puts the grandchild on a
          // new console, so nothing reaches our pipes and the user gets the
          // generic "probably not on PATH" hint instead of the real error.
          // See "launch_app output is lost on Windows" in BACKLOG.md — when
          // that's fixed, drop this guard.
          assert.match(err.message, /died/, 'the early output is the whole point of the message')
        }
        return true
      }
    )
  } finally { cleanup() }
})

test('stopApp: an unknown pid reports failure instead of throwing', () => {
  const result = stopApp(999_999_999)
  assert.equal(result.ok, false)
  assert.match(result.message, /No tracked process/)
})
