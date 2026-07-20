# 出来高チャート リファクタ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 出来高ヒストグラムの軸目盛りを K/M/B 短縮表記にし、価格ペインと出来高ペインの境目を見やすくする。

**Architecture:** インジケータの histogram 出力に任意の `priceFormat` フォーマッタを持たせ、`Chart.tsx` が series 生成時に lightweight-charts の custom `priceFormat` へ渡す。凡例は既存の `formatReadout` をそのまま使い軸のみ短縮。ペイン境界は `separatorColor` の色変更のみ。

**Tech Stack:** TypeScript / React / lightweight-charts 5.2 / Vitest

## Global Constraints

- 凡例（`formatReadout`）はフル桁 `12,450,200` のまま変更しない。軸のみ短縮する。
- MACD ヒストグラムは `priceFormat` を宣言しないため従来通りの表示を維持する。
- 新規依存の追加禁止（既存の lightweight-charts の custom priceFormat を使う）。

---

### Task 1: 出来高軸の K/M/B 短縮表記

**Files:**
- Modify: `src/renderer/indicators/types.ts:18-21`（histogram `OutputMeta` に任意フィールド追加）
- Modify: `src/renderer/indicators/volume.ts`（abbreviate 定義・エクスポート、出力に宣言）
- Modify: `src/renderer/components/Chart.tsx:297`（histogram 生成時に priceFormat を渡す）
- Test: `tests/indicators/volume.test.ts`（abbreviate の assert 追加）

**Interfaces:**
- Produces: `export function abbreviate(v: number): string`（volume.ts）— 1234→"1.23K", 12450200→"12.45M", 3.4e9→"3.40B", 950→"950"
- Produces: histogram `OutputMeta` に任意 `priceFormat?: (v: number) => string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/indicators/volume.test.ts` の import に `abbreviate` を追加し、末尾に describe を追加:

```ts
import { volume, abbreviate } from '../../src/renderer/indicators/volume'
```

```ts
describe('abbreviate (volume axis formatter)', () => {
  it('formats thousands as K with 2 decimals', () => {
    expect(abbreviate(1234)).toBe('1.23K')
  })
  it('formats millions as M with 2 decimals', () => {
    expect(abbreviate(12450200)).toBe('12.45M')
  })
  it('formats billions as B with 2 decimals', () => {
    expect(abbreviate(3.4e9)).toBe('3.40B')
  })
  it('leaves values below 1000 as an integer', () => {
    expect(abbreviate(950)).toBe('950')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/indicators/volume.test.ts`
Expected: FAIL — `abbreviate` が volume.ts からエクスポートされておらず import エラー。

- [ ] **Step 3: types.ts の histogram OutputMeta に priceFormat を追加**

`src/renderer/indicators/types.ts` の `OutputMeta`:

```ts
export type OutputMeta =
  | { key: string; kind: 'line' }
  | { key: string; kind: 'band'; between: [string, string] }
  | { key: string; kind: 'histogram'; priceFormat?: (v: number) => string }
```

- [ ] **Step 4: volume.ts に abbreviate を実装し出力へ宣言**

`src/renderer/indicators/volume.ts` を以下に置き換え:

```ts
import type { HistPoint, IndicatorModule } from './types'

// UI-SPEC: 出来高の軸目盛りは桁数を抑えて K/M/B 短縮（小数2桁）。1000未満は整数のまま。
export function abbreviate(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'K'
  return String(Math.round(v))
}

export const volume: IndicatorModule = {
  type: 'volume',
  label: () => 'Volume',
  pane: 'separate',
  defaults: {},
  params: [],
  // 軸ティック/クロスヘア価格ラベルのみ短縮（priceFormat）。凡例はフル桁のまま（formatReadout）。
  outputs: [{ key: 'volume', kind: 'histogram', priceFormat: abbreviate }],
  // UI-SPEC L153: raw volume, thousands-separated, no decimals (e.g. 12,450,200). Guards missing value.
  formatReadout: (v) => (typeof v.volume === 'number' ? Math.round(v.volume).toLocaleString('en-US') : ''),
  compute(bars): Record<string, HistPoint[]> {
    const volume: HistPoint[] = bars.map((b) => ({
      time: b.time,
      value: b.volume,
      color: b.close >= b.open ? '#22C55E' : '#EF4444' // D-43: matches candle upColor/downColor exactly
    }))
    return { volume }
  }
}
```

- [ ] **Step 5: Chart.tsx で histogram 生成時に priceFormat を渡す**

`src/renderer/components/Chart.tsx` の 296-298 行、histogram の `else` 分岐:

```ts
          } else {
            // Custom axis formatter (e.g. Volume K/M/B) when the output declares one; minMove:1
            // keeps the crosshair price label integer-precise. MACD omits priceFormat → default.
            const histOpts = output.priceFormat
              ? { base: 0, priceFormat: { type: 'custom' as const, minMove: 1, formatter: output.priceFormat } }
              : { base: 0 }
            series.push(chartRef.current.addSeries(HistogramSeries, histOpts, paneIndex))
          }
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run tests/indicators/volume.test.ts`
Expected: PASS（既存の volume テスト + abbreviate 4件すべて green）。

- [ ] **Step 7: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 8: コミット**

```bash
git add src/renderer/indicators/types.ts src/renderer/indicators/volume.ts src/renderer/components/Chart.tsx tests/indicators/volume.test.ts
git commit -m "feat(chart): abbreviate volume axis ticks as K/M/B"
```

---

### Task 2: 価格/出来高ペインの境目を明るくする

**Files:**
- Modify: `src/renderer/components/Chart.tsx:83`（`separatorColor` の色変更）

**Interfaces:**
- Consumes: なし
- Produces: なし（視覚的変更のみ）

- [ ] **Step 1: separatorColor を明るい色に変更**

`src/renderer/components/Chart.tsx:83` の panes 設定:

```ts
        // D-32/RESEARCH Q6: pane separator — グリッド色(#151920)だと境目が見えないため、
        // グリッドとテキスト色の中間(#2A2F3A)にしてペイン境界をはっきり見せる。
        panes: { separatorColor: '#2A2F3A', separatorHoverColor: 'rgba(139, 146, 160, 0.2)' }
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add src/renderer/components/Chart.tsx
git commit -m "style(chart): brighten pane separator so price/volume boundary is visible"
```

---

## 手動確認（両タスク完了後）

Run: `npm run dev`（または既存の起動コマンド）
Expected:
- 出来高ペインの右軸が `12.45M` のように短縮表示される。
- クロスヘアの凡例（レジェンド）の出来高はフル桁 `12,450,200` のまま。
- 価格ペインと出来高ペインの境界線がはっきり見える。
