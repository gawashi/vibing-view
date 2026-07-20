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

// D-63: sidebar open/closed is UI chrome, persisted here (not in layouts.json/Workspace) so it
// never gets carried by a named layout's save/load.
export function getSidebarOpen(): boolean | null {
  const v = read().sidebarOpen
  return typeof v === 'boolean' ? v : null
}

export function setSidebarOpen(open: boolean): void {
  writeFileSync(settingsPath(), JSON.stringify({ ...read(), sidebarOpen: open }))
}
