// src/renderer/lib/economicIndicatorSeries.ts
import type { EconomicIndicatorPoint, EconomicIndicatorYears } from '@shared/types'

// 1 つのトグルが「取得地平」と「表示スライス」を兼ねるので、年数そのものが UI の状態。
// 10Y / Max が無いのは EI-01 の 90 日窓のせいで、全履歴が現実的な回数で取れないため
// （10 年 × 23 本で約 920 リクエスト）。既定は先頭の 1 — 初回に開いた指標が約 5 リクエストで
// 済むほうを選ぶ（5Y は約 22）。
export const INDICATOR_YEARS: EconomicIndicatorYears[] = [1, 5]

// 表示スライスの基準は最新観測日（EI-08）。今日から遡ると、四半期系列や発表が遅れている系列で
// 1Y が空になる。取得地平（今日から遡って API を叩く深さ）とは基準日が違う点に注意 — 地平が
// 今日基準なのはリクエスト回数を決めるためで、スライスが最新観測基準なのは見せる中身を決めるため。
// カットオフは Date を使わず文字列で作る: 'YYYY-MM-DD' は辞書順が日付順と一致するので、
// 年だけ引いた '2019-02-29' のような実在しない日付でも境界として正しく働く。
export function sliceRange(
  points: EconomicIndicatorPoint[],
  years: EconomicIndicatorYears
): EconomicIndicatorPoint[] {
  if (points.length === 0) return points
  const last = points[points.length - 1].date
  const cutoff = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`
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

// 表の行（新しい順）。visible は sliceRange の結果、つまり all の末尾の連続部分なので、位置は
// 長さの差で出る。delta は all の中の 1 つ前を使うので、スライス境界の行でも空欄にならない。
export function tableRows(
  all: EconomicIndicatorPoint[],
  visible: EconomicIndicatorPoint[],
  limit = 20
): IndicatorRow[] {
  const start = Math.max(all.length - limit, all.length - visible.length)
  return all.slice(start).map((_, i) => rowAt(all, start + i)).reverse()
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
