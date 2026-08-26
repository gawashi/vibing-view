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
  companyInfo: (symbol: string) => ['company-info', symbol] as const,
  economicCalendar: (from: string, to: string) => ['economic-calendar', from, to] as const,
  // years は key に入れる。地平ごとにフェッチの深さが違うので（1Y = 約 5 窓、5Y = 約 22 窓）、
  // 同じ key を使い回すと 5Y に広げても再取得が走らない。狭める方向（5Y → 1Y）は key が変わっても
  // service 側が「カバー済み・TTL 内」と判定してネットワークに出ない。
  economicIndicator: (name: string, years: number) => ['economic-indicator', name, years] as const,
  // years は key に入れる。地平ごとに取得の深さが違うので（1Y = 5 窓、5Y = 22 窓）、同じ key を
  // 使い回すと 5Y に広げても再取得が走らない。狭める方向（5Y → 1Y）は key が変わっても service が
  // 「カバー済み・TTL 内」と判定してネットワークに出ない。
  treasuryCurves: (years: number) => ['treasury-curves', years] as const
}
