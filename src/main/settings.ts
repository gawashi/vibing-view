import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// ponytail: one small JSON under userData, not electron-store — no dependency for one field (design doc)
const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

function read(): Record<string, unknown> {
  if (!existsSync(settingsPath())) return {}
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {} // corrupt file → treat as empty; next write heals it
  }
}

export function getLastSymbol(): string | null {
  const v = read().lastSymbol
  return typeof v === 'string' ? v : null
}

export function setLastSymbol(symbol: string): void {
  writeFileSync(settingsPath(), JSON.stringify({ ...read(), lastSymbol: symbol }))
}
