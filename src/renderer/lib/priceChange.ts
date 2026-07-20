import type { Bar, Timeframe } from '@shared/types'

export type ChangeResult = { price: number; pct: number | null }

const DAY_SECONDS = 86400
const utcDay = (time: number): number => Math.floor(time / DAY_SECONDS)
const INTRADAY: ReadonlySet<Timeframe> = new Set<Timeframe>(['1m', '5m', '15m', '1h'])

// 現在値 = 最新バー終値。騰落率の基準(prev)は timeframe で切替:
//  - D/W/M: 前のバー(bars[-2])の終値
//  - intraday(1m/5m/15m/1h): 前日終値 = 日足キャッシュ基準
//    (公式終値=日足closeに合わせるため。日足が無ければ pct=null)
// ponytail: intraday の「今日」判定は UTC 日区切り。米株通常セッションは同一UTC日で安全。
// FMPがafter-hoursを含むなら NY日付ベースへ差し替え(§実装ノート)。
export function computeChange(
  bars: Bar[] | undefined,
  timeframe: Timeframe,
  daily: Bar[] | undefined
): ChangeResult | null {
  if (!bars || bars.length === 0) return null
  const price = bars[bars.length - 1].close

  let prev: number | undefined
  if (INTRADAY.has(timeframe)) {
    if (daily && daily.length > 0) {
      const todayDay = utcDay(bars[bars.length - 1].time)
      const lastDaily = daily[daily.length - 1]
      prev = utcDay(lastDaily.time) === todayDay
        ? daily[daily.length - 2]?.close
        : lastDaily.close
    }
  } else {
    prev = bars[bars.length - 2]?.close
  }

  const pct = prev !== undefined && prev !== 0 ? ((price - prev) / prev) * 100 : null
  return { price, pct }
}
