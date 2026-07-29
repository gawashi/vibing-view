// src/renderer/components/EconomicIndicatorWindow.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import { applyTheme } from '@/lib/theme'
import { Button } from './ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from './ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { EconomicIndicatorChart } from './EconomicIndicatorChart'
import {
  INDICATOR_YEARS, formatDelta, formatValue, latestRow, sliceRange, tableRows
} from '@/lib/economicIndicatorSeries'
import {
  ECONOMIC_INDICATORS, ECONOMIC_INDICATOR_CATEGORIES, indicatorMeta
} from '@shared/economicIndicators'
import type { EconomicIndicatorSeries, EconomicIndicatorYears } from '@shared/types'

// company.info / 経済カレンダーと同じ分岐。IPC 越しの message から判定するので新しい型は増やさない。
function errorMessage(err: unknown): string {
  const m = String((err as Error)?.message ?? '')
  if (/NO_API_KEY/.test(m)) return 'Set your FMP API key in Settings.'
  if (/FMP HTTP 401/.test(m)) return 'Your FMP API key was rejected. Check it in Settings.'
  if (/FMP HTTP 429/.test(m)) return 'FMP request limit reached. Wait a moment and try again.'
  if (/FMP HTTP (200|40[0-9])/.test(m)) return 'Economic indicators aren’t available on your current FMP plan.'
  return 'Couldn’t load this indicator. Check your connection.'
}

export function EconomicIndicatorWindow({ initialName }: { initialName: string }): React.JSX.Element {
  // 選択中の指標は main が持つ（EI-06）。開くときの値は hash 経由で prop に届くので、最初の
  // レンダーから確定している。既に開いている窓への差し替えだけ onSelect で受ける。
  const [name, setName] = useState(initialName)
  const [years, setYears] = useState<EconomicIndicatorYears>(INDICATOR_YEARS[0])
  const qc = useQueryClient()

  // 折れ線がテーマ CSS 変数から色を読むので、Chart 窓と同じくテーマを適用する。
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])

  useEffect(() => api.economicIndicator.onSelect(setName), [])

  const meta = indicatorMeta(name)
  useEffect(() => { document.title = meta?.label ?? name }, [meta, name])

  const q = useQuery<EconomicIndicatorSeries>({
    queryKey: qk.economicIndicator(name, years),
    queryFn: () => api.economicIndicator.getSeries(name, { years }),
    // 地平を広げる（1Y → 5Y）と query key が変わり、素の TanStack なら新 key に data が無いので
    // isLoading に戻って下の Fetching… ヒントが出せない。前の地平の画面を残しつつ isLoading を
    // 落とすことで、バックフィル中のヒントを表示可能にする。指標そのものが変わったときは残さない
    // — 前の指標の値が、新しい指標のラベル・unit の下に並んでしまう。
    placeholderData: (prev) => (prev?.name === name ? prev : undefined)
  })
  const reload = useMutation({
    mutationFn: () => api.economicIndicator.getSeries(name, { years, force: true }),
    onSuccess: (data) => qc.setQueryData(qk.economicIndicator(name, years), data)
  })

  const data = q.data
  // placeholder が無い＝表示できるものがない。指標の切り替え直後も初回ロードもこれで拾える。
  const loading = !q.isError && !data

  const all = data?.points ?? []
  const visible = useMemo(() => sliceRange(all, years), [all, years])
  const rows = useMemo(() => tableRows(all, visible), [all, visible])
  const latest = useMemo(() => latestRow(all), [all])

  const asOfLabel = data
    ? `As of ${format(data.fetchedAt * 1000, 'yyyy-MM-dd HH:mm')}${data.stale ? ' (update failed)' : ''} · from ${data.coveredFrom}`
    : ''

  const grouped = ECONOMIC_INDICATOR_CATEGORIES.map((c) => ({
    category: c,
    items: ECONOMIC_INDICATORS.filter((m) => m.category === c)
  }))

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1.5">
                {meta?.label ?? name}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            {/* 23 件を平坦に並べると探せないので category で区切る */}
            <DropdownMenuContent align="start" className="max-h-[70vh] overflow-auto">
              {grouped.map((g) => (
                <React.Fragment key={g.category}>
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
                    {g.category}
                  </div>
                  {g.items.map((m) => (
                    <DropdownMenuItem
                      key={m.name}
                      className={m.name === name ? 'bg-accent text-accent-foreground' : ''}
                      // main が選択の真実を持つ（EI-06）。ここで setName すると、窓を閉じて
                      // 開き直したときに main の古い選択で上書きされて選び直しが失われる。
                      onClick={() => void api.economicIndicator.openWindow(m.name)}
                    >
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                </React.Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 範囲は表示スライスと取得地平を兼ねる。1Y → 5Y はバックフィル（約 17 リクエスト）が
              走るので、下の Fetching… が出ているうちは十数秒かかる。 */}
          <ToggleGroup
            type="single"
            value={String(years)}
            onValueChange={(v) => { if (v) setYears(Number(v) as EconomicIndicatorYears) }}
          >
            {INDICATOR_YEARS.map((y) => (
              <ToggleGroupItem key={y} value={String(y)} size="sm" aria-label={`${y}Y`}>{y}Y</ToggleGroupItem>
            ))}
          </ToggleGroup>

          <span className="ml-auto text-xs text-muted-foreground">{asOfLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => reload.mutate()}
            disabled={reload.isPending || q.isFetching}
            aria-label="Reload indicator"
            title="Reload indicator"
          >
            <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
          </Button>
        </div>

        {/* unit がここに出ることが、水準値と前月比 % の誤読を防ぐ（カレンダーの 'CPI MoM' から来た場合） */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{meta?.unit ?? ''}</span>
          {latest && (
            <>
              <span className="tabular-nums">
                Latest {formatValue(latest.value)} ({latest.date})
              </span>
              <span className="tabular-nums">Δ {formatDelta(latest.delta)}</span>
            </>
          )}
          {/* 地平を広げる操作は 90 日窓を直列に取るので待たされる。無言で固まらせない。
              !q.isError も付けるのは、失敗した行のバックグラウンド再取得（あれば）で
              isFetching と isError が両立する一瞬に、エラー表示の上にヒントを重ねないため。 */}
          {q.isFetching && !loading && !q.isError && <span>Fetching {years}Y history…</span>}
        </div>
      </div>

      {loading && <div className="p-3 text-sm text-muted-foreground">Loading indicator…</div>}
      {q.isError && <div className="p-3 text-center text-sm text-muted-foreground">{errorMessage(q.error)}</div>}
      {!loading && !q.isError && all.length === 0 && (
        <div className="p-3 text-center text-sm text-muted-foreground">No data for this indicator.</div>
      )}

      {!loading && !q.isError && all.length > 0 && (
        <>
          <div className="min-h-0 flex-1">
            <EconomicIndicatorChart points={visible} />
          </div>
          <div className="max-h-[40%] shrink-0 overflow-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Date</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Value</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-t border-border/50">
                    <td className="px-3 py-1 tabular-nums">{r.date}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{formatValue(r.value)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{formatDelta(r.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
