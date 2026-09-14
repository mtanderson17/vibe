import { stubVibe } from './helpers/dom'   // must come first — installs the DOM
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useMenuCommands, type MenuCommandActions } from '../src/hooks/useMenuCommands'

type Emit = (channel: string, ...args: unknown[]) => void

/** Mounts the hook and returns a function that fires a menu channel at it. */
function mount(overrides: Partial<MenuCommandActions> = {}) {
  const calls: Array<[string, unknown]> = []
  const record = (name: string) => (arg?: unknown) => { calls.push([name, arg]) }

  const actions: MenuCommandActions = {
    agentIds: [],
    focusedAgent: null,
    spawnAgent: () => calls.push(['spawnAgent', undefined]),
    closeAgent: record('closeAgent'),
    setSidebarView: record('setSidebarView'),
    setFocusedAgent: record('setFocusedAgent'),
    openNewTask: () => calls.push(['openNewTask', undefined]),
    openShortcuts: () => calls.push(['openShortcuts', undefined]),
    togglePalette: () => calls.push(['togglePalette', undefined]),
    ...overrides
  }

  let emit: Emit = () => {}
  const restore = stubVibe({
    agents: { kill: (...args: unknown[]) => { calls.push(['kill', args[0]]); return undefined } },
    pm: { run: (...args: unknown[]) => { calls.push(['pm.run', args[0]]); return undefined } },
    workspace: { switch: (...args: unknown[]) => { calls.push(['workspace.switch', args[0]]); return Promise.resolve() } }
  } as never)

  // onMenuCommand isn't part of the default stub — capture the listener here.
  const w = globalThis as unknown as { vibe: Record<string, unknown> }
  w.vibe.onMenuCommand = (cb: Emit) => { emit = cb; return () => { emit = () => {} } }

  const view = renderHook(() => useMenuCommands(actions))
  return {
    calls,
    fire: (channel: string, ...args: unknown[]) => act(() => { emit(channel, ...args) }),
    done: () => { view.unmount(); cleanup(); restore() }
  }
}

test('simple menu channels map to their action', () => {
  const h = mount()
  try {
    h.fire('menu:new-agent')
    h.fire('menu:new-task')
    h.fire('menu:shortcuts')
    h.fire('menu:palette')
    h.fire('menu:settings')
    assert.deepEqual(h.calls, [
      ['spawnAgent', undefined],
      ['openNewTask', undefined],
      ['openShortcuts', undefined],
      ['togglePalette', undefined],
      ['setSidebarView', 'settings']
    ])
  } finally { h.done() }
})

test('menu:view switches screen and drops agent focus', () => {
  const h = mount({ focusedAgent: 'agent-2' })
  try {
    h.fire('menu:view', 'tasks')
    assert.deepEqual(h.calls, [['setSidebarView', 'tasks'], ['setFocusedAgent', null]])
  } finally { h.done() }
})

test('focus-next and focus-prev wrap around the agent list', () => {
  const h = mount({ agentIds: ['agent-1', 'agent-2', 'agent-3'], focusedAgent: 'agent-3' })
  try {
    h.fire('menu:focus-next')
    assert.deepEqual(h.calls.at(-1), ['setFocusedAgent', 'agent-1'], 'next wraps past the end')
    h.fire('menu:focus-prev')
    assert.deepEqual(h.calls.at(-1), ['setFocusedAgent', 'agent-2'])
    assert.ok(h.calls.some(c => c[0] === 'setSidebarView' && c[1] === 'control'),
      'focusing an agent should jump back to the Control Center')
  } finally { h.done() }
})

test('focus-prev from nothing focused lands on the last agent', () => {
  const h = mount({ agentIds: ['agent-1', 'agent-2', 'agent-3'], focusedAgent: null })
  try {
    h.fire('menu:focus-prev')
    assert.deepEqual(h.calls.at(-1), ['setFocusedAgent', 'agent-2'])
  } finally { h.done() }
})

test('focus commands are inert with no agents', () => {
  const h = mount({ agentIds: [], focusedAgent: null })
  try {
    h.fire('menu:focus-next')
    h.fire('menu:focus-prev')
    assert.deepEqual(h.calls, [])
  } finally { h.done() }
})

test('close-agent and stop-current only act on a focused agent', () => {
  const none = mount({ focusedAgent: null })
  try {
    none.fire('menu:close-agent')
    none.fire('menu:stop-current')
    assert.deepEqual(none.calls, [])
  } finally { none.done() }

  const focused = mount({ focusedAgent: 'agent-2' })
  try {
    focused.fire('menu:close-agent')
    focused.fire('menu:stop-current')
    assert.deepEqual(focused.calls, [['closeAgent', 'agent-2'], ['kill', 'agent-2']])
  } finally { focused.done() }
})

test('open-project forwards a path only when the menu supplied one', () => {
  const h = mount()
  try {
    h.fire('menu:open-project', 'C:/code/thing')
    h.fire('menu:open-project')
    h.fire('menu:pm-regenerate')
    assert.deepEqual(h.calls, [
      ['workspace.switch', 'C:/code/thing'],
      ['workspace.switch', undefined],
      ['pm.run', 'manual']
    ])
  } finally { h.done() }
})

test('an unknown channel is ignored', () => {
  const h = mount()
  try {
    h.fire('menu:does-not-exist')
    assert.deepEqual(h.calls, [])
  } finally { h.done() }
})
