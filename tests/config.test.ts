import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMru } from '../electron/main/config'

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
