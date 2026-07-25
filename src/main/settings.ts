import { app } from 'electron'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { readJsonFile, writeJsonFile } from './jsonStore'
import type { McpConfig } from '@shared/ipc'

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

// Theme is a user preference (JSON, not SQLite). 'system' follows OS at startup (resolved in renderer).
export type Theme = 'light' | 'dark' | 'system'

export function getTheme(): Theme {
  const v = read().theme
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function setTheme(theme: Theme): void {
  writeJsonFile(settingsPath(), { ...read(), theme })
}

// 自動更新トグル (UI chrome, JSON)。既定は false（明示的にONにするまで回さない）。
export function getAutoRefresh(): boolean {
  return read().autoRefresh === true
}

export function setAutoRefresh(on: boolean): void {
  writeJsonFile(settingsPath(), { ...read(), autoRefresh: on })
}

const MCP_DEFAULT_PORT = 39100

// M-11: the MCP token is stored in plain text, unlike the FMP API key (D-05). It is a
// localhost-only credential, revocable from the Settings dialog, and has to be displayed verbatim
// so the user can paste it into a client config — safeStorage would protect nothing extra here.
export function getMcpConfig(): McpConfig {
  const raw = read().mcp
  const cfg = typeof raw === 'object' && raw !== null ? (raw as Partial<McpConfig>) : {}
  const config: McpConfig = {
    enabled: cfg.enabled === true,
    port: typeof cfg.port === 'number' && Number.isInteger(cfg.port) ? cfg.port : MCP_DEFAULT_PORT,
    token: typeof cfg.token === 'string' && cfg.token.length > 0 ? cfg.token : randomBytes(32).toString('base64url')
  }
  // Persist a freshly minted token so the value shown in Settings is the one the server accepts.
  if (config.token !== cfg.token) writeJsonFile(settingsPath(), { ...read(), mcp: config })
  return config
}

export function setMcpConfig(patch: Partial<McpConfig>): McpConfig {
  const next = { ...getMcpConfig(), ...patch }
  writeJsonFile(settingsPath(), { ...read(), mcp: next })
  return next
}

export function regenerateMcpToken(): McpConfig {
  return setMcpConfig({ token: randomBytes(32).toString('base64url') })
}
