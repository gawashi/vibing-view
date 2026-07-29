// Satellite windows (company info / enlarge-chart / watchlist symbol / economic calendar /
// economic indicator) all reuse the main renderer bundle; the target rides in the URL hash
// (#company=AAPL, #chart=CELLID, #symbolChart=AAPL, #economic=1, #economicIndicator=CPI).
// main-process index.ts builds it, main.tsx branches on it. Shared so both sides agree on the
// format, and one kind's hash never parses as another's.
// 'economic' is a singleton window, so its value is a fixed '1' — callers only check presence.
// 'economicIndicator' is also a single window (main pins its key), but its hash carries the
// selected series so the renderer has it on the first render instead of pulling for it.
export type WindowKind = 'company' | 'chart' | 'symbolChart' | 'economic' | 'economicIndicator'

export function buildHash(kind: WindowKind, value: string): string {
  return `${kind}=${encodeURIComponent(value)}`
}

export function parseHash(kind: WindowKind, hash: string): string | null {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get(kind)
}
