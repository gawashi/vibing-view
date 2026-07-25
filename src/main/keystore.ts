import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'

const keyPath = (): string => join(app.getPath('userData'), 'apikey.enc')
let cached: string | null = null

// Mask a saved key for display: last 4 chars real, rest dotted, total length == key length.
// (This intentionally leaks the key's length — accepted trade-off so the user can identify which
// key is set.)
export function maskKey(key: string): string {
  return key.length > 4 ? '•'.repeat(key.length - 4) + key.slice(-4) : '•'.repeat(key.length)
}

export function setApiKey(key: string): { ok: boolean; encryptionAvailable: boolean } {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  if (!encryptionAvailable) {
    // D-05: do not silently write plaintext. Keep only in memory for this session; caller warns the user.
    cached = key
    return { ok: false, encryptionAvailable: false }
  }
  writeFileSync(keyPath(), safeStorage.encryptString(key))
  cached = key
  return { ok: true, encryptionAvailable: true }
}

export function getApiKey(): string | null {
  if (cached !== null) return cached
  if (!existsSync(keyPath()) || !safeStorage.isEncryptionAvailable()) return null
  cached = safeStorage.decryptString(readFileSync(keyPath()))
  return cached
}

export function getKeyStatus(): { hasKey: boolean; encryptionAvailable: boolean; maskedKey?: string } {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const hasKey = cached !== null || existsSync(keyPath())
  // Only include a preview when we can actually read the key back. If it's saved but undecryptable
  // (encryption unavailable / unreadable file), omit maskedKey → UI falls back to "saved" only.
  const key = hasKey ? getApiKey() : null
  return key !== null ? { hasKey, encryptionAvailable, maskedKey: maskKey(key) } : { hasKey, encryptionAvailable }
}

export function clearApiKey(): void {
  cached = null
  rmSync(keyPath(), { force: true })
}
