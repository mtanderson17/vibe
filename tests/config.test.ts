import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMru, migrateMaxSteps } from '../electron/main/config'

test('computeMru: adds new path to front of empty list', () => {
  assert.deepEqual(computeMru([], '/a'), ['/a'])
})

test('computeMru: adds new path to front of populated list', () => {
  assert.deepEqual(
    computeMru(['/a', '/b'], '/c'),
    ['/c', '/a', '/b']
  )
})

test('computeMru: dedups — existing entry gets moved to front', () => {
  assert.deepEqual(
    computeMru(['/a', '/b', '/c'], '/b'),
    ['/b', '/a', '/c']
  )
})

test('computeMru: caps at maxItems (default 10)', () => {
  const start = Array.from({ length: 10 }, (_, i) => `/dir${i}`)
  const result = computeMru(start, '/new')
  assert.equal(result.length, 10)
  assert.equal(result[0], '/new')
  // Oldest one dropped off the end
  assert.equal(result[result.length - 1], '/dir8')
})

test('computeMru: custom cap respected', () => {
  const result = computeMru(['/a', '/b', '/c'], '/d', 2)
  assert.deepEqual(result, ['/d', '/a'])
})

test('computeMru: re-adding the current top does not duplicate', () => {
  assert.deepEqual(
    computeMru(['/a', '/b'], '/a'),
    ['/a', '/b']
  )
})

// --- migrateMaxSteps: one-time bump of stale 25→100 default ---

test('migrateMaxSteps: bumps exactly-25 (old default) to 100', () => {
  assert.equal(migrateMaxSteps(25), 100)
})

test('migrateMaxSteps: leaves 100 (new default) alone', () => {
  assert.equal(migrateMaxSteps(100), 100)
})

test('migrateMaxSteps: leaves higher explicit values alone', () => {
  assert.equal(migrateMaxSteps(200), 200)
  assert.equal(migrateMaxSteps(500), 500)
})

test('migrateMaxSteps: does NOT touch a low but explicit user value (10)', () => {
  // If the user deliberately set 10 (below the old default), leave it alone —
  // we can't distinguish "explicit low" from "old default" for arbitrary
  // values, so we only match the EXACT old default.
  assert.equal(migrateMaxSteps(10), 10)
})

test('migrateMaxSteps: idempotent — running twice on a fresh 25 stays at 100', () => {
  const once = migrateMaxSteps(25)
  const twice = migrateMaxSteps(once)
  assert.equal(twice, 100)
})

test('migrateMaxSteps: undefined passes through (defaults handle unset case)', () => {
  assert.equal(migrateMaxSteps(undefined), undefined)
})

test('migrateMaxSteps: supports custom old/new pair for future migrations', () => {
  assert.equal(migrateMaxSteps(50, 50, 500), 500)
  assert.equal(migrateMaxSteps(25, 50, 500), 25)  // 25 doesn't match custom oldDefault
})
