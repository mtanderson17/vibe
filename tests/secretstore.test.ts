import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptSecret, decryptSecret, isEncryptionAvailable } from '../electron/main/secretstore'

// safeStorage is only available inside a running Electron app. In a plain Node
// test environment (which is what we use for `npm test`), isEncryptionAvailable
// returns false, and encrypt/decrypt should fall through as plaintext.

test('isEncryptionAvailable: returns false outside Electron main process', () => {
  assert.equal(isEncryptionAvailable(), false)
})

test('encryptSecret: null/undefined pass through as null', () => {
  assert.equal(encryptSecret(null), null)
  assert.equal(encryptSecret(undefined), null)
  assert.equal(encryptSecret(''), null)
})

test('encryptSecret: without encryption available, returns value unchanged', () => {
  const plain = 'sk-or-v1-abc123'
  assert.equal(encryptSecret(plain), plain)
})

test('decryptSecret: null/undefined pass through as null', () => {
  assert.equal(decryptSecret(null), null)
  assert.equal(decryptSecret(undefined), null)
  assert.equal(decryptSecret(''), null)
})

test('decryptSecret: plaintext value (no enc: prefix) returned as-is (migration path)', () => {
  const plain = 'sk-or-v1-plain-legacy'
  assert.equal(decryptSecret(plain), plain)
})

test('decryptSecret: enc:-prefixed value with encryption unavailable returns null (safe)', () => {
  // If somehow we have an encrypted value but no way to decrypt, we must NOT
  // return the raw ciphertext (would be sent as an API key). Null is correct.
  const cipher = 'enc:abcdef1234567890=='
  assert.equal(decryptSecret(cipher), null)
})
