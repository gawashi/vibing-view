import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type LogicalRange
} from 'lightweight-charts'
import { api, qk } from '@/api'
import { registry } from '@/indicators/registry'
import { BandPrimitive, hexToRgba } from '@/indicators/bandPrimitive'
import { IndicatorLegend } from './IndicatorLegend'
import { useAppStore } from '@/store'
import type { Bar, Timeframe } from '@shared/types'

export function Chart({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>[]>>(new Map())
  // One BandPrimitive per instance that has a `kind:'band'` output (Plan 03 Task 2, D-29) —
  // generic, keyed on OutputMeta.kind, reusable by any future band indicator.
  const bandPrimitiveRef = useRef<Map<string, BandPrimitive>>(new Map())
  const queryClient = useQueryClient()
  const indicators = useAppStore((s) => s.indicators)

  // Handler closures below live inside the create-once effect (deps `[]`), so they read the
  // *current* symbol/timeframe/bars via refs rather than capturing stale values from mount.
  const symbolRef = useRef(symbol)
  const timeframeRef = useRef(timeframe)
  const barsRef = useRef<Bar[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Set<string>>(new Set())
  const lastKeyRef = useRef<string | null>(null)
  const [gapLoading, setGapLoading] = useState(false)

  useEffect(() => {
    symbolRef.current = symbol
    timeframeRef.current = timeframe
  }, [symbol, timeframe])

  const q = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol, timeframe),
    queryFn: () => api.ohlcv.get(symbol, timeframe, undefined)
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

    // Pan-left gap-fetch (D-16 / DESIGN-ADDENDUM §5): fetch only the missing older sub-range,
    // never a full re-fetch. Cached bars stay rendered throughout (UI-SPEC E3).
    const runGapFetch = async (range: LogicalRange): Promise<void> => {
      const bars = barsRef.current
      if (bars.length < 2) return

      const sym = symbolRef.current
      const tf = timeframeRef.current
      // '1w'/'1M' are derived from the full cached daily history — the whole series is already
      // aggregated, there is no older sub-range to backfill. Fetching here returns the FULL derived
      // series again, which the merge below would duplicate → setData asc-order assertion crash.
      if (tf === '1w' || tf === '1M') return
      const key = `${sym}:${tf}`
      if (inFlightRef.current.has(key)) return // single-flight per (symbol, tf)

      const oldestLoadedTime = bars[0].time
      const visibleWidth = range.to - range.from
      // seconds-per-bar estimated from currently loaded data, used to convert the "one
      // visible-range width" prefetch pad (§5, expressed in bar units) into a time span.
      const secondsPerBar = (bars[bars.length - 1].time - oldestLoadedTime) / (bars.length - 1)
      const padSeconds = Math.round(visibleWidth * secondsPerBar)
      const targetFrom = oldestLoadedTime - padSeconds - 1
      if (targetFrom >= oldestLoadedTime) return // nothing older to fetch

      inFlightRef.current.add(key)
      setGapLoading(true)
      try {
        const older = await queryClient.fetchQuery({
          queryKey: ['ohlcv-gap', sym, tf, targetFrom, oldestLoadedTime - 1],
          queryFn: () => api.ohlcv.get(sym, tf, { from: targetFrom, to: oldestLoadedTime - 1 })
        })
        // Only merge if the user hasn't switched symbol/timeframe while the fetch was in flight.
        if (older.length > 0 && symbolRef.current === sym && timeframeRef.current === tf) {
          // Dedupe by time — lightweight-charts requires strictly-ascending unique times, and a
          // sub-range fetch can return a bar at an already-loaded boundary. Last write wins.
          const byTime = new Map<number, Bar>()
          for (const b of [...barsRef.current, ...older]) byTime.set(b.time, b)
          const merged = [...byTime.values()].sort((a, b) => a.time - b.time)
          queryClient.setQueryData<Bar[]>(qk.ohlcv(sym, tf), merged)
        }
      } catch (err) {
        // Background prefetch — never surface a user-facing error for a failed backfill
        // (rate limit / network blip mid-pan); single-flight clears below so the next pan retries.
        console.debug('gap-fetch failed', err)
        // Main already recorded a fresh capability verdict (e.g. 'rate-limited') for this tf when
        // the gap-fetch's underlying ohlcv:get failed — refresh the renderer's map so TimeframeRow
        // re-gates and App's rate-limit toast can fire, without touching the chart's cached data.
        void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
      } finally {
        inFlightRef.current.delete(key)
        setGapLoading(false)
      }
    }

    const onVisibleLogicalRangeChange = (range: LogicalRange | null): void => {
      if (!range) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      // ponytail: 300ms debounce (§5) — tune if pan feels laggy (raise) or jumpy/over-fetchy (lower).
      debounceRef.current = setTimeout(() => {
        // ponytail: "left edge within ~1 bar of index 0" threshold — tune if the fetch fires
        // too early/late relative to when the user actually reaches uncached history.
        if (range.from <= 1) void runGapFetch(range)
      }, 300)
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange)

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Push data whenever it changes.
  useEffect(() => {
    if (!seriesRef.current) return
    // On a symbol/timeframe switch the new key's data is undefined until it resolves (and stays
    // undefined if it errors — e.g. an out-of-plan symbol's 402). Clear to [] rather than bailing,
    // so the previous symbol's candles don't linger under the new header while loading/errored.
    const bars = q.data ?? []
    seriesRef.current.setData(
      bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close }))
    )
    barsRef.current = bars
    // Only reset the view (D-11) on a genuine symbol/timeframe switch — a gap-fetch merge updates
    // q.data for the *same* key and must NOT jump the user's pan position (§5).
    const key = `${symbol}:${timeframe}`
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key
      chartRef.current?.timeScale().fitContent()
    }
  }, [q.data, symbol, timeframe])

  // Reconcile indicator overlay series against `indicators` state. A NEW effect alongside the
  // create-once and data-push effects above (both left untouched) — reads the same barsRef so a
  // symbol/timeframe switch or a gap-fetch merge (both update q.data) recomputes with no refetch.
  useEffect(() => {
    if (!chartRef.current) return
    const map = indicatorSeriesRef.current
    const liveIds = new Set(indicators.map((inst) => inst.id))

    // Remove series for instances no longer present. Detach the band primitive BEFORE
    // removeSeries disposes its anchor series — detaching from an already-removed series is
    // undefined behavior in lightweight-charts (may throw mid-loop or silently no-op).
    for (const [id, series] of map) {
      if (!liveIds.has(id)) {
        const primitive = bandPrimitiveRef.current.get(id)
        if (primitive?.series) {
          primitive.series.detachPrimitive(primitive)
          bandPrimitiveRef.current.delete(id)
        }
        for (const s of series) chartRef.current.removeSeries(s)
        map.delete(id)
      }
    }

    for (const inst of indicators) {
      const module = registry[inst.type]
      if (!module) continue

      const lineOutputs = module.outputs.filter((o) => o.kind === 'line')

      // Create series for newly-added instances, one per 'line' output, plus one BandPrimitive
      // per 'band' output (Plan 03 Task 2, D-29) — dispatched generically on OutputMeta.kind,
      // never on indicator type, so any future band indicator reuses this unchanged.
      if (!map.has(inst.id)) {
        const series: ISeriesApi<'Line'>[] = []
        for (const output of module.outputs) {
          if (output.kind === 'line') {
            series.push(
              chartRef.current.addSeries(LineSeries, { color: inst.colors[output.key], lineWidth: 2 })
            )
          }
        }
        map.set(inst.id, series)

        for (const output of module.outputs) {
          if (output.kind !== 'band') continue
          const lineKeys = lineOutputs.map((o) => o.key)
          const anchorSeries = series[lineKeys.indexOf(output.between[0])]
          if (!anchorSeries) continue
          const primitive = new BandPrimitive()
          anchorSeries.attachPrimitive(primitive)
          bandPrimitiveRef.current.set(inst.id, primitive)
        }
      }

      // Recompute every live instance from barsRef.current — cheap client compute (D-26), no
      // network read. Unconditional recompute is fine per DESIGN §4.
      const outputs = module.compute(barsRef.current, inst.params)
      const series = map.get(inst.id) ?? []
      lineOutputs.forEach((output, idx) => {
        const lineSeries = series[idx]
        if (!lineSeries) return
        const data = (outputs[output.key] ?? []).map((d) => ({ time: d.time as UTCTimestamp, value: d.value }))
        lineSeries.setData(data)
        lineSeries.applyOptions({ color: inst.colors[output.key], visible: inst.visible })
      })

      const bandOutput = module.outputs.find((o) => o.kind === 'band')
      if (bandOutput && bandOutput.kind === 'band') {
        const primitive = bandPrimitiveRef.current.get(inst.id)
        if (primitive) {
          const toBandData = (key: string): { time: UTCTimestamp; value: number }[] =>
            (outputs[key] ?? []).map((d) => ({ time: d.time as UTCTimestamp, value: d.value }))
          const color = hexToRgba(inst.colors[bandOutput.key] ?? '#000000', 0.15)
          primitive.update(toBandData(bandOutput.between[0]), toBandData(bandOutput.between[1]), color, inst.visible)
        }
      }
    }
  }, [indicators, q.data, timeframe])

  // A symbol outside the current FMP plan's coverage manifests two ways on this key: a 402/403
  // ("FMP HTTP 40x" survives IPC serialization in the rejected error's message) OR a plain empty
  // 200 array. Treat both as "not covered" so D-graying's replacement message always shows.
  const isCoverageError = q.isError && /FMP HTTP 40[23]/.test(String((q.error as Error)?.message))
  const isEmpty = !q.isLoading && !q.isError && Array.isArray(q.data) && q.data.length === 0
  const notCovered = isCoverageError || isEmpty

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <IndicatorLegend />
      {q.isLoading && (
        <div className="absolute inset-0 z-10 p-6 text-muted-foreground">Loading chart…</div>
      )}
      {notCovered && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6 text-center text-muted-foreground">
          This symbol isn’t available on your current FMP plan.
        </div>
      )}
      {q.isError && !isCoverageError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6 text-center text-destructive">
          Couldn’t load chart data. Check your connection or your FMP API key in Settings, then try again.
        </div>
      )}
      {gapLoading && (
        <div className="absolute bottom-2 left-2 rounded bg-card/80 px-2 py-1 text-xs text-muted-foreground">
          Loading history…
        </div>
      )}
    </div>
  )
}
