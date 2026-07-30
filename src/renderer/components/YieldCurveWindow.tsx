// src/renderer/components/YieldCurveWindow.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { RefreshCw, X } from 'lucide-react'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import { applyTheme } from '@/lib/theme'
import { cssHsl } from '@/lib/chartTheme'
import { Button } from './ui/button'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { YieldCurveChart } from './YieldCurveChart'
import { TreasuryHistoryChart, type HistorySeries } from './TreasuryHistoryChart'
import { MATURITIES, SPREADS, TREASURY_YEARS } from '@shared/treasury'
import {
  curveAt, formatRate, formatRateDelta, maturityColor, seriesFor, sliceRange, snapToDate,
  spreadSeries, tableRows, zeroLineSeries
} from '@/lib/treasuryCurve'
import type { TreasuryCurves, TreasuryMaturityKey, TreasuryYears } from '@shared/types'

// 基準（最新）と合わせて 4 本。それ以上重ねると断面図が読めない（YC-06）。
const MAX_COMPARE = 3
// 初回に開いた画面で逆イールドが読める組み合わせ（YC-07）。
const DEFAULT_MATURITIES: TreasuryMaturityKey[] = ['month3', 'year2', 'year10']
const DEFAULT_SPREADS = ['10y2y']

// 統計指標窓と同じ分岐。IPC 越しの message から判定するので新しい型は増やさない。
function errorMessage(err: unknown): string {
  const m = String((err as Error)?.message ?? '')
  if (/NO_API_KEY/.test(m)) return 'Set your FMP API key in Settings.'
  if (/FMP HTTP 401/.test(m)) return 'Your FMP API key was rejected. Check it in Settings.'
  if (/FMP HTTP 429/.test(m)) return 'FMP request limit reached. Wait a moment and try again.'
  // parseOrThrowHttpError はスキーマ不一致もすべて FmpHttpError(200) にするので、この枝には
  // プラン拒否（200 + Error Message）と FMP 側のフィールド名変更の両方が入る。どちらでも成り立つ
  // 文言にする（意味コード化は YC-12）。
  if (/FMP HTTP (200|40[0-9])/.test(m)) {
    return 'Treasury rates aren’t available on your current FMP plan, or FMP returned an unexpected response.'
  }
  return 'Couldn’t load treasury rates. Check your connection.'
}

export function YieldCurveWindow(): React.JSX.Element {
  const [years, setYears] = useState<TreasuryYears>(TREASURY_YEARS[0])
  const [compareDates, setCompareDates] = useState<string[]>([])
  const [maturities, setMaturities] = useState<TreasuryMaturityKey[]>(DEFAULT_MATURITIES)
  const [spreads, setSpreads] = useState<string[]>(DEFAULT_SPREADS)
  // <input type="date"> を選び直せるように、追加したら空に戻す。
  const [picked, setPicked] = useState('')
  const qc = useQueryClient()

  // 折れ線と断面がテーマ CSS 変数から色を読むので、他の別ウィンドウと同じくテーマを適用する。
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])
  useEffect(() => { document.title = 'Yield Curve' }, [])

  const q = useQuery<TreasuryCurves>({
    queryKey: qk.treasuryCurves(years),
    queryFn: () => api.yieldCurve.getCurves({ years }),
    // 地平を広げる（1Y → 5Y）と query key が変わり、素の TanStack なら新 key に data が無いので
    // isLoading に戻って下の Fetching… ヒントが出せない。前の地平の画面を残しつつ isLoading を
    // 落とすことで、バックフィル中のヒントを表示可能にする。
    placeholderData: (prev) => prev
  })
  const reload = useMutation({
    mutationFn: () => api.yieldCurve.getCurves({ years, force: true }),
    onSuccess: (data) => qc.setQueryData(qk.treasuryCurves(years), data)
  })

  // 表示していない地平の snapshot は staleTime: Infinity で永久に残る。5Y を取ったあと 1Y に
  // 戻すと古い snapshot が出続け、日付ピッカーの下限もその coveredFrom に縛られたままになる。
  // invalidate 後の再取得は TTL 内ならネットワークに出ない（getCurves が行を返して終わる）。
  useEffect(() => {
    if (!q.data) return
    for (const y of TREASURY_YEARS) {
      if (y !== years) void qc.invalidateQueries({ queryKey: qk.treasuryCurves(y) })
    }
  }, [q.data, years, qc])

  const data = q.data
  // placeholder が無い＝表示できるものがない。
  const loading = !q.isError && !data
  const all = data?.points ?? []
  const latest = all.length > 0 ? all[all.length - 1] : null
  const visible = useMemo(() => sliceRange(all, years), [all, years])

  // 断面はキャッシュ済みの全 points から引くので、下段のスライス（1Y）より古い比較日でも出せる
  // （YC-06: 地平を狭めてもチップは消さない）。新しい順が実線 → 破線 → … の順序と一致する。
  const compares = useMemo(
    () => [...compareDates].sort((a, b) => b.localeCompare(a)).flatMap((d) => curveAt(all, d) ?? []),
    [compareDates, all]
  )
  const curves = useMemo(() => (latest ? [latest, ...compares] : []), [latest, compares])
  const rows = useMemo(() => tableRows(latest, compares), [latest, compares])

  const history = useMemo<HistorySeries[]>(() => [
    ...maturities.map((key) => ({
      id: key,
      color: maturityColor(MATURITIES.findIndex((m) => m.key === key)),
      points: seriesFor(visible, key)
    })),
    // スプレッドは利回りとは別の量なので、満期のランプの外（muted の破線）に置く。
    ...spreads.map((key) => ({
      id: key,
      color: cssHsl('--muted-foreground'),
      dashed: true,
      points: spreadSeries(visible, key)
    })),
    ...(spreads.length > 0
      ? [{ id: '__zero', color: cssHsl('--border'), width: 1 as const, points: zeroLineSeries(visible) }]
      : [])
  ], [maturities, spreads, visible])

  const addCompare = (date: string): void => {
    if (!date) return
    // 選んだ日にデータが無ければ、その日以前で最も近い営業日にスナップする（土日祝・公表を
    // 飛ばした日）。チップにはスナップ後の実際の日付を出す（黙って別の日を見せない）。
    const snapped = snapToDate(all, date)
    if (!snapped || snapped === latest?.date) return
    setCompareDates((prev) =>
      prev.includes(snapped) || prev.length >= MAX_COMPARE ? prev : [...prev, snapped]
    )
  }

  const asOfLabel = data
    ? `As of ${format(data.fetchedAt * 1000, 'yyyy-MM-dd HH:mm')}${data.stale ? ' (update failed)' : ''} · from ${data.coveredFrom}`
    : ''

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">Yield Curve</span>

          {/* 範囲は表示スライスと取得地平を兼ねる。1Y → 5Y は 22 リクエストを直列に取るので
              十数秒かかる（下の Fetching… が出ているうち）。 */}
          <ToggleGroup
            type="single"
            value={String(years)}
            onValueChange={(v) => { if (v) setYears(Number(v) as TreasuryYears) }}
          >
            {TREASURY_YEARS.map((y) => (
              <ToggleGroupItem key={y} value={String(y)} size="sm" aria-label={`${y}Y`}>{y}Y</ToggleGroupItem>
            ))}
          </ToggleGroup>

          <span className="text-xs text-muted-foreground">Compare:</span>
          {compareDates.map((d) => (
            <span key={d} className="flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs tabular-nums">
              {d}
              <button
                type="button"
                aria-label={`Remove ${d}`}
                onClick={() => setCompareDates((prev) => prev.filter((x) => x !== d))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {/* ネイティブのピッカー（依存を増やさない）。min/max をキャッシュ範囲に縛る限り、
              追加フェッチも「まだ取得していない日」の分岐も発生しない（YC-06）。 */}
          <input
            type="date"
            value={picked}
            min={data?.coveredFrom}
            max={latest?.date}
            disabled={!latest || compareDates.length >= MAX_COMPARE}
            onChange={(e) => { setPicked(''); addCompare(e.target.value) }}
            aria-label="Add comparison date"
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
          />

          <span className="ml-auto text-xs text-muted-foreground">{asOfLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => reload.mutate()}
            disabled={reload.isPending || q.isFetching}
            aria-label="Reload treasury rates"
            title="Reload treasury rates"
          >
            <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>US Treasury constant maturity · %</span>
          {/* 地平を広げる操作は 22 窓を直列に取るので待たされる。無言で固まらせない。 */}
          {q.isFetching && !loading && !q.isError && <span>Fetching {years}Y history…</span>}
        </div>
      </div>

      {loading && <div className="p-3 text-sm text-muted-foreground">Loading treasury rates…</div>}
      {q.isError && <div className="p-3 text-center text-sm text-muted-foreground">{errorMessage(q.error)}</div>}
      {!loading && !q.isError && all.length === 0 && (
        <div className="p-3 text-center text-sm text-muted-foreground">No treasury data available.</div>
      )}

      {!loading && !q.isError && all.length > 0 && (
        <>
          <div className="min-h-0 flex-1 px-2 py-1">
            <YieldCurveChart curves={curves} />
          </div>

          {/* 満期 12 個とスプレッド 2 個を同じトグル群に並べ、選んだものを 1 枚に重ねる（YC-07）。
              色の丸がそのまま凡例になる。 */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1.5">
            <ToggleGroup
              type="multiple"
              value={maturities}
              onValueChange={(v) => setMaturities(v as TreasuryMaturityKey[])}
              className="flex-wrap justify-start"
            >
              {MATURITIES.map((m, i) => (
                <ToggleGroupItem key={m.key} value={m.key} size="sm" className="gap-1 text-[11px]">
                  <span className="size-2 rounded-full" style={{ background: maturityColor(i) }} />
                  {m.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="multiple"
              value={spreads}
              onValueChange={setSpreads}
              className="flex-wrap justify-start border-l border-border pl-2"
            >
              {SPREADS.map((s) => (
                <ToggleGroupItem key={s.key} value={s.key} size="sm" className="text-[11px]">
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="min-h-0 flex-1">
            <TreasuryHistoryChart series={history} />
          </div>

          <div className="max-h-[30%] shrink-0 overflow-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Maturity</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Latest</th>
                  {compares.map((c) => (
                    <React.Fragment key={c.date}>
                      <th className="px-3 py-1.5 text-right font-semibold tabular-nums">{c.date}</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Δ</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border/50">
                    <td className="px-3 py-1">{r.label}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{formatRate(r.latest)}</td>
                    {r.cells.map((cell, i) => (
                      <React.Fragment key={compares[i].date}>
                        <td className="px-3 py-1 text-right tabular-nums">{formatRate(cell.value)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{formatRateDelta(cell.delta)}</td>
                      </React.Fragment>
                    ))}
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
