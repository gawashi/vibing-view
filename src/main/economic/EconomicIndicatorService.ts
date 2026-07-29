import type {
  EconomicIndicatorPoint, EconomicIndicatorSeries, EconomicIndicatorYears
} from '@shared/types'
import { shiftUtcDay, utcYmdFromEpoch } from '@shared/utcDay'
// 型だけ（`import type` は消えるので sqlite は読み込まれない — core.ts と同じ扱い）。
import type { EconomicIndicatorRow } from '../db/economicIndicatorStore'

// TTL は直近窓の取り直しにだけ掛かる。確定判定は持たない（EI-02）— FRED 系列は改訂される。
// ただし 90 日窓なので改訂を吸収できるのは直近窓の範囲だけで、それより古い改訂は force を押した
// ときにしか入らない。地平を絞るコストとして受け入れている。
const TTL_SECONDS = 43200

// EI-01 実測: 応答は [to - 90日, to] の閉区間。85 日ステップにして 5 日重ねるのは、境界の
// inclusive/exclusive の取り違えと月末日のずれを吸収するため。
const STEP_DAYS = 85

// 年だけ引く。'YYYY-MM-DD' は辞書順が日付順と一致するので、'2024-02-29' のような実在しない日付でも
// 境界として正しく働く（renderer の sliceRange と同じ手）。
const shiftYears = (day: string, n: number): string => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`

// [from, to] を 90 日窓で覆う `to` の列（新しい順）。最後の窓の下端は from を必ず下回る。
function windowTos(from: string, to: string): string[] {
  const list: string[] = []
  for (let t = to; t >= from; t = shiftUtcDay(t, -STEP_DAYS)) list.push(t)
  return list
}

export function createEconomicIndicatorService(deps: {
  store: {
    getIndicator(name: string): EconomicIndicatorRow | null
    upsertIndicator(
      name: string, points: EconomicIndicatorPoint[], coveredFrom: string, fetchedAt: number
    ): void
  }
  fetch: (name: string, to: string) => Promise<EconomicIndicatorPoint[]>
  now?: () => number // epoch seconds — injectable for tests
}) {
  const { store, fetch } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  return {
    async getSeries(
      name: string,
      opts?: { years?: EconomicIndicatorYears; force?: boolean }
    ): Promise<EconomicIndicatorSeries> {
      const years = opts?.years ?? 1
      const today = utcYmdFromEpoch(now())
      const wantFrom = shiftYears(today, -years)

      // row は stale フォールバック用に常に読む。cached は判定用で、force のときは無いものとして
      // 扱う（force は「行を捨てて現在の地平を取り直す」— TTL を無視するだけの company.info とは違う）。
      const row = store.getIndicator(name)
      const cached = opts?.force ? null : row

      const needBackfill = !cached || cached.coveredFrom > wantFrom
      // fetchedAt が未来なら差が負になって TTL を永久に満たさない（時計を進めて書いたあと戻した
      // 場合）。下の Math.min はフルカバー行では needRefresh が false なので到達しない。ここで
      // 未来を「取り直す」側に倒して fetchedAt を正常な値に書き戻す。
      const needRefresh = !cached || cached.fetchedAt > now() || now() - cached.fetchedAt >= TTL_SECONDS
      if (!needBackfill && !needRefresh) {
        return { name, points: cached.points, coveredFrom: cached.coveredFrom, fetchedAt: cached.fetchedAt }
      }

      // Set なので、初回（needRefresh も needBackfill も真）で今日の窓が二重に入らない。
      const tos = new Set<string>()
      if (needRefresh) {
        // 前回取得日から今日までを覆う。TTL が切れるだけなら 1 窓（today）で足りるが、90 日
        // 以上開いた行を 1 窓だけで更新すると [前回取得日+90d, 今日) が誰にも取得されない
        // 穴として残り、以後の TTL 更新でも二度と埋まらない。Math.min は now() が前回取得より
        // 前に戻る（クロックの後退）場合の保護で、無いと since が未来日付になり windowTos が
        // 空を返して今日の窓すら取り直せなくなる。
        const since = cached ? utcYmdFromEpoch(Math.min(cached.fetchedAt, now())) : today
        for (const t of windowTos(since, today)) tos.add(t)
      }
      // 遡りの起点は既存カバーの下限そのもの。その窓は [coveredFrom - 90d, coveredFrom] を覆うので、
      // 既存カバーと隙間なく繋がり、無駄な重複も出ない。
      if (needBackfill) for (const t of windowTos(wantFrom, cached ? cached.coveredFrom : today)) tos.add(t)

      // ponytail: 窓を直列に取る（5Y への拡張で最大 22 リクエスト = 十数秒）。無料プランの
      // レート制限を踏みにくい代わりに遅い。体感が問題になったら小さな並列度を入れる。
      const merged = new Map((cached?.points ?? []).map((p) => [p.date, p.value]))
      for (const to of tos) {
        try {
          for (const p of await fetch(name, to)) merged.set(p.date, p.value)
        } catch (err) {
          if (!row) throw err
          // 途中で落ちたら 1 バイトも書かない。covered_from だけ進めると、埋まっていない範囲を
          // 「取得済み」と記録することになり、その穴は以後どのリクエストでも埋まらない。
          return { name, points: row.points, coveredFrom: row.coveredFrom, fetchedAt: row.fetchedAt, stale: true }
        }
      }

      // 書き込みは date キーの union（EI-10 改訂）。フェッチ結果でまるごと置き換えないので、
      // 空応答は「何も足さない」で終わる — 一時的な空応答も、FMP の仕様変更も、name の打ち間違いも、
      // 既存履歴を壊せない。四半期系列は合法的に空窓を返すので、空を異常扱いしてはいけない。
      // 直列フェッチの最中に別の getSeries（別ウィンドウの 5Y など）が書き込んでいることがある。
      // 判定に使った snapshot のまま書くと、狭い地平の要求が後に書いたときに相手の履歴と
      // coveredFrom を丸ごと捨て、次の 5Y 表示で 22 窓を取り直すことになる。書く直前に読み直して
      // union する。取り直した値のほうが新しいので、同じ date は自分の値を残す。
      // force は「行を捨てて現在の地平を取り直す」契約なので対象外（狭まるのは意図どおり）。
      const prior = opts?.force ? null : store.getIndicator(name)
      if (prior) for (const p of prior.points) if (!merged.has(p.date)) merged.set(p.date, p.value)

      const points = [...merged]
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date))
      // 地平を狭めても記録上のカバー範囲は狭めない（5Y を取ったあと 1Y に戻しても再取得しない）。
      let coveredFrom = wantFrom
      for (const c of [cached?.coveredFrom, prior?.coveredFrom]) if (c && c < coveredFrom) coveredFrom = c
      const fetchedAt = now()

      store.upsertIndicator(name, points, coveredFrom, fetchedAt)
      return { name, points, coveredFrom, fetchedAt }
    }
  }
}
