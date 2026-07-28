// Satellite windows (company info / enlarge-chart / watchlist symbol / economic calendar /
// economic indicator) all reuse the main renderer bundle; the target rides in the URL hash
// (#company=AAPL, #chart=CELLID, #symbolChart=AAPL, #economic=1, #economicIndicator=1).
// main-process index.ts builds it, main.tsx branches on it. Shared so both sides agree on the
// format, and one kind's hash never parses as another's.
// 'economic' and 'economicIndicator' are singleton windows, so their value is a fixed '1' —
// callers only check presence. 選択中の指標はハッシュに載せない: main が持ち renderer が
// マウント時に pull する（EI-06 — 窓のロード中に push が落ちる競合を避けるため）。
export type WindowKind = 'company' | 'chart' | 'symbolChart' | 'economic' | 'economicIndicator'

export function buildHash(kind: WindowKind, value: string): string {
  return `${kind}=${encodeURIComponent(value)}`
}

export function parseHash(kind: WindowKind, hash: string): string | null {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get(kind)
}
