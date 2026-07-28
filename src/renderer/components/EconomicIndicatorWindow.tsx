// src/renderer/components/EconomicIndicatorWindow.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  DEFAULT_INDICATOR_RANGE, INDICATOR_RANGES, formatDelta, formatValue, latestRow, rangeYears,
  sliceRange, tableRows, type IndicatorRange
} from '@/lib/economicIndicatorSeries'
import {
  DEFAULT_ECONOMIC_INDICATOR, ECONOMIC_INDICATORS, ECONOMIC_INDICATOR_CATEGORIES, indicatorMeta
} from '@shared/economicIndicators'
import type { EconomicIndicatorSeries } from '@shared/types'

// company.info / 経済カレンダーと同じ分岐。IPC 越しの message から判定するので新しい型は増やさない。
function errorMessage(err: unknown): string {
  const m = String((err as Error)?.message ?? '')
  if (/NO_API_KEY/.test(m)) return 'Set your FMP API key in Settings.'
  if (/FMP HTTP 401/.test(m)) return 'Your FMP API key was rejected. Check it in Settings.'
  if (/FMP HTTP 429/.test(m)) return 'FMP request limit reached. Wait a moment and try again.'
  if (/FMP HTTP (200|40[0-9])/.test(m)) return 'Economic indicators aren’t available on your current FMP plan.'
  return 'Couldn’t load this indicator. Check your connection.'
}

export function EconomicIndicatorWindow(): React.JSX.Element {
  // 選択中の指標は main が持つ（EI-06）。マウント時に pull し、以降は onSelect で受ける。
  // 初期値は null（「まだ誰も指定していない」を表現できる状態） — pull が解決するまで
  // query を有効化しない。既定値の置き場所は useState ではなく、この pull の fallback だけ
  // （main から null が来たときにここで DEFAULT_ECONOMIC_INDICATOR を当てる）。
  const [name, setName] = useState<string | null>(null)
  const [range, setRange] = useState<IndicatorRange>(DEFAULT_INDICATOR_RANGE)
  const qc = useQueryClient()
  const years = rangeYears(range)

  // 折れ線がテーマ CSS 変数から色を読むので、Chart 窓と同じくテーマを適用する。
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])

  useEffect(() => {
    void api.economicIndicator.getSelected().then((n) => setName(n ?? DEFAULT_ECONOMIC_INDICATOR))
    return api.economicIndicator.onSelect(setName)
  }, [])

  const meta = name ? indicatorMeta(name) : null
  useEffect(() => { document.title = meta ? meta.label : name ?? '' }, [meta, name])

  // name が null の間は pull が終わっていないので無効化（enabled: false）。これが無いと
  // マウント直後の未確定な CPI 既定で 5 リクエストが飛び、pull が解決した実際の指標でまた
  // 5 リクエストが飛ぶ（カレンダー行から CPI 以外を開いたときの無駄撃ち）。
  const q = useQuery<EconomicIndicatorSeries>({
    queryKey: qk.economicIndicator(name ?? '', years),
    queryFn: () => api.economicIndicator.getSeries(name!, { years }),
    enabled: name !== null,
    // 地平を広げる（1Y → 5Y）と query key が変わり、素の TanStack なら新 key に data が無いので
    // isLoading に戻って下の Fetching… ヒントが出せない。前の地平の画面を残しつつ isLoading を
    // 落とすことで、バックフィル中のヒントを表示可能にする。ただし指標を切り替えても key は
    // 変わるので、これだけだと前の指標の値が新しい指標のラベル・unit の下に残ってしまう —
    // 下の data ガード（series.name === name）で「前の指標のプレースホルダ」を弾く。
    placeholderData: keepPreviousData
  })
  const reload = useMutation({
    mutationFn: () => api.economicIndicator.getSeries(name!, { years, force: true }),
    onSuccess: (data) => qc.setQueryData(qk.economicIndicator(name ?? '', years), data)
  })

  // keepPreviousData は query key が変われば必ず残る。地平（years）の変化なら前の地平の
  // データで問題ないが、指標（name）の変化だと前の指標の値が新しい指標として表示されてしまう
  // （unit・meta は name から即時に切り替わるのに、series はそのまま）。series.name で選別する。
  const data = q.data?.name === name ? q.data : undefined
  // name が null の間（pull 未解決）と、指標を切り替えて data がまだ前の指標のままの間は
  // どちらも「表示できるものがない」なので、まとめて loading に乗せて「No data」を出さない。
  const loading = !q.isError && (name === null || q.isLoading || !data)

  const all = data?.points ?? []
  const visible = useMemo(() => sliceRange(all, range), [all, range])
  const rows = useMemo(() => tableRows(all, visible), [all, visible])
  const latest = useMemo(() => latestRow(all), [all])

  const asOf = data ? new Date(data.fetchedAt * 1000) : null
  const asOfLabel = asOf && data
    ? `As of ${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')} ${String(asOf.getHours()).padStart(2, '0')}:${String(asOf.getMinutes()).padStart(2, '0')}${data.stale ? ' (update failed)' : ''} · from ${data.coveredFrom}`
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
                {meta ? meta.label : name ?? '…'}
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
            value={range}
            onValueChange={(v) => { if (v) setRange(v as IndicatorRange) }}
          >
            {INDICATOR_RANGES.map((r) => (
              <ToggleGroupItem key={r} value={r} size="sm" aria-label={r}>{r}</ToggleGroupItem>
            ))}
          </ToggleGroup>

          <span className="ml-auto text-xs text-muted-foreground">{asOfLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => reload.mutate()}
            disabled={reload.isPending || q.isFetching || name === null}
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
          {q.isFetching && !loading && !q.isError && <span>Fetching {range} history…</span>}
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
