import type { Bar, SymbolResult, Timeframe, DateRange } from './types'

export const CH = {
  symbolsSearch: 'symbols:search',
  ohlcvGet: 'ohlcv:get',
  apikeySet: 'apikey:set',
  apikeyStatus: 'apikey:status',
  apikeyClear: 'apikey:clear',
  settingsGetLastSymbol: 'settings:getLastSymbol',
  settingsSetLastSymbol: 'settings:setLastSymbol',
  capabilitiesGet: 'capabilities:get'
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
  }
  capabilities: { get(): Promise<Record<Timeframe, CapabilityStatus>> }
}

declare global {
  interface Window {
    api: Api
  }
}
