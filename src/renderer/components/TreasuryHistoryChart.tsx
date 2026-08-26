// src/renderer/components/TreasuryHistoryChart.tsx
import React, { useEffect, useRef } from 'react'
import {
  createChart, CrosshairMode, LineSeries, LineStyle, type IChartApi, type ISeriesApi
} from 'lightweight-charts'
import { chartThemeOptions } from '@/lib/chartTheme'
import type { LinePoint } from '@/lib/treasuryCurve'

export type HistorySeries = {
  id: string
  color: string
  points: LinePoint[]
  dashed?: boolean
  width?: 1 | 2
}

// 満期とスプレッドを 1 枚に重ねる（単位が全部 % なので同一の価格軸で成立し、縦を 2 分割しなくて
// 済む、YC-07）。time は 'YYYY-MM-DD' をそのまま渡せる（business-day 形式）。
// 系列の集合はトグルで変わるので、id → series の Map を持って差分だけ足し引きする。チャートを
// 作り直すとトグルのたびに表示範囲がリセットされる。
export function TreasuryHistoryChart({ series }: { series: HistorySeries[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  // 表示期間が変わったときだけ fitContent する（トグルでは range を触らない）。
  const spanRef = useRef('')

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      ...chartThemeOptions(),
      // Normal: 値のある点に吸着させず任意の位置で読める（EconomicIndicatorChart と同じ）
      crosshair: { mode: CrosshairMode.Normal }
    })
    chartRef.current = chart
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current.clear()
      spanRef.current = ''
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const map = seriesRef.current

    const wanted = new Set(series.map((s) => s.id))
    for (const [id, api] of map) {
      if (!wanted.has(id)) {
        chart.removeSeries(api)
        map.delete(id)
      }
    }

    for (const s of series) {
      let api = map.get(s.id)
      if (!api) {
        api = chart.addSeries(LineSeries, {})
        map.set(s.id, api)
      }
      api.applyOptions({
        color: s.color,
        lineWidth: s.width ?? 2,
        lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
        // 右端のラベルと価格線は 3〜4 本重なると読めなくなる。値は下の表で読む。
        priceLineVisible: false,
        lastValueVisible: false
      })
      api.setData(s.points)
    }

    const first = series[0]?.points
    const span = first ? `${first[0]?.time ?? ''}|${first[first.length - 1]?.time ?? ''}` : ''
    if (span !== spanRef.current) {
      spanRef.current = span
      chart.timeScale().fitContent()
    }
  }, [series])

  return <div ref={containerRef} className="h-full w-full" />
}
