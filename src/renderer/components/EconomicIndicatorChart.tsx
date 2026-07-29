// src/renderer/components/EconomicIndicatorChart.tsx
import React, { useEffect, useRef } from 'react'
import { createChart, CrosshairMode, LineSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts'
import { chartThemeOptions, cssHsl } from '@/lib/chartTheme'
import { formatValue } from '@/lib/economicIndicatorSeries'
import type { EconomicIndicatorPoint } from '@shared/types'

// 統計指標の折れ線 1 本。Chart.tsx は Bar[] と指標インスタンス群に結びついた大きなコンポーネントで、
// 単純な折れ線を通すには改造が要るので分けた。
// time は 'YYYY-MM-DD' をそのまま渡せる（lightweight-charts の business-day 形式）。epoch への
// 変換が不要なので、API の date をそのまま流せる。
export function EconomicIndicatorChart({ points }: { points: EconomicIndicatorPoint[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const readoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      ...chartThemeOptions(),
      // Normal: 値のある点に吸着させず、任意の位置で読める（月次系列は点が疎なので Magnet だと飛ぶ）
      crosshair: { mode: CrosshairMode.Normal }
    })
    chartRef.current = chart
    seriesRef.current = chart.addSeries(LineSeries, { color: cssHsl('--primary'), lineWidth: 2 })

    // クロスヘアの読み取り。React state にすると 1 ピクセル動くたび再レンダーするので DOM を直接書く。
    chart.subscribeCrosshairMove((param) => {
      const el = readoutRef.current
      if (!el) return
      const series = seriesRef.current
      const d = series && param.time ? param.seriesData.get(series) : undefined
      el.textContent = d && 'value' in d ? `${String(param.time)}  ${formatValue(d.value as number)}` : ''
    })

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current) return
    seriesRef.current.setData(points.map((p) => ({ time: p.date, value: p.value })))
    chartRef.current?.timeScale().fitContent()
  }, [points])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div
        ref={readoutRef}
        className="pointer-events-none absolute left-2 top-2 text-xs tabular-nums text-muted-foreground"
      />
    </div>
  )
}
