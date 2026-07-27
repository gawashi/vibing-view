// src/renderer/lib/economicWeek.ts
import { addDays, format } from 'date-fns'
import type { EconomicCountryPreset, EconomicEvent, EconomicImpact } from '@shared/types'

// 'Major' のコードはハードコードする（EC-11）。全世界の国リスト（40 前後）はハードコードしない —
// 列挙を誤ると選べない国が生まれ、それを埋めるメンテが要る。'all' はフィルタ自体を素通しにする。
// FMP は英国を非 ISO の 'UK' で返す（EC-02 実測時の未コミット夏冬 API キャプチャ計 1089 行中 UK 46 / GB 0、コミット済み fixture にも UK 行あり）。
// 'GB' は将来 FMP が ISO 表記に変えた場合のゼロコストな保険として残す。
export const MAJOR_COUNTRIES = ['US', 'EU', 'JP', 'UK', 'GB', 'CN'] as const

export type EconomicFilterInput = {
  countries: EconomicCountryPreset
  impacts: EconomicImpact[]
  text: string
}

const utcYmd = (d: Date): string => d.toISOString().slice(0, 10)

// ローカル週（月曜起点）に必要な UTC 日。weekStart の UTC 日から 1 日戻して 9 日ぶん。
// ±1 日 広げる理由は 2 つ:（1）ローカル週の端が別の UTC 日にまたがる、（2）FMP の from/to が ET 基準
// だと要求した UTC 日の端が欠ける（EC-02）。UTC±14h までのどのローカル時差でも週全体を覆う。
// date-fns の addDays はローカル時計基準（setDate(getDate()+n)）で、DST 遷移をまたぐと
// ローカル時刻を保存したまま 23h/25h 移動するため UTC 日がずれる。ここは結果を UTC で
// フォーマットするので、代わりに epoch ミリ秒で加算する。
export function weekUtcDays(weekStart: Date): string[] {
  const first = Date.parse(`${utcYmd(weekStart)}T00:00:00Z`) - 86_400_000
  return Array.from({ length: 9 }, (_, i) => utcYmd(new Date(first + i * 86_400_000)))
}

// ローカル週に入るものだけ残す（UTC 日で余分に取った両端を落とす）。境界は半開区間。
export function eventsInWeek(events: EconomicEvent[], weekStart: Date): EconomicEvent[] {
  const start = Math.floor(weekStart.getTime() / 1000)
  const end = Math.floor(addDays(weekStart, 7).getTime() / 1000)
  return events.filter((e) => e.time >= start && e.time < end)
}

// 国プリセット・重要度・テキストの AND。テキストは国コードと指標名の両方に部分一致（EC-12）—
// 'All' + 'JP' で日本だけ、'CPI' で全世界の CPI が並ぶ。国プルダウンで表現できない絞り込みをここで吸収する。
export function applyFilter(events: EconomicEvent[], f: EconomicFilterInput): EconomicEvent[] {
  const q = f.text.trim().toLowerCase()
  return events.filter((e) => {
    if (f.countries === 'us' && e.country !== 'US') return false
    if (f.countries === 'major' && !MAJOR_COUNTRIES.includes(e.country as (typeof MAJOR_COUNTRIES)[number])) return false
    if (!f.impacts.includes(e.impact)) return false
    if (q && !e.country.toLowerCase().includes(q) && !e.event.toLowerCase().includes(q)) return false
    return true
  })
}

// ローカル日ごとに束ねる（key はローカルの 'yyyy-MM-dd'）。日と、日の中のイベントの両方を昇順に。
export function groupByLocalDay(events: EconomicEvent[]): { key: string; events: EconomicEvent[] }[] {
  const byDay = new Map<string, EconomicEvent[]>()
  for (const e of [...events].sort((a, b) => a.time - b.time)) {
    const key = format(new Date(e.time * 1000), 'yyyy-MM-dd')
    const bucket = byDay.get(key)
    if (bucket) bucket.push(e)
    else byDay.set(key, [e])
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([key, evs]) => ({ key, events: evs }))
}
