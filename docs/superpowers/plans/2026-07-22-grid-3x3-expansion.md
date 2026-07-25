# グリッド 3x3 拡張 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** グリッドを最大 3x3（9セル）まで拡張し、シェイプ選択を「表挿入」型のグリッドピッカーに置き換える。

**Architecture:** `GridShape` を列挙文字列から `{ rows, cols }` に一般化し、可視セル数を `cellCount()` で導出、`GridHost` は動的 `gridTemplate` で描画する。UI は `@radix-ui/react-popover` によるポップオーバー内 3×3 ホバーグリッドに置換。旧保存データ（`"2x1"` 等の列×行文字列）は `parseShape` が向きを保って `{ rows, cols }` に変換する。

**Tech Stack:** TypeScript, React, Zustand, TanStack Query, Radix UI (shadcn ラッパー), Vitest, electron-vite。

## Global Constraints

- Vite は `^7` に固定（electron-vite@5 は Vite 8 を peer 宣言しない）。
- `technicalindicators` / `react-financial-charts` は使用禁止。
- SQLite = OHLCV キャッシュ / JSON = ユーザー設定（本変更は JSON 側 layout のみ）。
- 新規依存は `@radix-ui/react-popover`（他の radix と同系統、純 JS で better-sqlite3 の再ビルドに無関係）のみ。
- 旧文字列シェイプは **列×行**（`"2x1"` = 2列1行 = 横並び）。移行時に向きを反転させないこと。
- グリッド上限は 3x3。4列以上は非対象。
- Spec: `docs/superpowers/specs/2026-07-22-grid-3x3-expansion-design.md`。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/shared/types.ts` | `GridShape` をオブジェクト型に |
| `src/shared/workspace.ts` | `cellCount` / `parseShape` 新設、`parseLayout`/`defaultLayout` 追随、旧 `VISIBLE_COUNT`/`isGridShape`/`GRID_SHAPES` 撤去 |
| `src/renderer/store.ts` | `setShape` を `cellCount` 駆動に |
| `src/renderer/lib/refreshTargets.ts` | `cellCount` へ差し替え |
| `src/renderer/lib/quoteTargets.ts` | `cellCount` へ差し替え |
| `src/renderer/components/GridHost.tsx` | 動的 `gridTemplate` 描画 |
| `src/renderer/components/ui/popover.tsx` | 新規 shadcn ラッパー |
| `src/renderer/components/GridShapePicker.tsx` | 新規（旧 GridShapeRow 置換） |
| `src/renderer/components/GridShapeRow.tsx` | 削除 |
| `src/renderer/App.tsx` | import / 使用箇所差し替え |

---

## Task 1: シェイプ表現の一般化（型 + parseShape + cellCount）

型・純関数の中核。旧文字列との後方互換（向き保持）をここで確定する。

**Files:**
- Modify: `src/shared/types.ts:57`
- Modify: `src/shared/workspace.ts` (VISIBLE_COUNT / GRID_SHAPES / isGridShape / parseLayout / defaultLayout)
- Test: `tests/renderer/workspace.test.ts`

**Interfaces:**
- Produces:
  - `type GridShape = { rows: number; cols: number }`
  - `cellCount(s: GridShape): number` — `s.rows * s.cols`
  - `parseShape(raw: unknown): GridShape` — 新形式 `{rows,cols}` はクランプ、旧文字列 `"C x R"` は列×行で解釈、その他は `{rows:1,cols:1}`
- Consumes: なし

- [ ] **Step 1: 失敗するテストを書く**

`tests/renderer/workspace.test.ts` の import に `cellCount, parseShape` を追加し、末尾に追記：

```ts
import {
  defaultLayout,
  parseLayout,
  newCellSeed,
  SCHEMA_VERSION,
  emptyLayout,
  parseWorkspaceCollection,
  defaultWorkspaceCollection,
  cellCount,
  parseShape
} from '../../src/shared/workspace'
```

```ts
describe('parseShape', () => {
  it('parses new object form and clamps each dim to 1..3', () => {
    expect(parseShape({ rows: 2, cols: 3 })).toEqual({ rows: 2, cols: 3 })
    expect(parseShape({ rows: 5, cols: 0 })).toEqual({ rows: 3, cols: 1 })
    expect(parseShape({ rows: 2.9, cols: 1.2 })).toEqual({ rows: 2, cols: 1 })
  })

  it('parses legacy "col x row" strings preserving orientation', () => {
    expect(parseShape('1x1')).toEqual({ rows: 1, cols: 1 })
    expect(parseShape('2x1')).toEqual({ rows: 1, cols: 2 }) // 2 columns, 1 row = horizontal
    expect(parseShape('2x2')).toEqual({ rows: 2, cols: 2 })
  })

  it('falls back to 1x1 for unusable input', () => {
    expect(parseShape(null)).toEqual({ rows: 1, cols: 1 })
    expect(parseShape(42)).toEqual({ rows: 1, cols: 1 })
    expect(parseShape('garbage')).toEqual({ rows: 1, cols: 1 })
  })
})

describe('cellCount', () => {
  it('is rows * cols', () => {
    expect(cellCount({ rows: 1, cols: 1 })).toBe(1)
    expect(cellCount({ rows: 3, cols: 3 })).toBe(9)
    expect(cellCount({ rows: 1, cols: 2 })).toBe(2)
  })
})
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run tests/renderer/workspace.test.ts`
Expected: FAIL（`parseShape`/`cellCount` が export されていない、型エラー）

- [ ] **Step 3: 型を変更**

`src/shared/types.ts:57` を置換：

```ts
export type GridShape = { rows: number; cols: number }
```

- [ ] **Step 4: workspace.ts を変更**

`src/shared/workspace.ts` の該当箇所を編集する。

(a) 旧 `VISIBLE_COUNT` 定義（`export const VISIBLE_COUNT ...` の1行）を削除し、置換：

```ts
// 可視セル数 = rows * cols（旧 VISIBLE_COUNT マップの後継。3x3 拡張はこれで駆動）。
export const cellCount = (s: GridShape): number => s.rows * s.cols
```

(b) `const GRID_SHAPES: GridShape[] = ['1x1', '2x1', '2x2']` と `function isGridShape(...) {...}` を削除し、代わりに `parseShape` を追加（`isRecord` は同ファイルで後方定義だが JS の関数巻き上げで参照可。順序が気になる場合は `isRecord` を parseShape より前へ移動）：

```ts
const clampDim = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(3, Math.max(1, Math.trunc(n))) : 1

// GridShape の正規化。never throws。
// - 新形式 { rows, cols }: 各 1..3 にクランプ
// - 旧形式 "C x R" 文字列（"2x1" = 2列1行）: 先頭=cols, 末尾=rows で読む。現行の grid-cols-N
//   grid-rows-M 表記に合わせており、ここを逆にすると既存の "2x1" 保存が縦2段に化ける。
// - それ以外: { rows: 1, cols: 1 }
export function parseShape(raw: unknown): GridShape {
  if (isRecord(raw)) return { rows: clampDim(raw.rows), cols: clampDim(raw.cols) }
  if (typeof raw === 'string') {
    const [c, r] = raw.split('x').map((v) => parseInt(v, 10))
    return { rows: clampDim(r), cols: clampDim(c) }
  }
  return { rows: 1, cols: 1 }
}
```

(c) `parseLayout` 内の shape 行を置換：

```ts
    const shape = parseShape(raw.shape)
```

(d) `defaultLayout` の `shape: '1x1'` を置換：

```ts
  return { schemaVersion: SCHEMA_VERSION, cells: [cell], shape: { rows: 1, cols: 1 }, activeCellId: cell.id }
```

- [ ] **Step 5: 既存 workspace.test.ts の文字列シェイプを移行**

同ファイル内の旧文字列を新形式に更新（向き保持）：
- L51 `shape: '2x1'` → `shape: { rows: 1, cols: 2 }`
- `emptyLayout` テスト L72 `expect(l.shape).toBe('1x1')` → `expect(l.shape).toEqual({ rows: 1, cols: 1 })`
- L36 の partial 復元 expected `shape: '1x1'` → `shape: { rows: 1, cols: 1 }`

- [ ] **Step 6: テスト成功確認**

Run: `npx vitest run tests/renderer/workspace.test.ts`
Expected: PASS（全 describe グリーン）

- [ ] **Step 7: コミット**

```bash
git add src/shared/types.ts src/shared/workspace.ts tests/renderer/workspace.test.ts
git commit -m "feat(grid): GridShape を {rows,cols} に一般化し parseShape/cellCount を追加"
```

---

## Task 2: ストアの setShape を cellCount 駆動に

**Files:**
- Modify: `src/renderer/store.ts:4` (import), `src/renderer/store.ts:112` (setShape)
- Test: `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: `cellCount` (Task 1)
- Produces: 変更なし（`setShape(shape: GridShape)` のシグネチャは型実体のみ変わる）

- [ ] **Step 1: 既存テストの文字列シェイプを新形式へ移行し、3x3 ケースを追加**

`tests/renderer/store.test.ts` 内の全シェイプ文字列を機械的に置換する（向き保持）：

```bash
sed -i "s/'1x1'/{ rows: 1, cols: 1 }/g; s/'2x1'/{ rows: 1, cols: 2 }/g; s/'2x2'/{ rows: 2, cols: 2 }/g" tests/renderer/store.test.ts
```

置換後、`setShape({ rows: 2, cols: 2 })` 等になっていることを目視確認（`setShape('2x2')` は `setShape({ rows: 2, cols: 2 })` になる）。`as const` が付いていた箇所（`L()` ヘルパの `shape: { rows: 1, cols: 1 } as const` 等）はそのままで型的に問題ない。

続いて 3x3 の新規テストを `describe('useAppStore grid shape logic', ...)` 内、既存の expand テスト群の後に追加：

```ts
  it('expands to a full 3x3 (9 cells) with unique ids', () => {
    useAppStore.getState().setShape({ rows: 3, cols: 3 })
    const state = useAppStore.getState()
    expect(state.cells).toHaveLength(9)
    const allIds = state.cells.flatMap((c) => [c.id, ...c.indicators.map((i) => i.id)])
    expect(new Set(allIds).size).toBe(allIds.length)
  })
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: FAIL（`setShape` が `VISIBLE_COUNT[shape]` を参照しており、オブジェクトキーで `undefined` → 9セルにならない／型エラー）

- [ ] **Step 3: store.ts を変更**

`src/renderer/store.ts:4` の import を差し替え：

```ts
import { defaultLayout, newCellSeed, SCHEMA_VERSION, cellCount } from '@shared/workspace'
```

`setShape` 内（`src/renderer/store.ts:112` 付近）の `const target = VISIBLE_COUNT[shape]` を置換：

```ts
    const target = cellCount(shape)
```

- [ ] **Step 4: テスト成功確認**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/renderer/store.ts tests/renderer/store.test.ts
git commit -m "feat(grid): setShape を cellCount 駆動にし 3x3 まで拡張"
```

---

## Task 3: lib（refreshTargets / quoteTargets）を cellCount へ

**Files:**
- Modify: `src/renderer/lib/refreshTargets.ts:3,33`
- Modify: `src/renderer/lib/quoteTargets.ts:2,9`
- Test: `tests/renderer/refreshTargets.test.ts`, `tests/renderer/quoteTargets.test.ts`

**Interfaces:**
- Consumes: `cellCount` (Task 1)
- Produces: 変更なし（`refreshTargets(cells, shape, caps, watchlist)` / `quoteSymbols(cells, shape, watchlist)` のシグネチャ実体のみ変化）

- [ ] **Step 1: 両テストの文字列シェイプを新形式へ移行**

```bash
sed -i "s/'1x1'/{ rows: 1, cols: 1 }/g; s/'2x1'/{ rows: 1, cols: 2 }/g; s/'2x2'/{ rows: 2, cols: 2 }/g" tests/renderer/refreshTargets.test.ts tests/renderer/quoteTargets.test.ts
```

（`refreshTargets(cells, '1x1', undefined)` → `refreshTargets(cells, { rows: 1, cols: 1 }, undefined)` 等になる。`quoteTargets.test.ts` の `'2x1'` は横並びで 2 セル可視のまま＝結果不変。）

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run tests/renderer/refreshTargets.test.ts tests/renderer/quoteTargets.test.ts`
Expected: FAIL（`VISIBLE_COUNT[shape]` がオブジェクトキーで `undefined` → `slice(0, undefined)` で全件、または型エラー）

- [ ] **Step 3: refreshTargets.ts を変更**

`src/renderer/lib/refreshTargets.ts:3` の import を差し替え：

```ts
import { cellCount } from '@shared/workspace'
```

L33 の `cells.slice(0, VISIBLE_COUNT[shape])` を置換：

```ts
  for (const cell of cells.slice(0, cellCount(shape))) {
```

- [ ] **Step 4: quoteTargets.ts を変更**

`src/renderer/lib/quoteTargets.ts:2` の import を差し替え：

```ts
import { cellCount } from '@shared/workspace'
```

L9 の `cells.slice(0, VISIBLE_COUNT[shape])` を置換：

```ts
  for (const cell of cells.slice(0, cellCount(shape))) {
```

- [ ] **Step 5: テスト成功確認**

Run: `npx vitest run tests/renderer/refreshTargets.test.ts tests/renderer/quoteTargets.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer/lib/refreshTargets.ts src/renderer/lib/quoteTargets.ts tests/renderer/refreshTargets.test.ts tests/renderer/quoteTargets.test.ts
git commit -m "refactor(grid): refreshTargets/quoteTargets を cellCount へ"
```

---

## Task 4: 主プロセス側 workspaceStore テストの移行

Task 1 で `parseLayout` は旧文字列も受理するため実装変更は不要。主プロセスの往復テストだけ新形式に追随する。

**Files:**
- Test: `tests/main/workspaceStore.test.ts:14`

**Interfaces:**
- Consumes: Task 1 の `parseShape` 経由の後方互換（実装は既に完了）
- Produces: なし

- [ ] **Step 1: 文字列シェイプを新形式へ移行**

`tests/main/workspaceStore.test.ts:14` の `layoutL` 定義中 `shape: '1x1'` を置換：

```ts
const layoutL: Layout = { schemaVersion: 1, cells: [{ id: 'c1', symbol: 'AAPL', timeframe: '1d', indicators: [] }], shape: { rows: 1, cols: 1 }, activeCellId: 'c1' }
```

- [ ] **Step 2: テスト成功確認**

Run: `npx vitest run tests/main/workspaceStore.test.ts`
Expected: PASS

- [ ] **Step 3: フルテスト＋型チェック（回帰確認）**

Run: `npm test && npm run typecheck`
Expected: 全 PASS、型エラー 0（この時点で `src/` 側の `VISIBLE_COUNT` 参照が全滅していること＝GridHost はまだ未修正なので型エラーが残る場合は Task 5 で解消。ここでは `npm test` の PASS を必須とし、typecheck の GridHost 由来エラーは Task 6 まで許容）

- [ ] **Step 4: コミット**

```bash
git add tests/main/workspaceStore.test.ts
git commit -m "test(grid): workspaceStore テストを {rows,cols} 形式へ"
```

---

## Task 5: GridHost を動的 gridTemplate 描画に

**Files:**
- Modify: `src/renderer/components/GridHost.tsx:7` (import), `:258-276` (GridHost 関数)

**Interfaces:**
- Consumes: `cellCount` (Task 1)、`store.shape: GridShape`
- Produces: 変更なし

- [ ] **Step 1: import を差し替え**

`src/renderer/components/GridHost.tsx:7` の `import { VISIBLE_COUNT } from '@shared/workspace'` を置換：

```ts
import { cellCount } from '@shared/workspace'
```

- [ ] **Step 2: GridHost 関数本体を置換**

`export function GridHost()` の中身（`const visible = ...` から `return (...)` 末尾まで）を置換：

```tsx
export function GridHost(): React.JSX.Element {
  const cells = useAppStore((s) => s.cells)
  const shape = useAppStore((s) => s.shape)
  const activeCellId = useAppStore((s) => s.activeCellId)

  const visible = cells.slice(0, cellCount(shape))

  return (
    <div
      className="grid h-full gap-4 p-4"
      style={{
        // Tailwind の動的クラス（grid-cols-${n}）は JIT に拾われないため style 直指定。
        // minmax(0,1fr) は 2x2 で使っていた min-h-0/min-w-0 と同趣旨のトラック縮小保証。
        gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))`
      }}
    >
      {visible.map((cell) => (
        <GridCell key={cell.id} cell={cell} active={cell.id === activeCellId} />
      ))}
    </div>
  )
}
```

（`GridCell` 内の `min-h-0 min-w-0` はそのまま残す。）

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: GridHost 由来の `VISIBLE_COUNT` エラーは解消。残るのは GridShapeRow（Task 6 で置換）由来のみ。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/components/GridHost.tsx
git commit -m "feat(grid): GridHost を動的 gridTemplate で N×M 描画"
```

---

## Task 6: Popover ラッパー + GridShapePicker + 配線

依存追加・UI コンポーネント・App 配線・旧コンポーネント削除を1タスクに束ねる（UI 一式が揃って初めてレビュー可能なため）。

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/renderer/components/ui/popover.tsx`
- Create: `src/renderer/components/GridShapePicker.tsx`
- Delete: `src/renderer/components/GridShapeRow.tsx`
- Modify: `src/renderer/App.tsx:8` (import), `:155` (使用箇所)

**Interfaces:**
- Consumes: `store.shape: GridShape`, `store.setShape(shape: GridShape)`（既存）
- Produces: `GridShapePicker` コンポーネント（引数なし）

- [ ] **Step 1: 依存を追加**

Run: `npm install @radix-ui/react-popover@^1`
Expected: `package.json` の dependencies に追加され、`node_modules` に入る。better-sqlite3 の再ビルドは走らない（純 JS）。

- [ ] **Step 2: Popover ラッパーを作成**

Create `src/renderer/components/ui/popover.tsx`（`ui/dropdown-menu.tsx` と同じ shadcn 流儀）：

```tsx
import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverClose = PopoverPrimitive.Close

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-none",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverClose }
```

- [ ] **Step 3: GridShapePicker を作成**

Create `src/renderer/components/GridShapePicker.tsx`：

```tsx
import React, { useState } from 'react'
import { Grid2x2 } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'

const MAX = 3
const DIMS = [1, 2, 3] // 1..MAX

export function GridShapePicker(): React.JSX.Element {
  const shape = useAppStore((s) => s.shape)
  const setShape = useAppStore((s) => s.setShape)
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null)

  // ホバー中はホバー先、非ホバー時は現在のシェイプをハイライト＆ラベル表示。
  const preview = hover ?? shape

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Grid layout">
              <Grid2x2 className="h-4 w-4" />
              <span className="text-xs tabular-nums">{shape.cols}×{shape.rows}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Grid layout</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto" onMouseLeave={() => setHover(null)}>
        <div className="flex flex-col items-center gap-2">
          <div className="grid grid-cols-3 gap-1">
            {DIMS.flatMap((r) =>
              DIMS.map((c) => {
                const on = r <= preview.rows && c <= preview.cols
                return (
                  <PopoverClose asChild key={`${r}-${c}`}>
                    <button
                      type="button"
                      aria-label={`${c} columns by ${r} rows`}
                      onMouseEnter={() => setHover({ rows: r, cols: c })}
                      onFocus={() => setHover({ rows: r, cols: c })}
                      onClick={() => setShape({ rows: r, cols: c })}
                      className={cn(
                        'h-6 w-6 rounded-sm border transition-colors',
                        on ? 'border-primary bg-primary/30' : 'border-border bg-muted'
                      )}
                    />
                  </PopoverClose>
                )
              })
            )}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {preview.cols} × {preview.rows}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: App.tsx を配線**

`src/renderer/App.tsx:8` の import を差し替え：

```ts
import { GridShapePicker } from './components/GridShapePicker'
```

`src/renderer/App.tsx:155` の `<GridShapeRow />` を置換：

```tsx
          <GridShapePicker />
```

- [ ] **Step 5: 旧コンポーネントを削除**

```bash
git rm src/renderer/components/GridShapeRow.tsx
```

- [ ] **Step 6: 型チェック＋フルテスト**

Run: `npm run typecheck && npm test`
Expected: 型エラー 0、全テスト PASS（`VISIBLE_COUNT` / `GridShapeRow` への参照が残っていないこと）。

- [ ] **Step 7: 手動確認（Electron 起動）**

Run: `npm run dev`
確認項目:
- ツールバーのグリッドアイコン（現在サイズ表示付き）をクリック → 3×3 ポップオーバーが開く。
- マス上をホバー → 左上からの矩形がハイライト、下部ラベルが `列 × 行` を表示。
- 任意のマスをクリック → グリッドがその行×列になり、ポップオーバーが閉じる。
- 2×1（横並び）を選ぶと 2 チャートが**横**に並ぶ（縦でない＝向き回帰なし）。
- 3×3 を選ぶと 9 セルが均等に並ぶ。
- Tab キーでマスに到達でき、Enter で選択・クローズできる。

- [ ] **Step 8: コミット**

```bash
git add package.json package-lock.json src/renderer/components/ui/popover.tsx src/renderer/components/GridShapePicker.tsx src/renderer/App.tsx
git commit -m "feat(grid): グリッドピッカー（Popover内3x3）でシェイプ選択を刷新"
```

---

## 手動 QA（全タスク完了後）

- [ ] 旧レイアウト後方互換: 既存の `workspace.json`（`"2x1"` 等の文字列 shape を含むもの）を起動時に読み、横並びのまま復元されること（`parseShape` の向き保持）。手元に旧ファイルが無ければ `app.getPath('userData')` の workspace JSON を一時的に `"shape":"2x1"` に手書きして確認。
- [ ] ワークスペース切替でグリッドサイズが各ワークスペースごとに保持されること。
- [ ] 自動保存後に再起動し、選んだ 3×3 等が復元されること。

---

## Self-Review

- **Spec coverage:**
  - §1 型変更 → Task 1 Step 3 ✓
  - §2 cellCount/parseShape/parseLayout/defaultLayout → Task 1 ✓
  - §3 store setShape → Task 2 ✓
  - §4 lib 差し替え → Task 3 ✓
  - §5 GridHost 動的 template → Task 5 ✓
  - §6 popover ラッパー → Task 6 Step 2 ✓
  - §7 GridShapePicker（PopoverClose でクローズ, aria-label, キーボード） → Task 6 Step 3 ✓
  - §8 依存追加 → Task 6 Step 1 ✓
  - テスト（workspace/store/refresh/quote/workspaceStore） → Task 1/2/3/4 ✓
  - 後方互換（旧文字列の向き保持, Codex P1） → Task 1 + QA ✓
  - クローズ機構（Codex P2） → Task 6 Step 2/3 ✓
- **Placeholder scan:** TBD/TODO なし。全コードステップに実コードあり。
- **Type consistency:** `GridShape = {rows,cols}` / `cellCount` / `parseShape` / `setShape(shape: GridShape)` を全タスクで一貫使用。旧文字列→新形式の変換は列×行（`"2x1"`→`{rows:1,cols:2}`）で全テストのマッピングを統一。
