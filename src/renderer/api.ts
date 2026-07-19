// Single renderer entry point to the preload bridge. Never touch window.api elsewhere.
export const api = window.api

export const qk = {
  ohlcv: (symbol: string) => ['ohlcv', symbol, '1d'] as const,
  search: (query: string) => ['search', query] as const
}
