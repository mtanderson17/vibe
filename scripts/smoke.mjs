// Launch the built app and check it actually works, then exit.
//
// The test suite proves modules behave; this proves the *app* starts: Electron
// boots, the window opens, the renderer mounts real DOM, and the contextBridge
// is wired. Those are the things a unit test structurally cannot reach, and
// until this existed nobody had ever confirmed them anywhere but one Windows
// machine.
//
// Driven over Electron's remote debugging port using Node's built-in
// WebSocket, so it needs no Playwright and no extra dependency.
//
// Usage: npm run build && npm run smoke
// On Linux a display is required: xvfb-run -a npm run smoke

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.SMOKE_PORT ?? 9222)
const sleep = ms => new Promise(r => setTimeout(r, ms))

if (!existsSync(path.join(repoRoot, 'out', 'main', 'index.js'))) {
  console.error('No build found at out/main/index.js — run `npm run build` first.')
  process.exit(1)
}

const args = ['.', `--remote-debugging-port=${PORT}`]
// CI Linux runners have unprivileged user namespaces locked down, which the
// Chromium sandbox needs. Only relax it there.
if (process.platform === 'linux') args.push('--no-sandbox')

const mainOutput = []
const child = spawn(electronPath, args, {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env, VIBE_SMOKE: '1' }
})
child.stdout.on('data', b => mainOutput.push(b.toString()))
child.stderr.on('data', b => mainOutput.push(b.toString()))

let exitedEarly = null
child.on('exit', code => { exitedEarly = code })

/** Minimal CDP client over the built-in WebSocket. */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const events = []
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('could not open a CDP connection')))
  })
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method) {
      events.push(msg)
    }
  })
  const send = (method, params = {}) => new Promise(resolve => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  return { ready, send, events, close: () => ws.close() }
}

async function waitForPage(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exitedEarly !== null) return null
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const page = (await res.json()).find(t => t.type === 'page')
      if (page) return page
    } catch { /* port not listening yet */ }
    await sleep(250)
  }
  return null
}

const failures = []
function check(label, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)})`}`)
  if (!ok) failures.push(label)
}

function killApp() {
  try { child.kill() } catch { /* already gone */ }
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  }
}

try {
  const page = await waitForPage()
  if (!page) {
    console.error(exitedEarly !== null
      ? `Electron exited with code ${exitedEarly} before opening a window.`
      : 'Timed out waiting for a window.')
    console.error('--- main process output ---\n' + (mainOutput.join('') || '(silent)'))
    process.exit(1)
  }

  const client = cdp(page.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Log.enable')
  await sleep(3000)   // let the renderer mount and startup IPC settle

  const evaluate = async expression => {
    const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(`evaluate threw: ${r.result.exceptionDetails.text}`)
    return r.result?.result?.value
  }

  check('window opened', true, true)
  check('document.title', await evaluate('document.title'), 'Vibe')
  check('renderer mounted DOM', await evaluate('!!document.getElementById("root")?.children.length'), true)
  check(
    'a known screen rendered',
    await evaluate(`
      document.querySelector('.settings-page') ? 'settings'
      : document.querySelector('.app-shell') ? 'shell'
      : 'none'
    `),
    v => v === 'settings' || v === 'shell'
  )
  check(
    'contextBridge exposes window.vibe',
    await evaluate('typeof window.vibe === "object" && typeof window.vibe.config?.get === "function"'),
    true
  )
  check('body has visible text', await evaluate('document.body.innerText.trim().length > 0'), true)

  const errors = client.events.filter(e =>
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
    e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  )

  // Electron logs some of its own startup failures into the renderer console
  // from inside its bundled js2c code. On the Windows CI runner it reliably
  // emits "sandboxed_renderer.bundle.js script failed to run" plus a
  // destructure of a null `binding.startupData` — both from
  // node:electron/js2c/sandbox_bundle, neither from us, and demonstrably not
  // fatal: the contextBridge check above passes in the same run.
  //
  // So classify by origin rather than suppressing wholesale. Anything traceable
  // to our own code still fails the run; Electron's internals are reported and
  // moved past. If this ever hides something real, the fix is to narrow the
  // predicate, not to widen it.
  const INTERNAL = /node:electron|sandbox(ed)?_(renderer|bundle)|js2c/
  const describe = e => ({
    text: String(
      e.params?.entry?.text
      ?? e.params?.exceptionDetails?.text
      ?? (e.params?.args ?? []).map(a => a.value ?? a.description).join(' ')
    ),
    urls: [
      e.params?.entry?.url,
      e.params?.exceptionDetails?.url,
      ...(e.params?.stackTrace?.callFrames ?? []).map(f => f.url),
      ...(e.params?.exceptionDetails?.stackTrace?.callFrames ?? []).map(f => f.url)
    ].filter(Boolean)
  })

  const classified = errors.map(e => {
    const { text, urls } = describe(e)
    const internal = INTERNAL.test(text) || (urls.length > 0 && urls.every(u => INTERNAL.test(u)))
    return { method: e.method, text, internal }
  })

  const appErrors = classified.filter(e => !e.internal)
  const internalErrors = classified.filter(e => e.internal)

  check('no renderer errors from our code', appErrors.length, 0)
  for (const e of appErrors.slice(0, 10)) {
    console.log(`        ${e.method}: ${e.text.slice(0, 300)}`)
  }
  if (internalErrors.length) {
    console.log(`note  ${internalErrors.length} Electron-internal console error(s), not failing the run:`)
    for (const e of internalErrors.slice(0, 5)) {
      console.log(`        ${e.text.split('\n')[0].slice(0, 200)}`)
    }
  }

  client.close()

  if (failures.length) {
    console.error(`\n${failures.length} smoke check(s) failed: ${failures.join(', ')}`)
    console.error('--- main process output ---\n' + (mainOutput.join('') || '(silent)'))
    process.exitCode = 1
  } else {
    console.log('\nAll smoke checks passed.')
  }
} catch (err) {
  console.error('Smoke run errored:', err.message)
  console.error('--- main process output ---\n' + (mainOutput.join('') || '(silent)'))
  process.exitCode = 1
} finally {
  killApp()
  await sleep(500)
}
