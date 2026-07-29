// UTC 日の 'YYYY-MM-DD'。date-fns の addDays / subDays はローカル時計基準（setDate(getDate()+n)）で、
// DST 遷移をまたぐと 23h/25h 動いて UTC 日がずれるので、日をずらす計算は epoch ミリ秒で行う。
// provider・カレンダー/指標サービス・renderer の週計算が同じ規約で日付キーを作る必要があるので shared。
export const utcYmd = (d: Date): string => d.toISOString().slice(0, 10)

export const utcYmdFromEpoch = (seconds: number): string => utcYmd(new Date(seconds * 1000))

export const shiftUtcDay = (day: string, n: number): string =>
  utcYmd(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000))
