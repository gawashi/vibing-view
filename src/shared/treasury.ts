// 満期のキー・ラベル・月数を 1 箇所に置く。zod schema のフィールド名、provider のマッピング、
// renderer の軸の並びとラベルが同じ表を見るので shared（economicIndicators.ts と同じ判断）。
import type { TreasuryMaturityKey, TreasuryYears } from './types'

export const MATURITIES: { key: TreasuryMaturityKey; label: string; months: number }[] = [
  { key: 'month1', label: '1M', months: 1 },
  { key: 'month2', label: '2M', months: 2 },
  { key: 'month3', label: '3M', months: 3 },
  { key: 'month6', label: '6M', months: 6 },
  { key: 'year1', label: '1Y', months: 12 },
  { key: 'year2', label: '2Y', months: 24 },
  { key: 'year3', label: '3Y', months: 36 },
  { key: 'year5', label: '5Y', months: 60 },
  { key: 'year7', label: '7Y', months: 84 },
  { key: 'year10', label: '10Y', months: 120 },
  { key: 'year20', label: '20Y', months: 240 },
  { key: 'year30', label: '30Y', months: 360 }
]

// 定番の 2 本だけ。10Y-2Y は最も広く見られている逆イールド指標、10Y-3M は NY Fed の
// 景気後退確率モデルが使う組み合わせ。任意の 2 満期を選ばせる UI は入れない（YC-07）。
export const SPREADS: { key: string; label: string; long: TreasuryMaturityKey; short: TreasuryMaturityKey }[] = [
  { key: '10y2y', label: '10Y-2Y', long: 'year10', short: 'year2' },
  { key: '10y3m', label: '10Y-3M', long: 'year10', short: 'month3' }
]

// 既定は先頭の 1 — 初回に開いたときのリクエストが 5 本で済むほうを選ぶ（5Y は 22 本）。
export const TREASURY_YEARS: TreasuryYears[] = [1, 5]
