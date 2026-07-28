// src/renderer/lib/economicIndicatorSeries.ts
import type { EconomicIndicatorPoint, EconomicIndicatorYears } from '@shared/types'

// 1 つのトグルが「取得地平」と「表示スライス」を兼ねる。10Y / Max が無いのは EI-01 の 90 日窓の
// せいで、全履歴が現実的な回数で取れないため（10 年 × 23 本で約 920 リクエスト）。
export type IndicatorRange = '1Y' | '5Y'
export const INDICATOR_RANGES: IndicatorRange[] = ['1Y', '5Y']
// 既定は 1Y — 初回に開いた指標が約 5 リクエストで済むほうを選ぶ（5Y は約 22）。
export const DEFAULT_INDICATOR_RANGE: IndicatorRange = '1Y'

const YEARS: Record<IndicatorRange, EconomicIndicatorYears> = { '1Y': 1, '5Y': 5 }

// service に渡す取得地平。ここが唯一の変換点なので、範囲を足すときはこの Record だけ直す。
export const rangeYears = (range: IndicatorRange): EconomicIndicatorYears => YEARS[range]

// 表示スライスの基準は最新観測日（EI-08）。今日から遡ると、四半期系列や発表が遅れている系列で
// 1Y が空になる。取得地平（今日から遡って API を叩く深さ）とは基準日が違う点に注意 — 地平が
// 今日基準なのはリクエスト回数を決めるためで、スライスが最新観測基準なのは見せる中身を決めるため。
// カットオフは Date を使わず文字列で作る: 'YYYY-MM-DD' は辞書順が日付順と一致するので、
// 年だけ引いた '2019-02-29' のような実在しない日付でも境界として正しく働く。
export function sliceRange(points: EconomicIndicatorPoint[], range: IndicatorRange): EconomicIndicatorPoint[] {
  if (points.length === 0) return points
  const last = points[points.length - 1].date
  const cutoff = `${Number(last.slice(0, 4)) - YEARS[range]}${last.slice(4)}`
  return points.filter((p) => p.date >= cutoff)
}

export type IndicatorRow = { date: string; value: number; delta: number | null }

// delta は直前の観測との絶対差（EI-07）。% 変化にすると unemploymentRate のように値そのものが %
// の系列で「% の %」になり、4.2 → 4.3 が +2.4% と表示されて誤読を招く。前月比 % はカレンダー側の
// 'CPI MoM' 行が担当する。
function rowAt(all: EconomicIndicatorPoint[], i: number): IndicatorRow {
  const p = all[i]
  return { date: p.date, value: p.value, delta: i > 0 ? p.value - all[i - 1].value : null }
}

// 表の行（新しい順）。visible はスライス後、all は取得済み全件。delta は all の中の 1 つ前を使うので、
// スライス境界の行でも空欄にならない。
export function tableRows(
  all: EconomicIndicatorPoint[],
  visible: EconomicIndicatorPoint[],
  limit = 20
): IndicatorRow[] {
  const indexByDate = new Map(all.map((p, i) => [p.date, i]))
  return visible
    .slice(Math.max(0, visible.length - limit))
    .reverse()
    .map((p) => rowAt(all, indexByDate.get(p.date)!))
}

export function latestRow(all: EconomicIndicatorPoint[]): IndicatorRow | null {
  return all.length === 0 ? null : rowAt(all, all.length - 1)
}

// 桁数は系列ごとに持たない。この一律ルールで GDP(30000台) も unemploymentRate(4.2) も
// recession probability(0.03) も読める。
export const formatValue = (n: number): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export const formatDelta = (n: number | null): string =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${formatValue(n)}`
