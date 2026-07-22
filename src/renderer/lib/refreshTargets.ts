import type { Cell, Timeframe, GridShape } from '@shared/types'
import type { CapabilityStatus } from '@shared/ipc'
import { cellCount } from '@shared/workspace'

export type RefreshTarget = { symbol: string; timeframe: Timeframe }

const INTRADAY: Timeframe[] = ['1m', '5m', '15m', '1h']

// Visible cells only, de-duped by symbol|tf. Gated tfs (requires-plan/rate-limited) are skipped so
// reload never burns an API request that will just 402/429. Intraday cells also refresh their '1d'
// so the prev-close-based change label stays correct across a trading-day boundary.
//
// `watchlistSymbols` are the active watchlist's currently-displayed symbols (empty when the sidebar
// is closed). Each gets a '1d' refresh so the sidebar's price/change stays current — de-duped
// against the grid's own '1d' targets so a symbol shown in both costs only one request.
export function refreshTargets(
  cells: Cell[],
  shape: GridShape,
  caps: Partial<Record<Timeframe, CapabilityStatus>> | undefined,
  watchlistSymbols: string[] = []
): RefreshTarget[] {
  const gated = (tf: Timeframe): boolean =>
    caps?.[tf] === 'requires-plan' || caps?.[tf] === 'rate-limited'
  const seen = new Set<string>()
  const out: RefreshTarget[] = []
  const push = (symbol: string, tf: Timeframe): void => {
    if (gated(tf)) return
    const key = `${symbol}|${tf}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ symbol, timeframe: tf })
  }
  for (const cell of cells.slice(0, cellCount(shape))) {
    if (!cell.symbol) continue
    push(cell.symbol, cell.timeframe)
    if (INTRADAY.includes(cell.timeframe)) push(cell.symbol, '1d')
  }
  for (const symbol of watchlistSymbols) push(symbol, '1d')
  return out
}
