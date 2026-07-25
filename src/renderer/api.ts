import type { Timeframe } from '@shared/types'

// Single renderer entry point to the preload bridge. Never touch window.api elsewhere.
export const api = window.api

export const qk = {
  ohlcv: (symbol: string, tf: Timeframe) => ['ohlcv', symbol, tf] as const,
  search: (query: string) => ['search', query] as const,
  profile: (symbol: string) => ['profile', symbol] as const,
  capabilities: () => ['capabilities'] as const,
  quote: (symbol: string) => ['quote', symbol] as const,
  marketStatus: () => ['market-status'] as const,
  companyInfo: (symbol: string) => ['company-info', symbol] as const
}
