import { describe, it, expect } from 'vitest'
import {
  curveAt, curveSegments, formatRate, formatRateDelta, maturityColor, seriesFor, sliceRange,
  snapToDate, spreadSeries, tableRows, zeroLineSeries
} from '@/lib/treasuryCurve'
import { MATURITIES } from '@shared/treasury'
import type { TreasuryCurvePoint, TreasuryMaturityKey } from '@shared/types'

// 12 満期を持つ 1 日。over で個別の満期を上書き（null 含む）。
const curve = (
  date: string,
  over: Partial<Record<TreasuryMaturityKey, number | null>> = {}
): TreasuryCurvePoint => ({
  date,
  rates: {
    ...(Object.fromEntries(MATURITIES.map((m, i) => [m.key, 4 + i / 10])) as Record<TreasuryMaturityKey, number | null>),
    ...over
  }
})

// 営業日 3 日ぶん（土日を飛ばした並び）。
const POINTS: TreasuryCurvePoint[] = [
  curve('2026-07-24'),
  curve('2026-07-27'),
  curve('2026-07-28', { year10: 4.5, year2: 4.7 })
]

describe('curveAt', () => {
  it('returns the curve for an exact date', () => {
    expect(curveAt(POINTS, '2026-07-27')).toBe(POINTS[1])
  })

  it('returns null when the date is not in the cache', () => {
    expect(curveAt(POINTS, '2026-07-25')).toBeNull()
    expect(curveAt([], '2026-07-27')).toBeNull()
  })
})

describe('snapToDate — 休日は前営業日に戻す（YC-06）', () => {
  it('snaps a weekend pick back to the previous business day', () => {
    // 2026-07-25/26 は土日。データが無いので 07-24 に戻る。
    expect(snapToDate(POINTS, '2026-07-26')).toBe('2026-07-24')
  })

  it('returns the date itself when it has data', () => {
    expect(snapToDate(POINTS, '2026-07-27')).toBe('2026-07-27')
  })

  it('returns null before the oldest cached day (coveredFrom より前)', () => {
    expect(snapToDate(POINTS, '2026-07-23')).toBeNull()
    expect(snapToDate([], '2026-07-27')).toBeNull()
  })

  it('snaps a future pick to the newest day', () => {
    expect(snapToDate(POINTS, '2026-12-31')).toBe('2026-07-28')
  })
})

describe('curveSegments — null 満期で線を切る（YC-03）', () => {
  it('returns one segment with all 12 dots when nothing is missing', () => {
    const segments = curveSegments(curve('2026-07-28'))
    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveLength(12)
    // index は MATURITIES の位置 = 等間隔の横軸座標（YC-07）
    expect(segments[0].map((d) => d.index)).toEqual([...Array(12).keys()])
    expect(segments[0][0]).toEqual({ key: 'month1', label: '1M', index: 0, value: 4 })
  })

  it('splits into contiguous non-null segments', () => {
    // 20Y/30Y だけ欠測（発行が止まっていた期間）→ 末尾で切れる
    const segments = curveSegments(curve('2003-02-03', { year20: null, year30: null }))
    expect(segments).toHaveLength(1)
    expect(segments[0].map((d) => d.key)).not.toContain('year20')
    expect(segments[0]).toHaveLength(10)
  })

  it('splits in the middle when a maturity in the middle is missing', () => {
    const segments = curveSegments(curve('2026-07-28', { year2: null }))
    expect(segments).toHaveLength(2)
    expect(segments[0].map((d) => d.key)).toEqual(['month1', 'month2', 'month3', 'month6', 'year1'])
    expect(segments[1][0].key).toBe('year3')
    // 区間をまたいで線を引かない = 0 として繋がない（利回りが暴落したように見える）
    expect(segments[1][0].index).toBe(6)
  })

  it('returns no segments when every maturity is missing', () => {
    const empty = Object.fromEntries(MATURITIES.map((m) => [m.key, null])) as Record<TreasuryMaturityKey, null>
    expect(curveSegments({ date: '2026-07-28', rates: empty })).toEqual([])
  })
})

describe('seriesFor — 欠測日は whitespace（YC-03）', () => {
  it('maps each day to a value point', () => {
    expect(seriesFor(POINTS, 'year10')).toEqual([
      { time: '2026-07-24', value: 4.9 },
      { time: '2026-07-27', value: 4.9 },
      { time: '2026-07-28', value: 4.5 }
    ])
  })

  it('emits a time-only point for a missing day', () => {
    // 点そのものを省くと lightweight-charts が前後の値を直線で繋ぎ、欠測が無かったように見える。
    const points = [curve('2026-07-24'), curve('2026-07-27', { year30: null }), curve('2026-07-28')]
    expect(seriesFor(points, 'year30')[1]).toEqual({ time: '2026-07-27' })
    expect(seriesFor(points, 'year30')).toHaveLength(3)
  })

  it('handles an empty series', () => {
    expect(seriesFor([], 'year10')).toEqual([])
  })
})

describe('spreadSeries — 片側が null の日は計算しない', () => {
  it('computes long - short', () => {
    expect(spreadSeries(POINTS, '10y2y').at(-1)).toEqual({ time: '2026-07-28', value: 4.5 - 4.7 })
  })

  it('emits whitespace when either leg is missing (null - 4.2 = -4.2 を防ぐ)', () => {
    const points = [curve('2026-07-27', { year2: null }), curve('2026-07-28')]
    expect(spreadSeries(points, '10y2y')[0]).toEqual({ time: '2026-07-27' })
  })

  it('returns [] for an unknown spread key', () => {
    expect(spreadSeries(POINTS, 'nope')).toEqual([])
  })
})

describe('zeroLineSeries', () => {
  it('spans the whole visible range with two points', () => {
    expect(zeroLineSeries(POINTS)).toEqual([
      { time: '2026-07-24', value: 0 },
      { time: '2026-07-28', value: 0 }
    ])
  })

  it('handles an empty series', () => {
    expect(zeroLineSeries([])).toEqual([])
  })
})

describe('sliceRange — 基準は最新の観測日', () => {
  const YEARLY: TreasuryCurvePoint[] = Array.from({ length: 11 }, (_, i) => curve(`${2016 + i}-01-02`))

  it('1Y counts back from the newest observation, not from today', () => {
    expect(sliceRange(YEARLY, 1).map((p) => p.date)).toEqual(['2025-01-02', '2026-01-02'])
  })

  it('5Y slices from the newest observation', () => {
    expect(sliceRange(YEARLY, 5).map((p) => p.date)).toEqual([
      '2021-01-02', '2022-01-02', '2023-01-02', '2024-01-02', '2025-01-02', '2026-01-02'
    ])
  })

  it('handles an empty series and a single point', () => {
    expect(sliceRange([], 1)).toEqual([])
    expect(sliceRange([POINTS[0]], 1)).toEqual([POINTS[0]])
  })

  it('does not crash on a Feb 29 newest date', () => {
    // 文字列でカットオフを作るので、'2020-02-29' の 1 年前 '2019-02-29'（実在しない日付）でも
    // 境界として正しく働く。
    const leap = [curve('2019-01-02'), curve('2019-03-01'), curve('2020-02-29')]
    expect(sliceRange(leap, 1).map((p) => p.date)).toEqual(['2019-03-01', '2020-02-29'])
  })
})

describe('tableRows — 比較日ごとに値と Δ の 2 列', () => {
  const latest = curve('2026-07-28', { year10: 4.5 })
  const older = curve('2026-06-30', { year10: 4.2, year30: null })

  it('gives one row per maturity in registry order', () => {
    const rows = tableRows(latest, [])
    expect(rows).toHaveLength(12)
    expect(rows.map((r) => r.label)).toEqual(MATURITIES.map((m) => m.label))
    expect(rows.every((r) => r.cells.length === 0)).toBe(true) // 比較日 0 本なら Latest 列だけ
  })

  it('adds a value+delta cell per comparison date', () => {
    const rows = tableRows(latest, [older])
    const row10y = rows.find((r) => r.key === 'year10')!
    expect(row10y.latest).toBe(4.5)
    // Δ は「最新 − その比較日」。1 列にまとめると比較日が 2 本以上あるときどちらとの差か決まらない。
    expect(row10y.cells).toEqual([{ value: 4.2, delta: 4.5 - 4.2 }])
  })

  it('keeps the cell order aligned with the comparison dates', () => {
    const mid = curve('2026-07-15', { year10: 4.3 })
    const row10y = tableRows(latest, [mid, older]).find((r) => r.key === 'year10')!
    expect(row10y.cells.map((c) => c.value)).toEqual([4.3, 4.2])
  })

  it('leaves value and delta null when the maturity is missing', () => {
    const row30y = tableRows(latest, [older]).find((r) => r.key === 'year30')!
    expect(row30y.cells[0]).toEqual({ value: null, delta: null })
  })

  it('leaves every latest and delta null when there is no latest curve', () => {
    const rows = tableRows(null, [older])
    expect(rows[0].latest).toBeNull()
    expect(rows[0].cells[0].delta).toBeNull()
    expect(rows[0].cells[0].value).not.toBeNull() // 比較日の値そのものは出す
  })
})

describe('formatRate / formatRateDelta', () => {
  it('pins 2 decimals so 10bp differences line up', () => {
    expect(formatRate(4.3)).toBe('4.30')
    expect(formatRate(4.312)).toBe('4.31')
    expect(formatRate(0)).toBe('0.00')
  })

  it('dashes a missing maturity', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRateDelta(null)).toBe('—')
  })

  it('signs the delta in percentage points (bp に変換しない)', () => {
    expect(formatRateDelta(0.12)).toBe('+0.12')
    expect(formatRateDelta(-0.12)).toBe('-0.12')
    expect(formatRateDelta(0)).toBe('0.00')
  })
})

describe('maturityColor', () => {
  it('ramps from cool (short) to warm (long) with fixed lightness', () => {
    // 満期は順序尺度なので、凡例を見なくても長短が分かるランプにする。明度固定で
    // ライト/ダーク両方で読める。
    expect(maturityColor(0)).toBe('hsl(210 70% 55%)')
    expect(maturityColor(11)).toBe('hsl(45 70% 55%)')
  })
})
