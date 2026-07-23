import React, { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Star, GripVertical } from 'lucide-react'
import { api, qk } from '@/api'
import { useAppStore, selectActiveItems } from '@/store'
import { cellCount } from '@shared/workspace'
import { AddIndicatorMenu } from './AddIndicatorMenu'
import { Button } from './ui/button'
import { Chart } from './Chart'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { TimeframeRow, TF_LABELS } from './TimeframeRow'
import { ChartContextMenu } from './ChartContextMenu'
import { cn } from '@/lib/utils'
import { computeChange } from '@/lib/priceChange'
import type { Bar, Cell, MarketStatus, Quote, Timeframe, SymbolResult } from '@shared/types'

// Module-level (shared across every cell, not per-cell state): the rate-limited-tf toast guard.
// capabilities is a single map keyed by timeframe alone (one entry per API key, D-60 review), and
// grid-expand (D-55) commonly duplicates the same timeframe into 2-4 cells — a per-cell guard would
// let each cell's own effect pass its own single-flight check and stack N identical toasts. Keying
// this guard by timeframe alone, at module scope, gives one toast per rate-limited tf regardless of
// how many cells currently share it.
//
// The renderer only ever sees a plain CapabilityStatus string per tf (capabilities:get returns
// Record<Timeframe, CapabilityStatus> — no probedAt/episode identity crosses IPC; that timestamp
// lives only in main's capabilityCache.ts Entry). So this guard can't tell "still the same
// rate-limit episode" from "a new one after today's UTC rollover" by content alone. Instead it
// resets whenever the shared capsQ.data *reference* changes: main hands back a brand-new object on
// every capabilities:get call, and a call only happens via this hook's own invalidateQueries calls
// below (eager probe done / ohlcv error) — i.e. on a real observed state transition. That means a
// resolved-then-recurring rate limit gets a fresh reference (and so a fresh toast) once anything
// re-probes it, instead of staying permanently suppressed by a stale per-tf boolean.
let lastCapsData: unknown
const toastedForTf = new Set<Timeframe>()

// Per-cell capability gating (D-60): each rendered cell independently probes/gates its own row off
// its OWN symbol+timeframe, mirroring the logic that used to live once at App level (05-01 and
// earlier). Reuses Chart's own ['ohlcv', symbol, tf] query cache entry and the single shared
// ['capabilities'] entry — no extra fetches, same as the pre-grid App.tsx effects. The rate-limit
// toast itself is the one exception (see toastedForTf above) — it's a shared side effect, not
// per-cell state, so its guard lives at module scope instead of in this hook's local state.
function useCellCapabilityGating(cellId: string, symbol: string | null, timeframe: Timeframe): void {
  const queryClient = useQueryClient()
  const setCellTimeframe = useAppStore((s) => s.setCellTimeframe)

  const ohlcvQ = useQuery({
    queryKey: qk.ohlcv(symbol ?? '', timeframe),
    queryFn: () => api.ohlcv.get(symbol ?? '', timeframe, undefined),
    enabled: !!symbol
  })
  const capsQ = useQuery({
    queryKey: qk.capabilities(),
    queryFn: () => api.capabilities.get(),
    // structuralSharing (TanStack default: true) would keep the OLD object reference when a
    // refetch returns a deep-equal result — e.g. day-2's rate-limited verdict deep-equals the
    // still-cached day-1 one. That would defeat the toastedForTf reference-change reset above.
    // This query only ever refetches on an explicit invalidateQueries(qk.capabilities()) call (see
    // this hook's own invalidate calls; global staleTime is Infinity, no focus/interval refetch),
    // so with structural sharing off, a reference change here means exactly one thing: a real
    // refetch happened. Do not remove — the toast dedup's correctness depends on it.
    structuralSharing: false
  })

  useEffect(() => {
    // Eager one-time probe (D-21 override): grey gated intraday timeframes from startup instead of
    // only after a click. Only probes tfs still 'unknown' for the current key — self-limiting, since
    // once any cell resolves the (key-wide, not per-symbol) capability map, the rest see it as known.
    if (!symbol || !capsQ.data) return
    const intraday: Timeframe[] = ['1m', '5m', '15m', '1h']
    const unknown = intraday.filter((tf) => capsQ.data?.[tf] === 'unknown')
    if (unknown.length === 0) return
    void Promise.allSettled(unknown.map((tf) => api.ohlcv.get(symbol, tf, undefined)))
      .then(() => queryClient.invalidateQueries({ queryKey: qk.capabilities() }))
  }, [symbol, capsQ.data, queryClient])

  useEffect(() => {
    if (ohlcvQ.isError) void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
  }, [ohlcvQ.isError, queryClient])

  useEffect(() => {
    // A tf discovered gated (requires-plan) after its first probe snaps THIS cell back to daily so
    // its chart stays visible while the now-disabled button explains why.
    if (capsQ.data?.[timeframe] === 'requires-plan') setCellTimeframe(cellId, '1d')
  }, [capsQ.data, timeframe, cellId, setCellTimeframe])

  useEffect(() => {
    // A fresh capabilities snapshot (new object reference) may carry a new episode — clear the
    // guard so a still/newly rate-limited tf can re-announce instead of staying suppressed forever.
    if (capsQ.data && capsQ.data !== lastCapsData) {
      lastCapsData = capsQ.data
      toastedForTf.clear()
    }
    const isRateLimited = capsQ.data?.[timeframe] === 'rate-limited'
    if (isRateLimited && !toastedForTf.has(timeframe)) {
      toastedForTf.add(timeframe)
      toast(`Rate limit reached for ${TF_LABELS[timeframe]}. Showing cached data — new bars will load once the limit resets.`)
    }
  }, [capsQ.data, timeframe])
}

// SymbolLabel と FavoriteStar が共有するプロファイル取得。key/queryFn/staleTime を一箇所に
// まとめ、2つの呼び出し元が乖離して TanStack のデデュープを壊すのを防ぐ。
function useProfile(symbol: string): ReturnType<typeof useQuery<SymbolResult>> {
  return useQuery<SymbolResult>({
    queryKey: qk.profile(symbol),
    queryFn: () => api.symbols.profile(symbol),
    staleTime: Infinity
  })
}

// 各セルの銘柄＋現在値＋騰落率。データは Chart / gating フックが埋めた ohlcv キャッシュを
// subscribe-only(enabled:false)で読むだけ(追加フェッチ無し)。intraday の前日終値は日足が要るため、
// intraday セルのみ日足を1回実フェッチ(1銘柄1リクエスト・永続キャッシュ、週足/月足にも再利用)。
function SymbolLabel({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }): React.JSX.Element {
  const isIntraday = timeframe === '1m' || timeframe === '5m' || timeframe === '15m' || timeframe === '1h'
  const barsQ = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol, timeframe),
    queryFn: () => api.ohlcv.get(symbol, timeframe, undefined),
    enabled: false // subscribe-only: Chart/gating が同キーを埋める
  })
  const dailyQ = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol, '1d'),
    queryFn: () => api.ohlcv.get(symbol, '1d', undefined),
    enabled: isIntraday, // intraday のみ前日終値のため実フェッチ
    staleTime: Infinity
  })
  // Populated by the global reload only (enabled:false → read cache, re-render on setQueryData).
  // Open → live quote (matches chart legend/candle + watchlist); closed/not-yet-loaded → existing
  // timeframe-aware daily-close fallback.
  const { data: marketStatus } = useQuery<MarketStatus>({
    queryKey: qk.marketStatus(),
    queryFn: () => api.market.status(),
    enabled: false
  })
  const { data: quote } = useQuery<Quote>({
    queryKey: qk.quote(symbol),
    queryFn: () => api.quote.get(symbol),
    enabled: false
  })
  const change = marketStatus?.isOpen && quote
    ? { price: quote.price, pct: quote.changePercentage }
    : computeChange(barsQ.data, timeframe, dailyQ.data)

  // 銘柄あたり最大1フェッチ。検索で選んだ銘柄は種まき済みで無通信ヒット。staleTime:Infinity で
  // 以後は API キー登録時の invalidate(['profile']) のみが再取得契機。
  const profileQ = useProfile(symbol)
  const profile = profileQ.data
  const exchange = profile?.exchange ? profile.exchange : null
  // フォールバック（name===symbol）は社名未知なので出さない — ティッカーと重複させない。
  const name = profile && profile.name !== symbol ? profile.name : null

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-lg font-semibold">{symbol}</span>
      <FavoriteStar symbol={symbol} />
      {exchange && <span className="shrink-0 text-sm text-muted-foreground">· {exchange}</span>}
      {name && <span className="truncate text-sm text-muted-foreground" title={name}>{name}</span>}
      {change && (
        <>
          <span className="shrink-0 text-sm text-muted-foreground">{change.price.toFixed(2)}</span>
          {change.pct !== null && (
            <span className={cn('shrink-0 text-sm', change.pct >= 0 ? 'text-green-500' : 'text-red-500')}>
              {change.pct >= 0 ? '+' : ''}{change.pct.toFixed(2)}%
            </span>
          )}
        </>
      )}
    </div>
  )
}

// ヘッダーのお気に入り星。SearchResults の星と同一の store アクションを叩くので、サイドバー星と
// 状態は常に一致。プロファイルは SymbolLabel と同じ qk.profile(symbol) を使うため追加フェッチなし。
function FavoriteStar({ symbol }: { symbol: string }): React.JSX.Element {
  const watched = useAppStore((s) => selectActiveItems(s).some((w) => w.symbol === symbol))
  const addToWatchlist = useAppStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist)
  const profileQ = useProfile(symbol)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (watched) {
              removeFromWatchlist(symbol)
            } else {
              const p = profileQ.data
              addToWatchlist({ symbol, name: p?.name ?? symbol, exchange: p?.exchange ?? '' })
            }
          }}
          aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          className={cn(
            'shrink-0 cursor-pointer self-center',
            watched ? 'text-primary hover:text-muted-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Star className={cn('size-4', watched && 'fill-current')} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{watched ? 'Remove from watchlist' : 'Add to watchlist'}</TooltipContent>
    </Tooltip>
  )
}

// The chart toolbar + chart body for one symbol-bearing cell. Rendered fragment (no outer box) so
// GridCell can wrap it as a ContextMenu trigger and ChartWindow can render it full-screen. Owns the
// per-cell capability gating so both the grid and the enlarge window gate their own row.
export function ChartPanel({ cell }: { cell: Cell }): React.JSX.Element {
  const setCellTimeframe = useAppStore((s) => s.setCellTimeframe)
  const clearCell = useAppStore((s) => s.clearCell)
  useCellCapabilityGating(cell.id, cell.symbol, cell.timeframe)

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <SymbolLabel symbol={cell.symbol!} timeframe={cell.timeframe} />
        <TimeframeRow value={cell.timeframe} onChange={(tf) => setCellTimeframe(cell.id, tf)} />
        <AddIndicatorMenu cellId={cell.id} />
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6 [&_svg]:size-3.5"
          aria-label={`Remove ${cell.symbol} chart`}
          onClick={(e) => { e.stopPropagation(); clearCell(cell.id) }}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Chart cellId={cell.id} symbol={cell.symbol!} timeframe={cell.timeframe} />
      </div>
    </>
  )
}

function GridCell({
  cell,
  active,
  isDropTarget,
  onDropTarget
}: {
  cell: Cell
  active: boolean
  isDropTarget: boolean
  onDropTarget: (id: string | null) => void
}): React.JSX.Element {
  const setActiveCell = useAppStore((s) => s.setActiveCell)
  const isCut = useAppStore((s) => s.chartClipboard?.cutSourceCellId === cell.id)

  return (
    <div
      onClick={() => setActiveCell(cell.id)}
      // Double-click a chart-bearing cell → open it enlarged in its own OS window (keyed by cellId).
      onDoubleClick={cell.symbol ? () => void api.chart.openWindow(cell.id) : undefined}
      // Whole cell (incl. empty) is a drop target. Accept only our two MIME types so unrelated drags
      // (text selections, files) don't preventDefault. getData() is empty during dragover — read
      // types here, full payload on drop.
      onDragOver={(e) => {
        const t = e.dataTransfer.types
        if (!t.includes('application/x-vv-cell') && !t.includes('application/x-vv-symbol')) return
        e.preventDefault()
        onDropTarget(cell.id)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const draggedId = e.dataTransfer.getData('application/x-vv-cell')
        if (draggedId) {
          if (draggedId !== cell.id) useAppStore.getState().swapCells(draggedId, cell.id)
        } else {
          const symbol = e.dataTransfer.getData('application/x-vv-symbol')
          if (symbol) {
            useAppStore.getState().setCellSymbol(cell.id, symbol)
            setActiveCell(cell.id)
          }
        }
        onDropTarget(null)
      }}
      className={cn(
        // group/cell: scopes the grip handle's hover-reveal. min-h-0 + min-w-0: let the cell shrink
        // to its grid track (2x2 height fix). relative: anchors the absolutely-positioned handle.
        'group/cell relative flex h-full min-h-0 min-w-0 flex-col gap-4 rounded-md',
        active && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        // Drop-target highlight is visually distinct from the active ring: a dashed inset accent
        // outline that reads as "this is where it lands". Can co-exist with the active ring.
        isDropTarget && 'outline-dashed outline-2 outline-offset-[-4px] outline-primary'
      )}
    >
      <ChartContextMenu cellId={cell.id}>
        {cell.symbol
          ? (
            /* pl-6 reserves a left gutter for the drag handle so it sits to the LEFT of the ticker
               instead of top-right next to the × button (mis-click hazard). isCut greys the cell
               while it's a pending-cut source (cleared on paste). */
            <div className={cn('flex h-full min-h-0 min-w-0 flex-col gap-4 pl-6', isCut && 'opacity-40')}>
              {/* Drag handle: the ONLY drag source for the cell — keeps chart body, timeframe/★/×
                  buttons, and the shared ChartPanel (used by ChartWindow) non-draggable. */}
              <span
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  e.dataTransfer.setData('application/x-vv-cell', cell.id)
                }}
                onDragEnd={() => onDropTarget(null)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Move ${cell.symbol} chart`}
                className="invisible absolute left-1 top-1.5 z-10 cursor-grab text-muted-foreground hover:text-foreground group-hover/cell:visible"
              >
                <GripVertical className="size-4" />
              </span>
              <ChartPanel cell={cell} />
            </div>
            )
          : <div className="flex h-full min-h-0 min-w-0 items-start p-6 text-muted-foreground">Search a symbol to begin.</div>}
      </ChartContextMenu>
    </div>
  )
}

export function GridHost(): React.JSX.Element {
  const cells = useAppStore((s) => s.cells)
  const shape = useAppStore((s) => s.shape)
  const activeCellId = useAppStore((s) => s.activeCellId)
  // Single drop-target highlight for the whole grid. Cleared on drop, dragend, or when the pointer
  // leaves the grid entirely (relatedTarget outside) — covers Esc/cancel and off-grid drops.
  const [dragOverCellId, setDragOverCellId] = React.useState<string | null>(null)

  const visible = cells.slice(0, cellCount(shape))

  return (
    <div
      className="grid h-full gap-4 p-4"
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCellId(null)
      }}
      style={{
        // Tailwind の動的クラス（grid-cols-${n}）は JIT に拾われないため style 直指定。
        // minmax(0,1fr) は 2x2 で使っていた min-h-0/min-w-0 と同趣旨のトラック縮小保証。
        gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))`
      }}
    >
      {visible.map((cell) => (
        <GridCell
          key={cell.id}
          cell={cell}
          active={cell.id === activeCellId}
          isDropTarget={cell.id === dragOverCellId}
          onDropTarget={setDragOverCellId}
        />
      ))}
    </div>
  )
}
