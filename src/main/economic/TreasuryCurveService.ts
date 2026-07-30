import type { TreasuryCurvePoint, TreasuryCurves, TreasuryYears } from '@shared/types'
import { shiftUtcDay, utcYmdFromEpoch } from '@shared/utcDay'
// 型だけ（`import type` は消えるので sqlite は読み込まれない — core.ts と同じ扱い）。
import type { TreasuryCurveRow } from '../db/treasuryCurveStore'

// TTL は直近窓の取り直しにだけ掛かる。確定判定は持たない — 財務省の公表値は基本的に改訂されないが、
// 確定判定を入れる利益（リクエスト 0 本ぶん）が、入れる複雑さに見合わない。
const TTL_SECONDS = 43200

// 1 窓で取りにいく日数。応答が要求窓より狭ければ返却最古に追従するので、この定数が間違っていても
// 穴は空かない（YC-02）— 役割は「1 回で何日ぶん取るか」の最適化だけ。実測上限より 5 日小さく取り、
// 境界の inclusive/exclusive の取り違えを吸収する（統計指標の 85 日ステップと同じ手）。
// テストが期待窓数をこの値から計算するので export する。
export const STEP_DAYS = 85

// 行は 1 本だけ。他国の国債を足すときにここが 'us' / 'jp' に分かれる（YC-11）。
const ID = 'us'

// 空応答は「落ちた」に含める（YC-05: 統計指標は四半期系列が合法的に空窓を返すので空を異常扱い
// しないが、85 日窓に営業日が 1 日も無いことはない）。throw にして下の catch に合流させることで、
// 「部分結果を 1 バイトも書かずに stale で返す」経路を 1 本に保つ。
const EMPTY_WINDOW = new Error('TREASURY_EMPTY_WINDOW')

// 年だけ引く。'YYYY-MM-DD' は辞書順が日付順と一致するので、'2024-02-29' のような実在しない日付でも
// 境界として正しく働く（renderer の sliceRange と同じ手）。
const shiftYears = (day: string, n: number): string => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`

export function createTreasuryCurveService(deps: {
  store: {
    getCurves(id: string): TreasuryCurveRow | null
    upsertCurves(
      id: string, points: TreasuryCurvePoint[], coveredFrom: string, fetchedAt: number
    ): void
  }
  fetch: (from: string, to: string) => Promise<TreasuryCurvePoint[]>
  now?: () => number // epoch seconds — injectable for tests
}) {
  const { store, fetch } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  return {
    async getCurves(opts?: { years?: TreasuryYears; force?: boolean }): Promise<TreasuryCurves> {
      const years = opts?.years ?? 1
      const today = utcYmdFromEpoch(now())
      const wantFrom = shiftYears(today, -years)

      // force は TTL を無視するだけ（company.info と同じ）。行は捨てない: 財務省の公表値は改訂
      // されないので捨てる利益が無く、捨てると 5Y のあと 1Y で force した瞬間に 4 年ぶんが消え、
      // 次の 5Y 表示で 22 リクエストかかる（YC-05）。
      const row = store.getCurves(ID)
      const needBackfill = !row || row.coveredFrom > wantFrom
      // fetchedAt が未来なら差が負になって TTL を永久に満たさない（時計を進めて書いたあと戻した
      // 場合）。未来を「取り直す」側に倒して fetchedAt を正常な値に書き戻す。
      const needRefresh =
        !row || opts?.force === true || row.fetchedAt > now() || now() - row.fetchedAt >= TTL_SECONDS

      if (!needBackfill && !needRefresh) {
        return { points: row.points, coveredFrom: row.coveredFrom, fetchedAt: row.fetchedAt }
      }

      const merged = new Map((row?.points ?? []).map((p) => [p.date, p]))

      // [from, to] を新しい側から窓に割って取る。空応答・例外はそのまま呼び出し元へ投げ、
      // 途中結果を書かせない。
      const walk = async (from: string, to: string): Promise<void> => {
        let t = to
        while (t >= from) {
          const step = shiftUtcDay(t, -STEP_DAYS)
          const rows = await fetch(step, t)
          if (rows.length === 0) throw EMPTY_WINDOW
          for (const p of rows) merged.set(p.date, p)
          // 応答が要求窓より狭い＝API 上限が STEP_DAYS 未満。返ってきた最古の 1 日前を次の窓の
          // 終端にすれば、上限が何日でも隙間なく遡れる。この前進量の保証は「返却行が要求窓
          // [step, t] の内側にある」（provider 側でクランプ済み）という前提の上でしか成り立たない。
          // API が to を無視するなど前提が崩れて前進しない応答は取得失敗として扱う。
          // ここで止めないと while が終わらず、リクエストを撃ち続ける。
          const oldest = rows[0].date // provider が昇順に直しているので先頭が最古
          const next = oldest > step ? shiftUtcDay(oldest, -1) : step
          if (next >= t) throw EMPTY_WINDOW
          t = next
        }
      }

      try {
        // 行が無いときは下の backfill が today から遡るので、直近窓を別に取ると 1 本無駄になる。
        // 起点は min(fetched_at, now) の日（クロック後退の保護）。前回取得から STEP_DAYS 以上
        // 開いた行を 1 窓だけで更新すると、その間が誰にも取得されない穴として残る。
        if (needRefresh && row) await walk(utcYmdFromEpoch(Math.min(row.fetchedAt, now())), today)
        if (needBackfill) await walk(wantFrom, row ? row.coveredFrom : today)
      } catch (err) {
        if (!row) throw err
        // 途中で落ちたら 1 バイトも書かない。covered_from だけ進めると埋まっていない範囲を
        // 「取得済み」と記録することになり、その穴は以後どのリクエストでも埋まらない。
        return { points: row.points, coveredFrom: row.coveredFrom, fetchedAt: row.fetchedAt, stale: true }
      }

      // 直列フェッチの最中に別の getCurves（別の地平）が書き込んでいることがある。判定に使った
      // snapshot のまま書くと、狭い地平の要求が後に書いたときに相手の履歴と coveredFrom を丸ごと
      // 捨てる。書く直前に読み直して union する。取り直した値のほうが新しいので同じ date は自分を残す。
      const prior = store.getCurves(ID)
      if (prior) for (const p of prior.points) if (!merged.has(p.date)) merged.set(p.date, p)

      const points = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date))
      // 地平を狭めても記録上のカバー範囲は狭めない（5Y を取ったあと 1Y に戻して再取得しない）。
      let coveredFrom = wantFrom
      for (const c of [row?.coveredFrom, prior?.coveredFrom]) if (c && c < coveredFrom) coveredFrom = c
      const fetchedAt = now()

      store.upsertCurves(ID, points, coveredFrom, fetchedAt)
      return { points, coveredFrom, fetchedAt }
    }
  }
}
