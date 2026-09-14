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
import { launchApp, stopApp, listRunningApps, tailApp, readLogTail } from '../electron/main/launcher'

// Canonical form of a path, for comparing against what a child process reports
// as its cwd. `.native` rather than plain realpathSync because each OS mangles
// the temp dir differently: macOS $TMPDIR is a symlink (/var/… → /private/var/…),
// and Windows CI hands out an 8.3 short path (C:\Users\RUNNER~1\…) that the
// child reports in long form (C:\Users\runneradmin\…). The native call resolves
// both; the JS implementation resolves only the symlink.
function canonical(p: string): string {
  return realpathSync.native(p)
}

function scratch() {
  const dir = canonical(mkdtempSync(path.join(tmpdir(), 'vibe-platform-')))
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
    assert.equal(canonical(out.trim()), dir)
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
        // The dead process's own output is what makes this error actionable.
        // This was unobtainable on Windows until output moved to a log file:
        // detached + an intermediate shell put the grandchild on a new console
        // and nothing reached our pipes. The assertion is unconditional now and
        // must stay that way — needing a platform guard here means a regression.
        assert.match(err.message, /died/, 'the early output is the whole point of the message')
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

test('launchApp: a running app writes to a log file that tailApp can read', async () => {
  const { dir, cleanup } = scratch()
  let pid: number | undefined
  try {
    const cmd = writeScript(dir, 'chatty.mjs',
      'console.log("started up")\nconsole.error("a warning")\nsetTimeout(() => {}, 30000)\n')
    const app = await launchApp(cmd, dir)
    pid = app.pid

    assert.ok(app.logPath, 'launchApp should report where the output went')
    assert.match(app.earlyOutput ?? '', /started up/)
    assert.match(app.earlyOutput ?? '', /a warning/, 'stderr belongs in the same log as stdout')

    const tail = tailApp(pid)
    assert.equal(tail.ok, true)
    assert.match(tail.output, /started up/, 'tailApp reads the log, not a dead in-memory buffer')

    stopApp(pid)
    await waitForExit(pid)
    pid = undefined
  } finally {
    if (pid !== undefined) { stopApp(pid); await waitForExit(pid) }
    cleanup()
  }
})

test('launchApp: the command reaches the shell unmodified', async () => {
  const { dir, cleanup } = scratch()
  try {
    // Output is captured through an inherited file descriptor rather than shell
    // redirection, so nothing is appended to the command and it never has to
    // survive cmd's quote mangling. A script echoing its own argv proves it.
    writeFileSync(path.join(dir, 'argv.mjs'), 'console.log(process.argv.slice(2).join("|"))\n', 'utf8')
    await assert.rejects(
      () => launchApp('node argv.mjs alpha beta', dir),
      (err: Error) => {
        assert.match(err.message, /alpha\|beta/, 'arguments must arrive unmangled')
        assert.doesNotMatch(err.message, /2>&1/, 'no redirection should be appended to the command')
        return true
      }
    )
  } finally { cleanup() }
})

test('readLogTail: missing file reads as empty, and long output is tail-truncated', () => {
  const { dir, cleanup } = scratch()
  try {
    assert.equal(readLogTail(path.join(dir, 'nope.log')), '')

    const logPath = path.join(dir, 'big.log')
    writeFileSync(logPath, 'x'.repeat(500) + 'THE-END', 'utf8')
    const tail = readLogTail(logPath, 100)
    assert.equal(tail.length, 100)
    assert.match(tail, /THE-END$/, 'truncation must keep the END of the log, not the start')
  } finally { cleanup() }
})
