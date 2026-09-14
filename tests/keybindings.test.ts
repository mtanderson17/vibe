import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEYBINDINGS, resolveAccelerator, listResolvedBindings } from '../electron/main/keybindings'

test('resolveAccelerator falls back to the default when no override exists', () => {
  assert.equal(resolveAccelerator('new-task', undefined), 'CommandOrControl+Shift+T')
  assert.equal(resolveAccelerator('new-task', {}), 'CommandOrControl+Shift+T')
  assert.equal(resolveAccelerator('new-task', { palette: 'Ctrl+P' }), 'CommandOrControl+Shift+T')
})

test('resolveAccelerator honors a user override', () => {
  assert.equal(resolveAccelerator('new-task', { 'new-task': 'Ctrl+Alt+N' }), 'Ctrl+Alt+N')
})

test('resolveAccelerator treats an empty override as unbound', () => {
  assert.equal(resolveAccelerator('new-task', { 'new-task': '' }), '')
})

test('resolveAccelerator returns empty for an unknown id', () => {
  assert.equal(resolveAccelerator('does-not-exist', { 'does-not-exist': 'Ctrl+X' }), '')
})

test('keybinding ids are unique and every spec has a default', () => {
  const ids = KEYBINDINGS.map(k => k.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate keybinding id')
  for (const spec of KEYBINDINGS) {
    assert.ok(spec.defaultAccelerator.length > 0, `${spec.id} has no default accelerator`)
    assert.ok(spec.label.length > 0, `${spec.id} has no label`)
  }
})

test('listResolvedBindings stays in sync with KEYBINDINGS', () => {
  const rows = listResolvedBindings({ 'view-tasks': 'Ctrl+Shift+2', 'palette': '' })
  assert.equal(rows.length, KEYBINDINGS.length)
  assert.deepEqual(rows.map(r => r.id), KEYBINDINGS.map(k => k.id))

  const tasks = rows.find(r => r.id === 'view-tasks')!
  assert.equal(tasks.current, 'Ctrl+Shift+2')
  assert.equal(tasks.defaultAccelerator, 'CommandOrControl+2', 'default must survive an override')

  const palette = rows.find(r => r.id === 'palette')!
  assert.equal(palette.current, '', 'unbound override should render as empty')

  const newAgent = rows.find(r => r.id === 'new-agent')!
  assert.equal(newAgent.current, newAgent.defaultAccelerator)
})

test('the Settings accelerator follows the platform convention', () => {
  // The one keybinding with a platform branch: macOS users expect Cmd+, for
  // preferences; everyone else gets Ctrl+,. CI runs this on all three.
  const expected = process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,'
  assert.equal(resolveAccelerator('settings', undefined), expected)
})

test('a user override beats the platform default for Settings too', () => {
  assert.equal(resolveAccelerator('settings', { settings: 'Ctrl+Alt+P' }), 'Ctrl+Alt+P')
})
