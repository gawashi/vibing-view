import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type LineSeriesPartialOptions,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
  type LogicalRange
} from 'lightweight-charts'
import { api, qk } from '@/api'
import { registry } from '@/indicators/registry'
import { BandPrimitive, hexToRgba } from '@/indicators/bandPrimitive'
import { IndicatorLegend } from './IndicatorLegend'
import { useAppStore } from '@/store'
import type { CrosshairValues } from '@/store'
import type { HistPoint, LineData } from '@/indicators/types'
import type { Bar, Timeframe } from '@shared/types'
import { initialLogicalRange } from '@/lib/initialRange'

type PaneLegend = { paneIndex: number; top: number; left: number; instanceIds: string[] }

export function Chart({ cellId, symbol, timeframe }: { cellId: string; symbol: string; timeframe: Timeframe }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  // Widened to include Histogram so separate-pane histogram outputs (Volume/MACD) reuse the same
  // create/remove/crosshair bookkeeping as line outputs — RSI itself is line-only.
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line' | 'Histogram'>[]>>(new Map())
  // One BandPrimitive per instance that has a `kind:'band'` output (BB) or a `module.band` zone
  // (RSI) — generic, keyed on instance id, reusable by any future band/zone indicator.
  const bandPrimitiveRef = useRef<Map<string, BandPrimitive>>(new Map())
  // Guide-line handles per instance — created once (Landmine #4), price updated live on param edit
  // (Landmine #1) without re-calling the non-idempotent createPriceLine.
  const guideLineRef = useRef<Map<string, IPriceLine[]>>(new Map())
  const queryClient = useQueryClient()
  const indicators = useAppStore((s) => s.cells.find((c) => c.id === cellId)?.indicators ?? [])

  // Per-pane legend geometry (recomputed on pane composition/resize) — one legend per pane.
  const [paneLegends, setPaneLegends] = useState<PaneLegend[]>([])
  // rAF throttle + D-40 non-hover fallback values for the crosshair readout.
  const rafRef = useRef<number | null>(null)
  const latestValuesRef = useRef<CrosshairValues>({})

  // Handler closures below live inside the create-once effect (deps `[]`), so they read the
  // *current* symbol/timeframe/bars via refs rather than capturing stale values from mount.
  const symbolRef = useRef(symbol)
  const timeframeRef = useRef(timeframe)
  const cellIdRef = useRef(cellId)
  const barsRef = useRef<Bar[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Set<string>>(new Set())
  const lastKeyRef = useRef<string | null>(null)
  const [gapLoading, setGapLoading] = useState(false)

  useEffect(() => {
    symbolRef.current = symbol
    timeframeRef.current = timeframe
    cellIdRef.current = cellId
  }, [symbol, timeframe, cellId])

  const q = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol, timeframe),
    queryFn: () => api.ohlcv.get(symbol, timeframe, undefined)
  })

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0B0E11' },
        textColor: '#8B92A0',
        // Hide the on-canvas TradingView logo — it would repeat in every grid cell (up to 4 in 2x2).
        // Optional mark; Apache-2.0 attribution is satisfied by the repo NOTICE, not this overlay.
        attributionLogo: false,
        // D-32/RESEARCH Q6: pane separator — グリッド色(#151920)だと境目が見えないため、
        // グリッドとテキスト色の中間(#2A2F3A)にしてペイン境界をはっきり見せる。
        panes: { separatorColor: '#2A2F3A', separatorHoverColor: 'rgba(139, 146, 160, 0.2)' }
      },
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

    // Crosshair sync (CHART-04, D-38/39/40): one handler reads every hovered series' value at the
    // same timestamp via param.seriesData, so all panes' legends update from one event. rAF-throttled.
    const onCrosshairMove = (param: MouseEventParams<Time>): void => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        // Cursor off-chart → fall back to the latest (rightmost) bar values (D-40).
        if (param.time === undefined) {
          useAppStore.getState().setCrosshair(cellIdRef.current, latestValuesRef.current)
          return
        }
        const values: CrosshairValues = {}
        const priceSeries = seriesRef.current
        if (priceSeries) {
          const d = param.seriesData.get(priceSeries)
          if (d && 'close' in d) values.price = { open: d.open, high: d.high, low: d.low, close: d.close }
        }
        // Surface EVERY draw output per instance (generic, no inst.type branch). The series list
        // was built in reconcile by zipping drawOutputs in order, so index i ↔ drawOutputs[i].
        const insts = useAppStore.getState().cells.find((c) => c.id === cellIdRef.current)?.indicators ?? []
        for (const [id, list] of indicatorSeriesRef.current) {
          const inst = insts.find((i) => i.id === id)
          const module = inst && registry[inst.type]
          if (!module) continue
          const drawOutputs = module.outputs.filter((o) => o.kind === 'line' || o.kind === 'histogram')
          const perInstance: Record<string, number> = {}
          drawOutputs.forEach((output, idx) => {
            const s = list[idx]
            if (!s) return
            const d = param.seriesData.get(s)
            if (d && 'value' in d) perInstance[output.key] = d.value // guards WhitespaceData (no 'value')
          })
          values[id] = perInstance
        }
        useAppStore.getState().setCrosshair(cellIdRef.current, values)
      })
    }
    chart.subscribeCrosshairMove(onCrosshairMove)

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      // chart.remove() destroys every series it owns; drop the now-dangling handles so a remount
      // (React StrictMode dev double-invoke) re-reconciles series against the fresh chart instead of
      // reusing detached ones — a stale handle's getPane() throws "Value is null" and blanks the app.
      indicatorSeriesRef.current.clear()
      bandPrimitiveRef.current.clear()
      guideLineRef.current.clear()
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
      const range = initialLogicalRange(timeframe, bars.length)
      if (range) chartRef.current?.timeScale().setVisibleLogicalRange(range)
      else chartRef.current?.timeScale().fitContent() // 本数不足時は全表示
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
        // Price lines are disposed with their series above (D-36 auto-collapses the pane too) —
        // just drop the stale handle map entry.
        guideLineRef.current.delete(id)
      }
    }

    // D-40 non-hover fallback: the latest (rightmost) bar's values for every pane's legend.
    const latest: CrosshairValues = {}

    for (const inst of indicators) {
      const module = registry[inst.type]
      if (!module) continue

      // Line + histogram outputs both get a real series (in output order); band is a primitive.
      const drawOutputs = module.outputs.filter((o) => o.kind === 'line' || o.kind === 'histogram')

      // Create series/primitives/guides for newly-added instances only. Separate-pane instances
      // get a fresh pane at the bottom via paneIndex = panes().length (Landmine #7 — never a
      // hand-rolled counter; already reflects any prior D-36 auto-collapse).
      if (!map.has(inst.id)) {
        const paneIndex = module.pane === 'separate' ? chartRef.current.panes().length : undefined
        const series: ISeriesApi<'Line' | 'Histogram'>[] = []
        for (const output of drawOutputs) {
          if (output.kind === 'line') {
            const opts: LineSeriesPartialOptions = { color: inst.colors[output.key], lineWidth: 2 }
            // Fixed scale (RSI 0-100) — autoscaleInfoProvider alone locks it (RESEARCH Q5).
            if (module.scale) {
              const { min, max } = module.scale
              opts.autoscaleInfoProvider = () => ({ priceRange: { minValue: min, maxValue: max } })
            }
            const ls = chartRef.current.addSeries(LineSeries, opts, paneIndex)
            // The default price-scale margins (top 0.2 / bottom 0.1) balloon a fixed 0-100 range out
            // to ~-10..120 on the axis. Pin tight margins so a fixed-scale pane reads 0-100, not 0-120.
            if (module.scale) ls.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } })
            series.push(ls)
          } else {
            // Custom axis formatter (e.g. Volume K/M/B) when the output declares one; minMove:1
            // keeps the crosshair price label integer-precise. MACD omits priceFormat → default.
            const histOpts = output.priceFormat
              ? { base: 0, priceFormat: { type: 'custom' as const, minMove: 1, formatter: output.priceFormat } }
              : { base: 0 }
            series.push(chartRef.current.addSeries(HistogramSeries, histOpts, paneIndex))
          }
        }
        map.set(inst.id, series)

        // Band: BB anchors a kind:'band' output between two of its lines; RSI declares module.band
        // (a fixed zone). Both reuse BandPrimitive attached to the anchor line series.
        const bandOutput = module.outputs.find((o) => o.kind === 'band')
        if (bandOutput && bandOutput.kind === 'band') {
          const lineKeys = drawOutputs.filter((o) => o.kind === 'line').map((o) => o.key)
          const anchorSeries = series[lineKeys.indexOf(bandOutput.between[0])]
          if (anchorSeries) {
            const primitive = new BandPrimitive()
            anchorSeries.attachPrimitive(primitive)
            bandPrimitiveRef.current.set(inst.id, primitive)
          }
        } else if (module.band && series[0]) {
          const primitive = new BandPrimitive()
          series[0].attachPrimitive(primitive)
          bandPrimitiveRef.current.set(inst.id, primitive)
        }

        // Guides: createPriceLine is NOT idempotent — call it exactly once here (Landmine #4),
        // keep the handles to move them live on param edit (Landmine #1).
        const anchor = series[0]
        if (module.guides && anchor) {
          const lines = module.guides(inst.params).map((g) =>
            anchor.createPriceLine({ price: g.value, color: g.color ?? '#8B92A0', lineWidth: 1 })
          )
          guideLineRef.current.set(inst.id, lines)
        }
      }

      // Recompute every live instance from barsRef.current — cheap client compute (D-26), no
      // network read. Unconditional recompute is fine per DESIGN §4 (all ops here idempotent).
      const outputs = module.compute(barsRef.current, inst.params)
      const series = map.get(inst.id) ?? []
      drawOutputs.forEach((output, idx) => {
        const s = series[idx]
        if (!s) return
        if (output.kind === 'histogram') {
          const hs = s as ISeriesApi<'Histogram'>
          const data = ((outputs[output.key] ?? []) as HistPoint[]).map((d) => ({
            time: d.time as UTCTimestamp, value: d.value, color: d.color
          }))
          hs.setData(data)
          hs.applyOptions({ visible: inst.visible })
        } else {
          const ls = s as ISeriesApi<'Line'>
          const data = ((outputs[output.key] ?? []) as LineData[]).map((d) => ({
            time: d.time as UTCTimestamp, value: d.value
          }))
          ls.setData(data)
          ls.applyOptions({ color: inst.colors[output.key], visible: inst.visible })
        }
      })

      // Move param-driven guide lines to their current threshold values (Landmine #1) — applyOptions,
      // not createPriceLine, so no duplicates stack.
      if (module.guides) {
        const lines = guideLineRef.current.get(inst.id)
        if (lines) {
          const guides = module.guides(inst.params)
          lines.forEach((pl, i) => { const g = guides[i]; if (g) pl.applyOptions({ price: g.value }) })
        }
      }

      const bandOutput = module.outputs.find((o) => o.kind === 'band')
      if (bandOutput && bandOutput.kind === 'band') {
        const primitive = bandPrimitiveRef.current.get(inst.id)
        if (primitive) {
          const toBandData = (key: string): { time: UTCTimestamp; value: number }[] =>
            ((outputs[key] ?? []) as LineData[]).map((d) => ({ time: d.time as UTCTimestamp, value: d.value }))
          const color = hexToRgba(inst.colors[bandOutput.key] ?? '#000000', 0.15)
          primitive.update(toBandData(bandOutput.between[0]), toBandData(bandOutput.between[1]), color, inst.visible)
        }
      } else if (module.band) {
        // RSI zone: two constant-value series spanning every bar, translucent fill (RESEARCH Q5).
        const primitive = bandPrimitiveRef.current.get(inst.id)
        if (primitive) {
          const zone = module.band(inst.params)
          const upper = barsRef.current.map((b) => ({ time: b.time as UTCTimestamp, value: zone.to }))
          const lower = barsRef.current.map((b) => ({ time: b.time as UTCTimestamp, value: zone.from }))
          primitive.update(upper, lower, hexToRgba(zone.color, 0.12), inst.visible)
        }
      }

      // D-40 non-hover fallback: last defined value of EACH draw output (same multi-value shape as
      // the onCrosshairMove producer, so hover and non-hover legends agree). Generic, no inst.type.
      const readout: Record<string, number> = {}
      for (const output of drawOutputs) {
        const arr = outputs[output.key] ?? []
        if (arr.length) readout[output.key] = arr[arr.length - 1].value
      }
      latest[inst.id] = readout
    }

    const bars = barsRef.current
    if (bars.length) {
      const lb = bars[bars.length - 1]
      latest.price = { open: lb.open, high: lb.high, low: lb.low, close: lb.close }
    }
    latestValuesRef.current = latest
    // Seed every pane's legend with the latest-bar values so they read correctly before any hover.
    useAppStore.getState().setCrosshair(cellId, latest)
  }, [indicators, q.data, timeframe, cellId])

  // Position one legend per pane at its top-left. No lightweight-charts "pane resized" event exists
  // (Landmine #2), so measure each pane's <tr> via getBoundingClientRect and observe it for drag/
  // resize. Re-derived on pane composition change (D-36 shifts indices). Legends mount as siblings
  // in the chart wrapper (Landmine #3 — never appended into the <tr>).
  useEffect(() => {
    const chart = chartRef.current
    const wrapper = containerRef.current?.parentElement
    if (!chart || !wrapper) return

    // Group live instances by their pane index (derived live from each series' pane, not stored).
    const byPane = new Map<number, string[]>()
    byPane.set(0, []) // price pane always present (carries the OHLC readout)
    for (const inst of indicators) {
      const module = registry[inst.type]
      if (!module) continue
      let paneIndex = 0
      if (module.pane === 'separate') {
        const s = indicatorSeriesRef.current.get(inst.id)?.[0]
        paneIndex = s?.getPane().paneIndex() ?? 0
      }
      const list = byPane.get(paneIndex) ?? []
      list.push(inst.id)
      byPane.set(paneIndex, list)
    }

    const reposition = (): void => {
      const wrapperRect = wrapper.getBoundingClientRect()
      const next: PaneLegend[] = []
      for (const [paneIndex, instanceIds] of byPane) {
        const paneEl = chart.panes()[paneIndex]?.getHTMLElement()
        if (!paneEl) continue
        const paneRect = paneEl.getBoundingClientRect()
        next.push({ paneIndex, top: paneRect.top - wrapperRect.top + 8, left: 8, instanceIds })
      }
      next.sort((a, b) => a.paneIndex - b.paneIndex)
      setPaneLegends(next)
    }

    const observers: ResizeObserver[] = []
    for (const [paneIndex] of byPane) {
      const paneEl = chart.panes()[paneIndex]?.getHTMLElement()
      if (!paneEl) continue
      const ro = new ResizeObserver(reposition)
      ro.observe(paneEl)
      observers.push(ro)
    }
    reposition()

    return () => { for (const ro of observers) ro.disconnect() }
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
      {paneLegends.map((pl) => (
        <IndicatorLegend
          key={pl.paneIndex}
          cellId={cellId}
          instanceIds={pl.instanceIds}
          isPricePane={pl.paneIndex === 0}
          style={{ top: `${pl.top}px`, left: `${pl.left}px` }}
        />
      ))}
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
