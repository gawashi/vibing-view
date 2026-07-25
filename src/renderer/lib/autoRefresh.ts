export type ReloadSource = 'manual' | 'auto'

// reload が market-status 取得後に OHLCV/quote へ進むかの判定。
// 手動は常に進む（クローズ後の確定日足を取りに行く）。auto はクローズ中は進まない（API 節約）。
export function shouldRefreshData(source: ReloadSource, isOpen: boolean): boolean {
  return source === 'manual' || isOpen
}
