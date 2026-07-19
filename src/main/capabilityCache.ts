import { app } from 'electron'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { Timeframe } from '@shared/types'
import type { CapabilityStatus } from '@shared/ipc'
import { readJsonFile } from './jsonStore'

type Entry = { status: CapabilityStatus; probedAt: number }
type CapabilitiesFile = Record<string, Partial<Record<Timeframe, Entry>>>

// ponytail: one small JSON under userData, not electron-store — mirrors settings.ts (design doc)
const capabilitiesPath = (): string => join(app.getPath('userData'), 'capabilities.json')

// ponytail: userData file I/O left untested, consistent with settings.ts/keystore.ts (no P1
// precedent for mocking electron's `app` in Vitest) — only the pure logic below (resolveStatus,
// hashApiKey) is unit-tested.
const read = (): CapabilitiesFile => readJsonFile(capabilitiesPath(), {})

function write(data: CapabilitiesFile): void {
  writeFileSync(capabilitiesPath(), JSON.stringify(data))
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

function utcDayStart(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// Pure: an unseen timeframe is 'unknown'; requires-plan is sticky; rate-limited expires at the
// next UTC day rollover (transient — retry tomorrow) (DESIGN-ADDENDUM §8).
export function resolveStatus(entry: Entry | undefined, now: number): CapabilityStatus {
  if (!entry) return 'unknown'
  if (entry.status === 'rate-limited' && entry.probedAt < utcDayStart(now)) return 'unknown'
  return entry.status
}

export function getStatus(apiKey: string, tf: Timeframe, now: number = Date.now()): CapabilityStatus {
  const entry = read()[hashApiKey(apiKey)]?.[tf]
  return resolveStatus(entry, now)
}

export function setStatus(apiKey: string, tf: Timeframe, status: CapabilityStatus, now: number = Date.now()): void {
  const data = read()
  const k = hashApiKey(apiKey)
  data[k] = { ...data[k], [tf]: { status, probedAt: now } }
  write(data)
}

export function clearForKeyChange(): void {
  rmSync(capabilitiesPath(), { force: true })
}
