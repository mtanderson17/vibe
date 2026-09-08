// Encrypted-at-rest storage for API keys via Electron's safeStorage API.
// On macOS: uses Keychain (AES-CBC via kSecClass). On Windows: DPAPI.
// On Linux: uses kwallet/gnome-libsecret if available; falls back to plain text.
//
// Falls back gracefully when safeStorage isn't available (older Electron on Linux
// without a keyring). Migrates plain-text values transparently on read.

import { safeStorage } from 'electron'

const CIPHERTEXT_PREFIX = 'enc:'  // marker so we can distinguish encrypted vs plain values

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

// Encrypt a plain-text secret and return a marker-prefixed base64 ciphertext.
// If encryption isn't available on this platform, returns the plain value unchanged.
export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return null
  if (!isEncryptionAvailable()) return plain
  try {
    const buf = safeStorage.encryptString(plain)
    return CIPHERTEXT_PREFIX + buf.toString('base64')
  } catch (e) {
    console.warn('[vibe] encryptSecret failed, storing plain', e)
    return plain
  }
}

// Decrypt if the stored value is marker-prefixed. Otherwise return as-is (plain
// text — either legacy or platform without encryption). This gives us free
// migration: on first read of a plain value we don't touch it; the next write
// through encryptSecret encrypts it.
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (!stored.startsWith(CIPHERTEXT_PREFIX)) return stored
  if (!isEncryptionAvailable()) {
    console.warn('[vibe] have encrypted secret but encryption unavailable — returning null')
    return null
  }
  try {
    const buf = Buffer.from(stored.slice(CIPHERTEXT_PREFIX.length), 'base64')
    return safeStorage.decryptString(buf)
  } catch (e) {
    console.warn('[vibe] decryptSecret failed', e)
    return null
  }
}
