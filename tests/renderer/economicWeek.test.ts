// tests/renderer/economicWeek.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  MAJOR_COUNTRIES, applyFilter, eventsInWeek, groupByLocalDay, nowMarker, weekUtcDays
} from '../../src/renderer/lib/economicWeek'
import type { EconomicEvent, EconomicImpact } from '@shared/types'

const fx = (name: string): { country: string }[] => JSON.parse(readFileSync(join(__dirname, '../fixtures', name), 'utf8'))

const ev = (over: Partial<EconomicEvent> = {}): EconomicEvent => ({
  time: Date.parse('2026-07-28T12:30:00Z') / 1000,
  country: 'US', currency: 'USD', event: 'CPI MoM', impact: 'High',
  previous: null, estimate: null, actual: null,
  ...over
})

describe('weekUtcDays', () => {
  // ローカル週 → 必要 UTC 日。週 ±1 日ぶん広げるので常に 9 日、連続、昇順。
  it('returns 9 consecutive ascending UTC days', () => {
    const days = weekUtcDays(new Date('2026-07-27T00:00:00Z'))
    expect(days).toEqual([
      '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
      '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03'
    ])
  })

  it('starts one UTC day before the weekStart instant', () => {
    // UTC+9 のローカル月曜 00:00 は日曜 15:00Z。その 1 日前 = 土曜から始まる。
    expect(weekUtcDays(new Date('2026-07-26T15:00:00Z'))[0]).toBe('2026-07-25')
  })

  it('crosses a month boundary without gaps', () => {
    const days = weekUtcDays(new Date('2026-08-31T00:00:00Z'))
    expect(days).toHaveLength(9)
    expect(days[0]).toBe('2026-08-30')
    expect(days[8]).toBe('2026-09-07')
  })

  // DST 境界回帰ケース: date-fns の addDays はローカル時計基準なので、DST 遷移をまたぐと
  // 1 日分ずれる（ローカル時刻を保存したまま 23h/25h 移動するため）。epoch ms 演算ならずれない。
  it('stays 9 consecutive ascending days across a DST transition (regression)', () => {
    const days = weekUtcDays(new Date('2026-03-08T00:00:00Z'))
    expect(days).toEqual([
      '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11',
      '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15'
    ])
  })
})

describe('eventsInWeek', () => {
  // 時差で週の端に来るイベント: 境界は [weekStart, weekStart + 7 日) の半開区間。
  const weekStart = new Date('2026-07-27T00:00:00Z')
  const start = weekStart.getTime() / 1000
  const end = start + 7 * 86400

  it('includes the first instant and excludes the one before it', () => {
    const kept = eventsInWeek([ev({ time: start - 1, event: 'before' }), ev({ time: start, event: 'first' })], weekStart)
    expect(kept.map((e) => e.event)).toEqual(['first'])
  })

  it('includes the last instant and excludes the week end itself', () => {
    const kept = eventsInWeek([ev({ time: end - 1, event: 'last' }), ev({ time: end, event: 'next week' })], weekStart)
    expect(kept.map((e) => e.event)).toEqual(['last'])
  })

  it('drops the extra UTC days fetched on both ends', () => {
    const kept = eventsInWeek([
      ev({ time: start - 86400, event: 'day before' }),
      ev({ time: start + 3 * 86400, event: 'midweek' }),
      ev({ time: end + 86400, event: 'day after' })
    ], weekStart)
    expect(kept.map((e) => e.event)).toEqual(['midweek'])
  })
})

describe('applyFilter — country presets (EC-11)', () => {
  const events = [
    ev({ country: 'US', event: 'US CPI' }),
    ev({ country: 'JP', event: 'JP CPI' }),
    ev({ country: 'BR', event: 'BR CPI' })
  ]
  const all: EconomicImpact[] = ['High', 'Medium', 'Low']

  it("'us' keeps only US", () => {
    expect(applyFilter(events, { countries: 'us', impacts: all, text: '' }).map((e) => e.country)).toEqual(['US'])
  })

  it("'major' keeps the hardcoded majors", () => {
    expect(applyFilter(events, { countries: 'major', impacts: all, text: '' }).map((e) => e.country)).toEqual(['US', 'JP'])
    expect(MAJOR_COUNTRIES).toEqual(['US', 'EU', 'JP', 'UK', 'CN'])
  })

  it("'all' keeps everything, including countries not in MAJOR_COUNTRIES", () => {
    expect(applyFilter(events, { countries: 'all', impacts: all, text: '' })).toHaveLength(3)
  })

  // MAJOR_COUNTRIES を観測データに縛る回帰テスト（FMP は 'GB' でなく 'UK' を返す）。
  it("'major' matches every US/EU/UK row actually seen in the two live captures", () => {
    const observed = [...fx('fmp-economic-calendar.json'), ...fx('fmp-economic-calendar-winter.json')]
    const expectedMajors = observed.filter((e) => ['US', 'EU', 'UK'].includes(e.country))
    expect(expectedMajors.length).toBeGreaterThan(0)
    const kept = applyFilter(expectedMajors as EconomicEvent[], { countries: 'major', impacts: all, text: '' })
    expect(kept).toHaveLength(expectedMajors.length)
  })
})

describe('applyFilter — impact', () => {
  const events = (['High', 'Medium', 'Low'] as const).map((impact) => ev({ impact, event: impact }))

  it('keeps only the selected impacts', () => {
    expect(applyFilter(events, { countries: 'all', impacts: ['High', 'Medium'], text: '' }).map((e) => e.event))
      .toEqual(['High', 'Medium'])
  })

  it('keeps nothing when every toggle is off', () => {
    expect(applyFilter(events, { countries: 'all', impacts: [], text: '' })).toEqual([])
  })
})

describe('applyFilter — text (EC-12)', () => {
  const events = [
    ev({ country: 'US', event: 'CPI MoM' }),
    ev({ country: 'JP', event: 'Unemployment Rate' }),
    ev({ country: 'UK', event: 'CPI YoY' })
  ]
  const all: EconomicImpact[] = ['High', 'Medium', 'Low']

  it('matches the event name, case-insensitively', () => {
    expect(applyFilter(events, { countries: 'all', impacts: all, text: 'cpi' }).map((e) => e.country)).toEqual(['US', 'UK'])
  })

  it('matches the country code too, so All + JP narrows to Japan', () => {
    expect(applyFilter(events, { countries: 'all', impacts: all, text: 'jp' }).map((e) => e.event)).toEqual(['Unemployment Rate'])
  })

  it('combines with the country preset (AND, not OR)', () => {
    expect(applyFilter(events, { countries: 'us', impacts: all, text: 'cpi' }).map((e) => e.country)).toEqual(['US'])
  })
})

describe('groupByLocalDay', () => {
  // ローカル日でのグループ化なので TZ に依らない不変条件で検証する。
  const base = Date.parse('2026-07-28T12:00:00Z') / 1000

  it('groups events 30 minutes apart together', () => {
    const groups = groupByLocalDay([ev({ time: base }), ev({ time: base + 1800 })])
    expect(groups).toHaveLength(1)
    expect(groups[0].events).toHaveLength(2)
  })

  it('splits events 48 hours apart', () => {
    expect(groupByLocalDay([ev({ time: base }), ev({ time: base + 2 * 86400 })])).toHaveLength(2)
  })

  it('preserves every event, ascending, with one local day per group', () => {
    const times = [base + 3 * 86400, base, base + 86400 + 60, base + 86400, base + 3 * 86400 + 30]
    const groups = groupByLocalDay(times.map((time) => ev({ time })))
    expect(groups.flatMap((g) => g.events).map((e) => e.time)).toEqual([...times].sort((a, b) => a - b))
    expect(groups.map((g) => g.key)).toEqual([...groups.map((g) => g.key)].sort())
    for (const g of groups) {
      expect(new Set(g.events.map((e) => new Date(e.time * 1000).toDateString())).size).toBe(1)
    }
  })

  it('returns an empty array for no events', () => {
    expect(groupByLocalDay([])).toEqual([])
  })
})

describe('nowMarker', () => {
  const weekStart = new Date('2026-07-27T00:00:00Z')
  const start = weekStart.getTime() / 1000
  const end = start + 7 * 86400
  // 火・水・木に 1 件ずつ。groupByLocalDay を通すのでキーは実際のローカル日になる（TZ 非依存）。
  const times = [start + 86400, start + 2 * 86400, start + 3 * 86400]
  const groups = groupByLocalDay(times.map((time) => ev({ time })))

  // マーカー位置を「時系列順に平坦化した配列の何番目の手前か」に直す。
  const flatIndex = (m: { key: string | null; index: number }): number =>
    m.key === null
      ? groups.flatMap((g) => g.events).length
      : groups.slice(0, groups.findIndex((g) => g.key === m.key)).reduce((n, g) => n + g.events.length, 0) + m.index

  it('returns null when the viewed week is not the current one', () => {
    expect(nowMarker(groups, start - 1, weekStart)).toBeNull()   // 未来の週を見ている
    expect(nowMarker(groups, end, weekStart)).toBeNull()         // 過去の週を見ている
  })

  it('returns null when there is nothing to divide', () => {
    expect(nowMarker([], times[1], weekStart)).toBeNull()
  })

  // 線 1 本で全体の過去/未来が言い切れることが唯一の要件。境界の位置をこの不変条件で押さえる。
  it('splits the chronological list exactly at now', () => {
    for (const nowSec of [start, times[0] - 1, times[0], times[0] + 1, times[1], times[2] + 1, end - 1]) {
      const m = nowMarker(groups, nowSec, weekStart)
      expect(m).not.toBeNull()
      const flat = groups.flatMap((g) => g.events)
      const at = flatIndex(m!)
      expect(flat.slice(0, at).map((e) => e.time < nowSec)).not.toContain(false)
      expect(flat.slice(at).map((e) => e.time >= nowSec)).not.toContain(false)
    }
  })

  it('puts the line above everything when the whole week is still ahead', () => {
    expect(nowMarker(groups, start, weekStart)).toEqual({ key: groups[0].key, index: 0 })
  })

  it('puts the line at the end once every event in the week is over', () => {
    expect(nowMarker(groups, times[2] + 1, weekStart)).toEqual({ key: null, index: 0 })
  })

  // 発表時刻ちょうどは「まだ過去ではない」— 線はその行の手前に来る。
  it('treats an event starting exactly now as upcoming', () => {
    expect(flatIndex(nowMarker(groups, times[1], weekStart)!)).toBe(1)
  })

  it('can land mid-day, not just between days', () => {
    const sameDay = groupByLocalDay([ev({ time: times[0] }), ev({ time: times[0] + 3600 })])
    expect(nowMarker(sameDay, times[0] + 60, weekStart)).toEqual({ key: sameDay[0].key, index: 1 })
    expect(sameDay).toHaveLength(1)
  })
})
