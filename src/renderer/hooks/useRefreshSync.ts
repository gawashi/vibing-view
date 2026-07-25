import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, qk } from '@/api'

// スケジューラ(メインウィンドウ)からの refresh:applied を、このウィンドウの query キャッシュへ適用。
// FMP は叩かない（データは配信済み）。ChartWindow(enlarge 窓)が唯一のスケジューラと同期するための薄い橋。
export function useRefreshSync(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    return api.refresh.onApplied((p) => {
      for (const { symbol, timeframe, bars } of p.ohlcv) {
        queryClient.setQueryData(qk.ohlcv(symbol, timeframe), bars)
      }
      for (const { symbol, quote } of p.quotes) {
        queryClient.setQueryData(qk.quote(symbol), quote)
      }
      if (p.marketStatus) queryClient.setQueryData(qk.marketStatus(), p.marketStatus)
    })
  }, [queryClient])
}
