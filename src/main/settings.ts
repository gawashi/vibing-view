import { app } from 'electron'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from './jsonStore'

// ponytail: one small JSON under userData, not electron-store — no dependency for one field (design doc)
const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

const read = (): Record<string, unknown> => readJsonFile(settingsPath(), {})

export function getLastSymbol(): string | null {
  const v = read().lastSymbol
  return typeof v === 'string' ? v : null
}

export function setLastSymbol(symbol: string): void {
  writeJsonFile(settingsPath(), { ...read(), lastSymbol: symbol })
}

// D-63: sidebar open/closed is UI chrome, persisted here (not in layouts.json/Workspace) so it
// never gets carried by a named layout's save/load.
export function getSidebarOpen(): boolean | null {
  const v = read().sidebarOpen
  return typeof v === 'boolean' ? v : null
}

export function setSidebarOpen(open: boolean): void {
  writeJsonFile(settingsPath(), { ...read(), sidebarOpen: open })
}

// D-63 と同じ扱い（UI chrome）。幅もここへ。clamp は呼び出し側(renderer)の責務。
export function getSidebarWidth(): number | null {
  const v = read().sidebarWidth
  return typeof v === 'number' ? v : null
}

export function setSidebarWidth(width: number): void {
  writeJsonFile(settingsPath(), { ...read(), sidebarWidth: width })
}
