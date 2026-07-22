import type { Bar, SymbolResult, Timeframe, DateRange, WorkspaceCollection, Quote, MarketStatus, CompanyInfo } from './types'

export const CH = {
  symbolsSearch: 'symbols:search',
  symbolsProfile: 'symbols:profile',
  ohlcvGet: 'ohlcv:get',
  ohlcvRefresh: 'ohlcv:refresh',
  quoteGet: 'quote:get',
  marketStatus: 'market:status',
  apikeySet: 'apikey:set',
  apikeyStatus: 'apikey:status',
  apikeyClear: 'apikey:clear',
  settingsGetLastSymbol: 'settings:getLastSymbol',
  settingsSetLastSymbol: 'settings:setLastSymbol',
  settingsGetSidebarOpen: 'settings:getSidebarOpen',
  settingsSetSidebarOpen: 'settings:setSidebarOpen',
  settingsGetSidebarWidth: 'settings:getSidebarWidth',
  settingsSetSidebarWidth: 'settings:setSidebarWidth',
  settingsGetTheme: 'settings:getTheme',
  settingsSetTheme: 'settings:setTheme',
  capabilitiesGet: 'capabilities:get',
  workspacesGet: 'workspaces:get',
  workspacesSet: 'workspaces:set',
  companyInfo: 'company:info',
  companyOpenWindow: 'company:openWindow'
} as const

export type KeyStatus = { hasKey: boolean; encryptionAvailable: boolean; maskedKey?: string }
export type SetKeyResult = { ok: boolean; encryptionAvailable: boolean }
export type CapabilityStatus = 'available' | 'requires-plan' | 'rate-limited' | 'unknown'
export type Theme = 'light' | 'dark' | 'system'

export interface Api {
  symbols: {
    search(query: string): Promise<SymbolResult[]>
    profile(symbol: string): Promise<SymbolResult>
  }
  ohlcv: {
    get(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]>
    // Reload: fetch only the new bars (cached newest → now) and return the merged series.
    refresh(symbol: string, timeframe: Timeframe): Promise<Bar[]>
  }
  quote: { get(symbol: string): Promise<Quote> }
  market: { status(): Promise<MarketStatus> }
  apikey: {
    set(key: string): Promise<SetKeyResult>
    status(): Promise<KeyStatus>
    clear(): Promise<void>
  }
  settings: {
    getLastSymbol(): Promise<string | null>
    setLastSymbol(symbol: string): Promise<void>
    // Sidebar open/closed flag (D-63) — persisted separately from Workspace/named layouts, since
    // it's UI chrome, not workspace config. Same small-JSON pattern as lastSymbol, same file.
    getSidebarOpen(): Promise<boolean | null>
    setSidebarOpen(open: boolean): Promise<void>
    getSidebarWidth(): Promise<number | null>
    setSidebarWidth(width: number): Promise<void>
    getTheme(): Promise<Theme>
    setTheme(theme: Theme): Promise<void>
  }
  capabilities: { get(): Promise<Record<Timeframe, CapabilityStatus>> }
  workspaces: {
    get(): Promise<WorkspaceCollection>
    set(c: WorkspaceCollection): Promise<void>
  }
  company: {
    info(symbol: string): Promise<CompanyInfo>
    openWindow(symbol: string): Promise<void>
  }
}

declare global {
  interface Window {
    api: Api
  }
}
