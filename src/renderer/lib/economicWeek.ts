// src/renderer/lib/economicWeek.ts
import { addDays, format } from 'date-fns'
import type { EconomicCountryPreset, EconomicEvent, EconomicImpact } from '@shared/types'

// 'Major' のコードはハードコードする（EC-11）。全世界の国リスト（40 前後）はハードコードしない —
// 列挙を誤ると選べない国が生まれ、それを埋めるメンテが要る。'all' はフィルタ自体を素通しにする。
// 英国は FMP が返す実測どおり 'UK'（非 ISO）。
export const MAJOR_COUNTRIES = ['US', 'EU', 'JP', 'UK', 'CN'] as const

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

// ローカル週の [start, end) を epoch 秒で。addDays はここでは正しい — weekStart はローカル月曜
// 00:00 で、週の終わりも「次のローカル月曜 00:00」だから、DST をまたぐ週は 167h/169h になるのが
// 正しい（固定 168h ではない）。weekUtcDays の epoch ms 演算とは逆で、こちらはローカル境界。
function weekRange(weekStart: Date): { start: number; end: number } {
  return {
    start: Math.floor(weekStart.getTime() / 1000),
    end: Math.floor(addDays(weekStart, 7).getTime() / 1000)
  }
}

// ローカル週に入るものだけ残す（UTC 日で余分に取った両端を落とす）。境界は半開区間。
export function eventsInWeek(events: EconomicEvent[], weekStart: Date): EconomicEvent[] {
  const { start, end } = weekRange(weekStart)
  return events.filter((e) => e.time >= start && e.time < end)
}

// 「今」の境界を引く位置。groups は日昇順・日内も時刻昇順なので、平坦に見れば時系列順 —
// よって線 1 本の上下がリスト全体で過去/未来に一致する（行の見た目は一切変えない）。
// key が null なら末尾（週内の全イベントが終了）。今週を見ていないときは null を返す —
// 線が上端か下端に張り付くだけで情報にならないため。
export function nowMarker(
  groups: { key: string; events: EconomicEvent[] }[],
  nowSec: number,
  weekStart: Date
): { key: string | null; index: number } | null {
  const { start, end } = weekRange(weekStart)
  if (!groups.length || nowSec < start || nowSec >= end) return null
  for (const g of groups) {
    // 開始時刻ちょうどのイベントはまだ「過去」ではない（線はその手前）。
    const index = g.events.findIndex((e) => e.time >= nowSec)
    if (index >= 0) return { key: g.key, index }
  }
  return { key: null, index: 0 }
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
