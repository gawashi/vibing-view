import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { GripVertical, X } from 'lucide-react'
import { api, qk } from '@/api'
import { useAppStore, selectActiveItems } from '@/store'
import { cn } from '@/lib/utils'
import { latestPriceChange } from '@/lib/priceChange'
import type { Bar, WatchlistItem, Quote, MarketStatus } from '@shared/types'

function Row({
  item,
  index,
  isOver,
  setOverIndex
}: {
  item: WatchlistItem
  index: number
  isOver: boolean
  setOverIndex: (i: number | null) => void
}): React.JSX.Element {
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist)

  // 起動時から価格を表示する（ユーザー要望 #5）。queryFn は CacheService 経由のキャッシュ読み抜き
  // なので、キャッシュ済み銘柄は無通信、未取得の日足だけ1回フェッチ。staleTime:Infinity で以後は
  // 再取得しない。描画される行（=アクティブリスト）だけが走るので非アクティブ銘柄は取得しない。
  const { data: bars } = useQuery<Bar[]>({
    queryKey: qk.ohlcv(item.symbol, '1d'),
    queryFn: () => api.ohlcv.get(item.symbol, '1d', undefined),
    staleTime: Infinity
  })
  // Quote + market status are populated by the global reload only (enabled:false → never fetch on
  // mount, just read cache and re-render when reload calls setQueryData). Open → live quote; closed
  // or not-yet-loaded → daily-close change (computeChange fallback lives inside latestPriceChange).
  const { data: marketStatus } = useQuery<MarketStatus>({
    queryKey: qk.marketStatus(),
    queryFn: () => api.market.status(),
    enabled: false
  })
  const { data: quote } = useQuery<Quote>({
    queryKey: qk.quote(item.symbol),
    queryFn: () => api.quote.get(item.symbol),
    enabled: false
  })
  const change = latestPriceChange(bars, quote, marketStatus?.isOpen ?? false)

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => setActiveSymbol(item.symbol)}
      onKeyDown={(e) => { if (e.key === 'Enter') setActiveSymbol(item.symbol) }}
      // Whole row is the drop target — dragOver must preventDefault or the browser shows the
      // not-allowed cursor and never fires drop. Drag is only *initiated* from the grip (D-66).
      onDragOver={(e) => { e.preventDefault(); setOverIndex(index) }}
      onDrop={(e) => {
        e.preventDefault()
        const from = Number(e.dataTransfer.getData('text/plain'))
        if (!Number.isNaN(from) && index >= 0) useAppStore.getState().reorderWatchlist(from, index)
        setOverIndex(null)
      }}
      // border-t-2 always reserved (transparent) so the accent insertion marker never shifts layout.
      className={cn(
        'group flex items-center gap-1 border-t-2 border-transparent px-2 py-2 hover:bg-secondary',
        isOver && 'border-primary'
      )}
    >
      <span
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          const from = selectActiveItems(useAppStore.getState()).findIndex((w) => w.symbol === item.symbol)
          e.dataTransfer.setData('text/plain', String(from))
        }}
        onDragEnd={() => setOverIndex(null)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Reorder ${item.symbol}`}
        className="invisible shrink-0 cursor-grab text-muted-foreground group-hover:visible"
      >
        <GripVertical className="size-4" />
      </span>
      <span className="font-semibold">{item.symbol}</span>
      <span className="truncate text-xs text-muted-foreground" title={item.name}>{item.name}</span>
      <span
        className={cn(
          'ml-auto shrink-0 text-sm',
          change?.pct != null && (change.pct >= 0 ? 'text-green-500' : 'text-red-500')
        )}
      >
        {change ? change.price.toFixed(2) : ''}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          removeFromWatchlist(item.symbol)
        }}
        aria-label={`Remove ${item.symbol} from watchlist`}
        className="invisible shrink-0 text-muted-foreground hover:text-destructive group-hover:visible"
      >
        <X className="size-4" />
      </button>
    </li>
  )
}

export function Watchlist({
  open,
  width,
  onWidthChange
}: {
  open: boolean
  width: number
  onWidthChange: (w: number) => void
}): React.JSX.Element {
  const watchlist = useAppStore(selectActiveItems)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)
  const [dragging, setDragging] = React.useState(false)

  return (
    <aside
      style={{ width: open ? width : 0 }}
      className={cn(
        'relative h-full overflow-hidden border-r border-border bg-background',
        // トランジションはドラッグ中は無効(追従ラグ防止)、開閉時のみ有効。
        !dragging && 'transition-[width]'
      )}
    >
      <div className="h-full overflow-y-auto" style={{ width }}>
        {watchlist.length === 0
          ? (
            <div className="p-2 text-sm text-muted-foreground">
              Your watchlist is empty. Add symbols from search results.
            </div>
            )
          : (
            <ul onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverIndex(null) }}>
              {watchlist.map((item, i) => (
                <Row
                  key={item.symbol}
                  item={item}
                  index={i}
                  isOver={overIndex === i}
                  setOverIndex={setOverIndex}
                />
              ))}
              {/* 末尾ドロップゾーン: 最終行の下へ落とすと末尾へ移動。marker(border-t)= 最終行の下端。
                  reorder(from, length) は from<length で to-1=末尾スロットに挿入。 */}
              <li
                onDragOver={(e) => { e.preventDefault(); setOverIndex(watchlist.length) }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = Number(e.dataTransfer.getData('text/plain'))
                  if (!Number.isNaN(from)) useAppStore.getState().reorderWatchlist(from, watchlist.length)
                  setOverIndex(null)
                }}
                className={cn('h-8 border-t-2 border-transparent', overIndex === watchlist.length && 'border-primary')}
              />
            </ul>
            )}
      </div>
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragging(true)
          }}
          onPointerMove={(e) => {
            if (!dragging) return
            const left = e.currentTarget.parentElement!.getBoundingClientRect().left
            onWidthChange(Math.min(640, Math.max(240, e.clientX - left)))
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId)
            setDragging(false)
          }}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary"
        />
      )}
    </aside>
  )
}
