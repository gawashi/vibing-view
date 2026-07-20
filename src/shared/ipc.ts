import type { Bar, SymbolResult, Timeframe, DateRange, Workspace, WatchlistCollection } from './types'

export const CH = {
  symbolsSearch: 'symbols:search',
  ohlcvGet: 'ohlcv:get',
  apikeySet: 'apikey:set',
  apikeyStatus: 'apikey:status',
  apikeyClear: 'apikey:clear',
  settingsGetLastSymbol: 'settings:getLastSymbol',
  settingsSetLastSymbol: 'settings:setLastSymbol',
  settingsGetSidebarOpen: 'settings:getSidebarOpen',
  settingsSetSidebarOpen: 'settings:setSidebarOpen',
  settingsGetSidebarWidth: 'settings:getSidebarWidth',
  settingsSetSidebarWidth: 'settings:setSidebarWidth',
  capabilitiesGet: 'capabilities:get',
  layoutGetCurrent: 'layout:getCurrent',
  layoutSetCurrent: 'layout:setCurrent',
  layoutList: 'layout:list',
  layoutGet: 'layout:get',
  layoutSave: 'layout:save',
  layoutDelete: 'layout:delete',
  layoutRename: 'layout:rename',
  watchlistGet: 'watchlist:get',
  watchlistSet: 'watchlist:set'
} as const

export type KeyStatus = { hasKey: boolean; encryptionAvailable: boolean }
export type SetKeyResult = { ok: boolean; encryptionAvailable: boolean }
export type CapabilityStatus = 'available' | 'requires-plan' | 'rate-limited' | 'unknown'

export interface Api {
  symbols: { search(query: string): Promise<SymbolResult[]> }
  ohlcv: { get(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]> }
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
  }
  capabilities: { get(): Promise<Record<Timeframe, CapabilityStatus>> }
  layout: {
    getCurrent(): Promise<Workspace | null>
    setCurrent(ws: Workspace): Promise<void>
    list(): Promise<string[]>
    get(name: string): Promise<Workspace | null>
    save(name: string, ws: Workspace): Promise<void>
    delete(name: string): Promise<void>
    rename(from: string, to: string): Promise<void>
  }
  watchlist: {
    get(): Promise<WatchlistCollection>
    set(c: WatchlistCollection): Promise<void>
  }
}

declare global {
  interface Window {
    api: Api
  }
}
