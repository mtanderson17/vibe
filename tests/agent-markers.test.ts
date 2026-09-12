import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickStopMarker } from '../electron/main/agent'

test('pickStopMarker: at-limit + has content → hit_limit (limit takes precedence)', () => {
  const r = pickStopMarker({ atLimit: true, hasContent: true, maxSteps: 100 })
  assert.equal(r.marker, 'hit_limit')
  assert.match(r.content, /step limit \(100\)/)
})

test('pickStopMarker: at-limit + no content → still hit_limit', () => {
  const r = pickStopMarker({ atLimit: true, hasContent: false, maxSteps: 100 })
  assert.equal(r.marker, 'hit_limit')
})

test('pickStopMarker: not at-limit + has content → stopped_no_tool', () => {
  const r = pickStopMarker({ atLimit: false, hasContent: true, maxSteps: 100 })
  assert.equal(r.marker, 'stopped_no_tool')
  assert.match(r.content, /stopped without calling a tool/)
})

test('pickStopMarker: not at-limit + no content → empty_response', () => {
  const r = pickStopMarker({ atLimit: false, hasContent: false, maxSteps: 100 })
  assert.equal(r.marker, 'empty_response')
  assert.match(r.content, /empty response/)
})

test('pickStopMarker: maxSteps interpolates into the hit_limit message', () => {
  const r = pickStopMarker({ atLimit: true, hasContent: false, maxSteps: 42 })
  assert.match(r.content, /step limit \(42\)/)
  assert.match(r.content, /another 42 steps/)
})
