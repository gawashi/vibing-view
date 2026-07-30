// src/renderer/lib/treasuryCurve.ts
import { MATURITIES, SPREADS } from '@shared/treasury'
import type { TreasuryCurvePoint, TreasuryMaturityKey, TreasuryYears } from '@shared/types'

// lightweight-charts の Line 系列に渡す点。value を持たない点は whitespace で、そこで線が切れる。
// 点そのものを省くと前後が直線で繋がれて欠測が無かったように見えるので、欠測日も time だけ渡す（YC-03）。
export type LinePoint = { time: string; value: number } | { time: string }

// 断面図の 1 点。index は MATURITIES の位置 = 等間隔の横軸座標（YC-07: months の対数軸にしない。
// 等間隔のほうが短期側の 5 満期の形が読め、逆イールドの起点が分かる）。
export type CurveDot = { key: TreasuryMaturityKey; label: string; index: number; value: number }

// 指定日のカーブ（完全一致）。断面はキャッシュ済みの全 points から引くので、下段の折れ線の
// スライスより古い比較日でも出せる（YC-06）。
export function curveAt(points: TreasuryCurvePoint[], date: string): TreasuryCurvePoint | null {
  return points.find((p) => p.date === date) ?? null
}

// その日以前で最も近いデータのある日（YC-06）。土日祝と、財務省が公表を飛ばした日がこれに当たる。
// 遡ってもデータが無ければ null — 呼び出し側はチップを追加しない。
// points は date 昇順なので、後ろから最初に見つかったものが最も近い。
export function snapToDate(points: TreasuryCurvePoint[], date: string): string | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].date <= date) return points[i].date
  return null
}

// 連続する非 null 満期ごとに区切った点列。区間をまたいで線を引かないので、欠測満期で線が切れる
// （0 として繋ぐと利回りが暴落したように見える、YC-03）。
export function curveSegments(curve: TreasuryCurvePoint): CurveDot[][] {
  const segments: CurveDot[][] = []
  let current: CurveDot[] = []
  MATURITIES.forEach((m, index) => {
    const value = curve.rates[m.key]
    if (value == null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push({ key: m.key, label: m.label, index, value })
  })
  if (current.length > 0) segments.push(current)
  return segments
}

// 満期 1 本の推移。
export function seriesFor(points: TreasuryCurvePoint[], key: TreasuryMaturityKey): LinePoint[] {
  return points.map((p) => {
    const v = p.rates[key]
    return v == null ? { time: p.date } : { time: p.date, value: v }
  })
}

// スプレッドの推移。片側が null の日は計算しない（null - 4.2 = -4.2 になる事故を防ぐ）。
export function spreadSeries(points: TreasuryCurvePoint[], spreadKey: string): LinePoint[] {
  const spread = SPREADS.find((s) => s.key === spreadKey)
  if (!spread) return []
  return points.map((p) => {
    const long = p.rates[spread.long]
    const short = p.rates[spread.short]
    return long == null || short == null ? { time: p.date } : { time: p.date, value: long - short }
  })
}

// ゼロライン。スプレッドを 1 つ以上選んでいる間だけ引く（利回りだけ見ているときは意味を持たない、
// YC-07）。端の 2 点だけで全幅に引ける。
export function zeroLineSeries(points: TreasuryCurvePoint[]): LinePoint[] {
  if (points.length === 0) return []
  return [{ time: points[0].date, value: 0 }, { time: points[points.length - 1].date, value: 0 }]
}

// 表示スライス。基準は最新の観測日（統計指標の sliceRange と同じ理由 — 今日から遡ると公表が
// 遅れている系列で空になる）。カットオフは Date を使わず文字列で作るので、年だけ引いた
// '2019-02-29' のような実在しない日付でも境界として正しく働く。
export function sliceRange(points: TreasuryCurvePoint[], years: TreasuryYears): TreasuryCurvePoint[] {
  if (points.length === 0) return points
  const last = points[points.length - 1].date
  const cutoff = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`
  return points.filter((p) => p.date >= cutoff)
}

// 表は行が満期。cells は比較日ごとに「その日の値」と「最新との差」の対 — 差を 1 列にまとめると、
// 比較日が 2 本以上あるときどちらとの差なのかが決まらない。
export type TableCell = { value: number | null; delta: number | null }
export type TableRow = {
  key: TreasuryMaturityKey
  label: string
  latest: number | null
  cells: TableCell[]
}

export function tableRows(
  latest: TreasuryCurvePoint | null,
  compares: TreasuryCurvePoint[]
): TableRow[] {
  return MATURITIES.map((m) => {
    const latestValue = latest?.rates[m.key] ?? null
    return {
      key: m.key,
      label: m.label,
      latest: latestValue,
      cells: compares.map((c) => {
        const value = c.rates[m.key] ?? null
        // 差は「最新 − その比較日」。片側が欠測なら計算しない。
        return { value, delta: value == null || latestValue == null ? null : latestValue - value }
      })
    }
  })
}

// 利回りは全満期が同じ単位・同じ桁数なので 2 桁固定にする。統計指標の一律 toLocaleString
// （最大 2 桁）だと 4.3 と 4.31 が桁で揃わず、10bp の差が読み取りにくい。null 満期は '—'。
export const formatRate = (v: number | null): string => (v == null ? '—' : v.toFixed(2))

// 差も同じ % ポイント・2 桁固定に符号を付ける。bp 表記に変換しない — 断面図の縦軸・ツールチップ・
// 表で単位が 2 種類になると、0.12 と 12 のどちらが何なのか都度読み替えることになる。
export const formatRateDelta = (v: number | null): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`

// 満期はカテゴリではなく順序尺度なので、短期＝寒色 → 長期＝暖色のランプにすると凡例を見なくても
// 長短が分かる。明度を固定するのでライト/ダーク両方で読める（ローソク足の up/down 色と同じ判断）。
export const maturityColor = (index: number): string => `hsl(${210 - index * 15} 70% 55%)`
