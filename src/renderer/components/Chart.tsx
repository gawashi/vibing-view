import React, { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { api, qk } from '@/api'
import type { Bar } from '@shared/types'

export function Chart({ symbol }: { symbol: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  const q = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol),
    queryFn: () => api.ohlcv.get(symbol, '1d', undefined)
  })

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0B0E11' }, textColor: '#8B92A0' },
      grid: { vertLines: { color: '#151920' }, horzLines: { color: '#151920' } },
      autoSize: true,
      timeScale: { borderColor: '#151920' },
      rightPriceScale: { borderColor: '#151920' }
    })
    // ponytail: assign directly from addSeries's return value — avoids the fragile
    // panes()[0].getSeries()[0] lookup; typechecks cleanly against installed 5.2 typings.
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22C55E', wickUpColor: '#22C55E',
      downColor: '#EF4444', wickDownColor: '#EF4444',
      borderVisible: false
    })
    chartRef.current = chart
    seriesRef.current = series
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [])

  // Push data whenever it changes.
  useEffect(() => {
    if (!seriesRef.current || !q.data) return
    seriesRef.current.setData(
      q.data.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close }))
    )
    chartRef.current?.timeScale().fitContent()
  }, [q.data])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {q.isLoading && (
        <div className="absolute inset-0 p-6 text-muted-foreground">Loading chart…</div>
      )}
      {q.isError && (
        <div className="absolute inset-0 p-6 text-destructive">
          Couldn't load chart data. Check your connection or your FMP API key in Settings, then try again.
        </div>
      )}
    </div>
  )
}
