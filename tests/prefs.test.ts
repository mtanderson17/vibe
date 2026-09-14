import { test } from 'node:test'
import assert from 'node:assert/strict'
import { submitKeyFor, type SubmitKeyEvent } from '../src/stores/prefs'

function key(k: string, mods: Partial<SubmitKeyEvent> = {}): SubmitKeyEvent {
  return { key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods }
}

test('submitOnEnter: plain Enter submits, modified Enter does not', () => {
  const { isSubmit } = submitKeyFor(true, false)
  assert.equal(isSubmit(key('Enter')), true)
  assert.equal(isSubmit(key('Enter', { shiftKey: true })), false)
  assert.equal(isSubmit(key('Enter', { metaKey: true })), false)
  assert.equal(isSubmit(key('Enter', { ctrlKey: true })), false)
  assert.equal(isSubmit(key('Enter', { altKey: true })), false)
  assert.equal(isSubmit(key('a')), false)
})

test('submitOnEnter off: only Cmd/Ctrl+Enter submits', () => {
  const { isSubmit } = submitKeyFor(false, false)
  assert.equal(isSubmit(key('Enter')), false)
  assert.equal(isSubmit(key('Enter', { shiftKey: true })), false)
  assert.equal(isSubmit(key('Enter', { metaKey: true })), true)
  assert.equal(isSubmit(key('Enter', { ctrlKey: true })), true)
  assert.equal(isSubmit(key('a', { ctrlKey: true })), false)
})

test('hint text follows the preference and the platform', () => {
  assert.equal(submitKeyFor(true, true).hint, 'Enter to send · Shift+Enter for newline')
  assert.equal(submitKeyFor(true, false).hint, 'Enter to send · Shift+Enter for newline')
  assert.equal(submitKeyFor(false, true).hint, '⌘+Enter to send')
  assert.equal(submitKeyFor(false, false).hint, 'Ctrl+Enter to send')
})
