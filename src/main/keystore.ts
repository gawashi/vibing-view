import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'

const keyPath = (): string => join(app.getPath('userData'), 'apikey.enc')
let cached: string | null = null

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

export function getKeyStatus(): { hasKey: boolean; encryptionAvailable: boolean } {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const hasKey = cached !== null || existsSync(keyPath())
  return { hasKey, encryptionAvailable }
}

export function clearApiKey(): void {
  cached = null
  rmSync(keyPath(), { force: true })
}
