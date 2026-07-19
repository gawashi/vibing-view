import { app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { readJsonFile } from './jsonStore'

// ponytail: one small JSON under userData, not electron-store — no dependency for one field (design doc)
const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

const read = (): Record<string, unknown> => readJsonFile(settingsPath(), {})

export function getLastSymbol(): string | null {
  const v = read().lastSymbol
  return typeof v === 'string' ? v : null
}

export function setLastSymbol(symbol: string): void {
  writeFileSync(settingsPath(), JSON.stringify({ ...read(), lastSymbol: symbol }))
}
