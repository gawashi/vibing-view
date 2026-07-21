# Initial Visible Range Per Timeframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** チャートを開く（symbol/timeframe 切り替え）際、`fitContent()` で全バーを表示する代わりに timeframe ごとに決めた直近 N 本だけを初期表示する。

**Architecture:** 範囲計算の純粋関数と本数マップを `src/renderer/lib/initialRange.ts` に切り出し（node 環境の vitest で単体テスト可能）、`Chart.tsx` のビューリセット箇所からそれを呼ぶ。lightweight-charts への依存はテスト対象外。

**Tech Stack:** TypeScript, React, lightweight-charts, vitest

## Global Constraints

- 変更は 2 ファイルのみ: `src/renderer/lib/initialRange.ts`（新規）と `src/renderer/components/Chart.tsx`（1 箇所）。
- gap-fetch / crosshair / indicator 系ロジックには一切触れない。
- テストは `tests/**/*.test.ts`（node 環境）、`vitest run` で実行。

---

### Task 1: 初期表示範囲の純粋関数とテスト

**Files:**
- Create: `src/renderer/lib/initialRange.ts`
- Create: `tests/initialRange.test.ts`
- Modify: `src/renderer/components/Chart.tsx`

**Interfaces:**
- Produces:
  - `INITIAL_BARS: Record<Timeframe, number>`
  - `initialLogicalRange(timeframe: Timeframe, len: number): { from: number; to: number } | null`
    — `len > N` のとき直近 N 本のロジカル範囲、それ以外は `null`（呼び出し側は `fitContent()` にフォールバック）。

- [ ] **Step 1: Write the failing test**

`tests/initialRange.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { INITIAL_BARS, initialLogicalRange } from '../src/renderer/lib/initialRange'

describe('initialLogicalRange', () => {
  it('returns the last N bars when there are more than N', () => {
    // 1d は 120 本。500 本あれば直近 120 本(index 380..499)。
    expect(initialLogicalRange('1d', 500)).toEqual({ from: 380, to: 499 })
  })

  it('returns null when bars are fewer than or equal to N (fall back to fitContent)', () => {
    expect(initialLogicalRange('1d', 120)).toBeNull()
    expect(initialLogicalRange('1d', 50)).toBeNull()
    expect(initialLogicalRange('1d', 0)).toBeNull()
  })

  it('covers every timeframe with a positive bar count', () => {
    const tfs = ['1m', '5m', '15m', '1h', '1d', '1w', '1M'] as const
    for (const tf of tfs) expect(INITIAL_BARS[tf]).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/initialRange.test.ts`
Expected: FAIL — `Cannot find module '../src/renderer/lib/initialRange'`

- [ ] **Step 3: Write minimal implementation**

`src/renderer/lib/initialRange.ts`:

```ts
import type { Timeframe } from '@shared/types'

// timeframe ごとの初期表示本数。fitContent(全表示)の代わりに直近 N 本を出す。
export const INITIAL_BARS: Record<Timeframe, number> = {
  '1m': 120,
  '5m': 120,
  '15m': 120,
  '1h': 150,
  '1d': 120,
  '1w': 104,
  '1M': 60
}

// 直近 N 本のロジカル範囲を返す。本数不足(len<=N)なら null → 呼び出し側は fitContent。
export function initialLogicalRange(
  timeframe: Timeframe,
  len: number
): { from: number; to: number } | null {
  const n = INITIAL_BARS[timeframe]
  if (len <= n) return null
  return { from: len - n, to: len - 1 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/initialRange.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire it into Chart.tsx**

`src/renderer/components/Chart.tsx` の import 群に追加（`@shared/types` import の近く）:

```ts
import { initialLogicalRange } from '@/lib/initialRange'
```

現状の「初回のみビューをリセット」ブロック（`fitContent()` を呼んでいる箇所）:

```ts
    const key = `${symbol}:${timeframe}`
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key
      chartRef.current?.timeScale().fitContent()
    }
```

を次に置換:

```ts
    const key = `${symbol}:${timeframe}`
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key
      const range = initialLogicalRange(timeframe, bars.length)
      if (range) chartRef.current?.timeScale().setVisibleLogicalRange(range)
      else chartRef.current?.timeScale().fitContent() // 本数不足時は全表示
    }
```

- [ ] **Step 6: Typecheck / build sanity**

Run: `npm run build`（または既存の typecheck スクリプト）
Expected: 型エラーなし。`initialLogicalRange` の import が解決される。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/initialRange.ts tests/initialRange.test.ts src/renderer/components/Chart.tsx
git commit -m "feat(chart): initial visible range per timeframe"
```

---

## Self-Review

- **Spec coverage:** 本数マップ（決定済みの値）・本数ベース表示・本数不足フォールバック・gap-fetch 非干渉（`lastKeyRef` 変更なし = ビューリセット走らない、既存ロジック未変更）すべて Task 1 でカバー。
- **Placeholder scan:** なし。全コード実体あり。
- **Type consistency:** `INITIAL_BARS` / `initialLogicalRange` の名前・シグネチャは spec とテストと Chart.tsx 呼び出しで一致。戻り値 `{from,to}|null` は `setVisibleLogicalRange` の引数型と一致。
