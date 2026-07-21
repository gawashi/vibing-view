import type { Timeframe } from '@shared/types'

// timeframe ごとの初期表示本数。fitContent(全表示)の代わりに直近 N 本を出す。
export const INITIAL_BARS: Record<Timeframe, number> = {
  '1m': 120,
  '5m': 120,
  '15m': 120,
  '1h': 150,
  '1d': 120,
  '1w': 104,
  '1M': 60
}

// 直近 N 本のロジカル範囲を返す。本数不足(len<=N)なら null → 呼び出し側は fitContent。
export function initialLogicalRange(
  timeframe: Timeframe,
  len: number
): { from: number; to: number } | null {
  const n = INITIAL_BARS[timeframe]
  if (len <= n) return null
  return { from: len - n, to: len - 1 }
}
