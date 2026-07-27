// Satellite windows (company info / enlarge-chart / watchlist symbol) all reuse the main renderer
// bundle; the target rides in the URL hash (#company=AAPL, #chart=CELLID, #symbolChart=AAPL).
// main-process index.ts builds it, main.tsx branches on it. Shared so both sides agree on the format,
// and one kind's hash never parses as another's.
export type WindowKind = 'company' | 'chart' | 'symbolChart'

export function buildHash(kind: WindowKind, value: string): string {
  return `${kind}=${encodeURIComponent(value)}`
}

export function parseHash(kind: WindowKind, hash: string): string | null {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get(kind)
}
