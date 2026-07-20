# Per-Cell Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 各グリッドセルに「銘柄＋現在値＋騰落率」ラベルを常時表示し、セルのチャートを削除して空セルに戻すボタンを追加する。

**Architecture:** ロジックは2層に分ける。(1) 純関数の騰落率計算 `computeChange()` を新規モジュールに切り出し、node 環境の Vitest で単体テストする。(2) React 配線（`SymbolLabel` サブコンポーネント、削除ボタン）と Zustand の `clearCell` アクションを追加。React 部分は jsdom 未導入のため単体テストせず、`clearCell` はストアテストで、`computeChange` は純関数テストで担保する。現在値・騰落率のデータは既存の react-query キャッシュ（`qk.ohlcv`）を subscribe-only で読み、追加フェッチは intraday の日足のみ。

**Tech Stack:** TypeScript, React 19, Zustand (subscribeWithSelector), TanStack Query v5, lightweight-charts, lucide-react, Vitest 3 (node env).

## Global Constraints

- テスト環境は `vitest.config.ts` の `environment: 'node'`（DOM なし）。React コンポーネントの単体テストは不可 — 純関数とストアのみテスト対象。
- 既存の store アクションは `set((state) => ({ cells: state.cells.map(...) }))` の不変更新パターン。新規アクションもこれに合わせる。
- 銘柄ラベルの現在値・騰落率は `qk.ohlcv(symbol, tf)` のキャッシュから読む。`enabled: false` = subscribe-only（フェッチしない）が原則。例外は intraday セルの日足クエリのみ `enabled: true, staleTime: Infinity`。
- ids は `String(nextId++)` の module-level counter。`clearCell` は id を新規発行しない（既存セルの中身を空にするだけ）。
- 型: `Cell.symbol` は `string | null`。`null` が空セル。`Bar.time` は UTC epoch 秒、`Bar.close` は number。
- react-query key: `qk.ohlcv(symbol, tf) = ['ohlcv', symbol, tf]`。
- lucide アイコン import、`Button`（`./ui/button`）を使う既存パターンに合わせる。

---

## File Structure

- `src/renderer/lib/priceChange.ts` — **新規**。純関数 `computeChange()`（現在値・前値・騰落率の算出）。
- `tests/renderer/priceChange.test.ts` — **新規**。`computeChange()` の単体テスト。
- `src/renderer/store.ts` — **変更**。`clearCell` アクション（型定義＋実装）。
- `tests/renderer/store.test.ts` — **変更**。`clearCell` のテストを追記。
- `src/renderer/components/GridHost.tsx` — **変更**。`SymbolLabel` サブコンポーネント追加、セルツールバーに配置。削除ボタン（X）追加。
- `src/renderer/App.tsx` — **変更**。ヘッダーの銘柄表示と `activeSymbol` セレクタを削除。

---

## Task 1: 騰落率の純関数 `computeChange`

**Files:**
- Create: `src/renderer/lib/priceChange.ts`
- Test: `tests/renderer/priceChange.test.ts`

**Interfaces:**
- Consumes: `Bar` from `@shared/types`（`{ time: number; close: number; ... }`）、`Timeframe` from `@shared/types`。
- Produces:
  ```ts
  export type ChangeResult = { price: number; pct: number | null }
  export function computeChange(
    bars: Bar[] | undefined,
    timeframe: Timeframe,
    daily: Bar[] | undefined
  ): ChangeResult | null
  ```
  - `bars` が空/undefined → `null`（ラベルは銘柄名のみ表示）。
  - `price` = `bars.at(-1).close`。
  - `pct` = `(price - prev) / prev * 100`、`prev` が取れなければ `null`。
  - `prev` の決め方:
    - D/W/M (`1d`/`1w`/`1M`) → `bars.at(-2)?.close`。
    - intraday (`1m`/`5m`/`15m`/`1h`) → 日足 `daily` を使う。`todayDay = floor(bars.at(-1).time / 86400)`。`daily.at(-1)` の UTC 日が `todayDay` と一致 → `daily.at(-2)?.close`、不一致 → `daily.at(-1)?.close`。`daily` が空/短い場合は `prev` 取れず `pct = null`。

- [ ] **Step 1: Write the failing test**

`tests/renderer/priceChange.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeChange } from '../../src/renderer/lib/priceChange'
import type { Bar } from '../../src/shared/types'

const DAY = 86400
// helper: bar at UTC day d (seconds), given close
const bar = (day: number, close: number, secOfDay = 0): Bar => ({
  time: day * DAY + secOfDay, open: close, high: close, low: close, close, volume: 0
})

describe('computeChange', () => {
  it('returns null when bars are empty or undefined', () => {
    expect(computeChange([], '1d', undefined)).toBeNull()
    expect(computeChange(undefined, '1d', undefined)).toBeNull()
  })

  it('daily: pct is vs previous bar close', () => {
    const bars = [bar(10, 100), bar(11, 110)]
    const r = computeChange(bars, '1d', undefined)
    expect(r).toEqual({ price: 110, pct: 10 })
  })

  it('weekly/monthly: pct is vs previous bar close', () => {
    expect(computeChange([bar(0, 200), bar(7, 190)], '1w', undefined)?.pct).toBeCloseTo(-5)
    expect(computeChange([bar(0, 50), bar(31, 55)], '1M', undefined)?.pct).toBeCloseTo(10)
  })

  it('daily: single bar has no previous → pct null, price still set', () => {
    expect(computeChange([bar(10, 100)], '1d', undefined)).toEqual({ price: 100, pct: null })
  })

  it('intraday: uses daily previous close when today already in daily cache', () => {
    // intraday latest bar on day 12; daily has day 12 (today, partial) → prev = daily day 11
    const intraday = [bar(12, 205, 100), bar(12, 210, 200)]
    const daily = [bar(10, 190), bar(11, 200), bar(12, 208)]
    const r = computeChange(intraday, '5m', daily)
    expect(r?.price).toBe(210)
    expect(r?.pct).toBeCloseTo(5) // (210-200)/200*100
  })

  it('intraday: uses latest daily close when today not yet in daily cache', () => {
    // intraday latest bar on day 12; daily latest is day 11 → prev = daily day 11
    const intraday = [bar(12, 210, 200)]
    const daily = [bar(10, 190), bar(11, 200)]
    expect(computeChange(intraday, '1h', daily)?.pct).toBeCloseTo(5)
  })

  it('intraday: no daily cache → pct null', () => {
    expect(computeChange([bar(12, 210)], '1m', undefined)).toEqual({ price: 210, pct: null })
    expect(computeChange([bar(12, 210)], '1m', [])).toEqual({ price: 210, pct: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/priceChange.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/renderer/lib/priceChange"` / `computeChange is not a function`.

- [ ] **Step 3: Write minimal implementation**

`src/renderer/lib/priceChange.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/priceChange.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/priceChange.ts tests/renderer/priceChange.test.ts
git commit -m "feat(chart): computeChange helper for per-cell price/change %"
```

---

## Task 2: `clearCell` ストアアクション

**Files:**
- Modify: `src/renderer/store.ts` (type block near `AppState` line ~39; action impl near `setCellTimeframe` line ~108)
- Test: `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: `AppState.cells: Cell[]`, `AppState.crosshairByCell: Record<string, CrosshairValues>`.
- Produces:
  ```ts
  clearCell: (cellId: string) => void
  ```
  対象セルの `symbol → null`、`indicators → []`。`crosshairByCell` から `cellId` エントリを削除。`activeCellId` は変更しない。

- [ ] **Step 1: Write the failing test**

`tests/renderer/store.test.ts` の `describe('useAppStore grid shape logic', ...)` 内、末尾（`describe('watchlist' ...)` の直前）に追記:
```ts
  describe('clearCell', () => {
    it('empties a cell: symbol null, indicators cleared, crosshair entry removed', () => {
      useAppStore.getState().setActiveSymbol('AAPL')
      useAppStore.getState().addIndicator('ma')
      const id = useAppStore.getState().activeCellId
      useAppStore.getState().setCrosshair(id, { price: { open: 1, high: 1, low: 1, close: 1 } })

      useAppStore.getState().clearCell(id)

      const cell = useAppStore.getState().cells.find((c) => c.id === id)!
      expect(cell.symbol).toBeNull()
      expect(cell.indicators).toEqual([])
      expect(useAppStore.getState().crosshairByCell[id]).toBeUndefined()
      // active cell unchanged
      expect(useAppStore.getState().activeCellId).toBe(id)
    })

    it('only clears the target cell, leaving others intact', () => {
      useAppStore.getState().setShape('2x2')
      const [c0, c1] = useAppStore.getState().cells
      useAppStore.getState().clearCell(c0.id)
      const after = useAppStore.getState().cells
      expect(after.find((c) => c.id === c0.id)!.symbol).toBeNull()
      expect(after.find((c) => c.id === c1.id)!.symbol).toBe(c1.symbol)
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: FAIL — `clearCell is not a function`.

- [ ] **Step 3: Add the type to `AppState`**

`src/renderer/store.ts` の `setCellTimeframe: (cellId: string, tf: Timeframe) => void` の直後に追加:
```ts
  // チャート削除: 対象セルを空(symbol=null, indicators=[])に戻し、そのセルの crosshair も破棄。
  clearCell: (cellId: string) => void
```

- [ ] **Step 4: Implement the action**

`src/renderer/store.ts` の `setCellTimeframe` アクション実装（`})),` で終わる箇所、line ~110）の直後に追加:
```ts
  clearCell: (cellId) => set((state) => {
    const { [cellId]: _removed, ...crosshairByCell } = state.crosshairByCell
    return {
      cells: state.cells.map((c) =>
        c.id === cellId ? { ...c, symbol: null, indicators: [] } : c
      ),
      crosshairByCell
    }
  }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: PASS (既存テスト＋新規 clearCell 2件)。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store.ts tests/renderer/store.test.ts
git commit -m "feat(store): clearCell action to empty a grid cell"
```

---

## Task 3: `SymbolLabel` と削除ボタンをセルツールバーに追加

**Files:**
- Modify: `src/renderer/components/GridHost.tsx`

**Interfaces:**
- Consumes: `computeChange` from `@/lib/priceChange`（Task 1）、`clearCell` from store（Task 2）、`useQuery`/`qk`/`api`（既存 import 済み）、`Bar` from `@shared/types`。
- Produces: なし（内部コンポーネント）。

- [ ] **Step 1: import を追加**

`src/renderer/components/GridHost.tsx` の import 群に追加:
```ts
import { X } from 'lucide-react'
import { Button } from './ui/button'
import { computeChange } from '@/lib/priceChange'
import { cn } from '@/lib/utils'  // 既にある場合は重複させない
```
（`cn` は既に import 済み。`Bar` 型は `import type { Bar, Cell, Timeframe } from '@shared/types'` に `Bar` を追加。）

- [ ] **Step 2: `SymbolLabel` コンポーネントを追加**

`GridCell` 関数の直前に追加:
```tsx
// 各セルの銘柄＋現在値＋騰落率。データは Chart / gating フックが埋めた ohlcv キャッシュを
// subscribe-only(enabled:false)で読むだけ(追加フェッチ無し)。intraday の前日終値は日足が要るため、
// intraday セルのみ日足を1回実フェッチ(1銘柄1リクエスト・永続キャッシュ、週足/月足にも再利用)。
function SymbolLabel({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }): React.JSX.Element {
  const isIntraday = timeframe === '1m' || timeframe === '5m' || timeframe === '15m' || timeframe === '1h'
  const barsQ = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol, timeframe),
    queryFn: () => api.ohlcv.get(symbol, timeframe, undefined),
    enabled: false // subscribe-only: Chart/gating が同キーを埋める
  })
  const dailyQ = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol, '1d'),
    queryFn: () => api.ohlcv.get(symbol, '1d', undefined),
    enabled: isIntraday, // intraday のみ前日終値のため実フェッチ
    staleTime: Infinity
  })
  const change = computeChange(barsQ.data, timeframe, dailyQ.data)

  return (
    <div className="flex items-baseline gap-2">
      <span className="text-lg font-semibold">{symbol}</span>
      {change && (
        <>
          <span className="text-sm text-muted-foreground">{change.price.toFixed(2)}</span>
          {change.pct !== null && (
            <span className={cn('text-sm', change.pct >= 0 ? 'text-green-500' : 'text-red-500')}>
              {change.pct >= 0 ? '+' : ''}{change.pct.toFixed(2)}%
            </span>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: セルのツールバー行に配置**

`GridCell` の JSX、ツールバー行（`<div className="flex items-center gap-4">` ... `<AddIndicatorMenu cellId={cell.id} />` を含む div）を次に置換:
```tsx
            <div className="flex items-center gap-4">
              <SymbolLabel symbol={cell.symbol} timeframe={cell.timeframe} />
              <TimeframeRow
                value={cell.timeframe}
                onChange={(tf) => setCellTimeframe(cell.id, tf)}
              />
              <AddIndicatorMenu cellId={cell.id} />
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label={`Remove ${cell.symbol} chart`}
                onClick={(e) => { e.stopPropagation(); clearCell(cell.id) }}
              >
                <X className="size-4" />
              </Button>
            </div>
```
（`cell.symbol` はこの分岐では non-null。`SymbolLabel` の `symbol` prop に `cell.symbol` を渡す — 三項の truthy 側なので型は `string`。）

- [ ] **Step 4: `clearCell` を `GridCell` で購読**

`GridCell` 関数先頭の hooks に追加（`setCellTimeframe` の隣）:
```tsx
  const clearCell = useAppStore((s) => s.clearCell)
```

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし。

（補足: `tsconfig` 名は `ls tsconfig*.json` で確認。renderer を含むものを使う。）

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/GridHost.tsx
git commit -m "feat(chart): per-cell symbol/price/change label and clear button"
```

---

## Task 4: ヘッダーの銘柄表示を削除

**Files:**
- Modify: `src/renderer/App.tsx` (line 17 セレクタ, line 109 span)

**Interfaces:**
- Consumes: なし。
- Produces: なし。

- [ ] **Step 1: `activeSymbol` セレクタを削除**

`src/renderer/App.tsx:17` の行を削除:
```ts
  const activeSymbol = useAppStore((s) => s.cells.find((c) => c.id === s.activeCellId)?.symbol ?? null)
```

- [ ] **Step 2: ヘッダーの銘柄 span を削除**

`src/renderer/App.tsx:109` の行を削除:
```tsx
          <span className="text-2xl font-semibold">{activeSymbol ?? '—'}</span>
```

- [ ] **Step 3: `useAppStore` の未使用 import を確認**

`App.tsx` 内で `useAppStore` が他で使われていなければ import を削除。使われていれば残す。
Run: `grep -n "useAppStore" src/renderer/App.tsx`
- ヒットが import 行のみ → import 行を削除。
- 他でもヒット → そのまま。

- [ ] **Step 4: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし（`activeSymbol` 未使用エラーが消え、参照エラーも無い）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "refactor(header): drop global active-symbol label (now per-cell)"
```

---

## Task 5: 手動動作確認（実データ）

**Files:** なし（実行のみ）。

- [ ] **Step 1: アプリ起動**

Run: `npm run dev`（electron-vite dev）。

- [ ] **Step 2: 銘柄ラベル確認**
- 2x2 に切替、各セルに別銘柄を検索 → 各セルのツールバー左に `銘柄 現在値 騰落率%` が表示され、どのチャートが何の銘柄か一目で分かる。
- intraday（例 5m）に切替 → 騰落率が前日終値基準で出る。日足に切替 → 前バー基準に変わる。
- プラスは緑、マイナスは赤。

- [ ] **Step 3: 削除ボタン確認**
- あるセルの X ボタンをクリック → そのセルが "Search a symbol to begin." の空セルに戻る。指標も消える。他セルは無傷。アクティブリングの位置は変わらない。
- 空セルをクリック→検索で別銘柄を入れ直せる。

- [ ] **Step 4: after-hours UTC 日跨ぎの確認（§実装ノート）**
- intraday（1m か 5m）で、取得済みバーに前日 20:00 ET 以降（翌 01:00 UTC）のバーが含まれるか確認（DevTools で react-query キャッシュ、または最新バーの time を目視）。
- 含まれず通常セッションのみなら現状の UTC 日区切りで正しい。含まれる場合は Task 1 の `utcDay` を NY 日付ベース（`date-fns-tz` の `toZonedTime` で `America/New_York` に変換してから日付を取る）に差し替え、Task 1 のテストを NY 基準ケースで補強してから再コミット。

- [ ] **Step 5: 永続化の確認**
- 削除・銘柄変更後にアプリ再起動 → 空セル/銘柄が復元される（既存の layout 自動保存が `cells` を保存するため追加作業不要。念のため確認）。

---

## Self-Review Notes

- **Spec coverage:** A（ラベル: 現在値=Task1+3、騰落率D/W/M・intraday=Task1、色分け=Task3、ヘッダー削除=Task4）、B（clearCell=Task2、削除ボタン=Task3、指標/クロスヘアも消す=Task2）すべてタスクに対応。日足実フェッチ挙動=Task3 Step2、UTC日区切りエッジ=Task5 Step4。
- **Placeholders:** なし（全コードブロックは実コード、テストは具体値）。
- **Type consistency:** `computeChange(bars, timeframe, daily): ChangeResult | null`（Task1）を Task3 が同シグネチャで使用。`clearCell(cellId: string): void`（Task2 型定義）を Task3 が同名で購読。`ChangeResult = { price: number; pct: number | null }` を Task3 が `change.price`/`change.pct` で参照 — 一致。
