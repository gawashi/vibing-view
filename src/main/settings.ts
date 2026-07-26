import { app } from 'electron'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { readJsonFile, writeJsonFile } from './jsonStore'
import type { McpConfig, McpConfigView } from '@shared/ipc'

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
// localhost-only credential the user pastes into a client config, revocable from the Settings
// dialog — safeStorage would protect nothing extra here.
// It is minted only when the user asks (generateMcpToken). Reading the config never creates one,
// so a fresh profile has no token and the server refuses to start until the user generates it.
export function getMcpConfig(): McpConfig {
  const raw = read().mcp
  const cfg = typeof raw === 'object' && raw !== null ? (raw as Partial<McpConfig>) : {}
  return {
    enabled: cfg.enabled === true,
    port: typeof cfg.port === 'number' && Number.isInteger(cfg.port) ? cfg.port : MCP_DEFAULT_PORT,
    token: typeof cfg.token === 'string' ? cfg.token : ''
  }
}

export function setMcpConfig(patch: Partial<McpConfig>): McpConfig {
  const next = { ...getMcpConfig(), ...patch }
  writeJsonFile(settingsPath(), { ...read(), mcp: next })
  return next
}

export function generateMcpToken(): McpConfig {
  return setMcpConfig({ token: randomBytes(32).toString('base64url') })
}

// Keeps the token's exact length so the masked field lines up with the real value (length is not a
// secret — see mcp/auth.ts). Anything 4 chars or shorter is masked whole: a hand-edited
// settings.json could hold a 3-char token, and slicing the last 4 off that would show it in full.
export function maskMcpToken(token: string): string {
  return token.length <= 4 ? '*'.repeat(token.length) : '*'.repeat(token.length - 4) + token.slice(-4)
}

export function getMcpConfigView(): McpConfigView {
  const { enabled, port, token } = getMcpConfig()
  return { enabled, port, maskedToken: maskMcpToken(token) }
}
