// Watchlist symbol windows reuse the main renderer bundle; the target symbol rides in the URL hash
// (#symbolChart=SYMBOL). main.tsx branches on parseSymbolChartSymbol; main-process index.ts builds
// the URL with buildSymbolChartHash. Twin of chartWindow.ts — the key is deliberately distinct from
// 'chart' so the two parsers never read each other's hash.
export function buildSymbolChartHash(symbol: string): string {
  return `symbolChart=${encodeURIComponent(symbol)}`
}

export function parseSymbolChartSymbol(hash: string): string | null {
  const q = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(q).get('symbolChart')
}
