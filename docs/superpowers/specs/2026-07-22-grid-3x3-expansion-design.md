# グリッド 3x3 拡張 — 設計

## 背景 / 目的

現在のグリッドは `1x1` / `2x1` / `2x2` の3択（列挙文字列）で、ツールバーに3つの
アイコントグルボタンが横並びになっている。表示可能なグリッドを **最大 3x3（9セル）**
まで拡張したい。ただし選択肢が増えてもツールバーのボタンを横に増やしたくない。

そこで **(1) シェイプの内部表現を行×列に一般化** し、**(2) UI を「Excel/Word の表挿入」
方式のグリッドピッカー（ポップオーバー内の 3×3 ホバーグリッド）に置換** する。
トリガーは1個だけになり、1x1〜3x3 の全9通り（2x3・3x2 等の非対称含む）を選べる。

## 方針

- シェイプ表現: `GridShape = '1x1' | '2x1' | '2x2'` → `GridShape = { rows: number; cols: number }`（各 1〜3）
- UI: `@radix-ui/react-popover` を新規追加し、shadcn 流の `ui/popover.tsx` ラッパー経由で
  グリッドピッカーを実装。dropdown-menu 流用は `role="menu"` セマンティクスと 2D グリッドの
  キーボードナビが噛み合わないため不採用
- 後方互換: 旧保存データ（`"2x2"` 文字列）を `parseLayout` が `{rows,cols}` に変換して受理

## 変更詳細

### 1. 型 (`src/shared/types.ts`)

```ts
export type GridShape = { rows: number; cols: number }
```
`Layout.shape` の型はそのまま `GridShape` を参照するので追随のみ。

### 2. 共有ロジック (`src/shared/workspace.ts`)

- `VISIBLE_COUNT: Record<GridShape, number>` を廃止し、関数化：
  ```ts
  export const cellCount = (s: GridShape): number => s.rows * s.cols
  ```
- `GRID_SHAPES` 配列 / `isGridShape` 型ガードを撤去し、`parseShape` を新設：
  ```ts
  const clampDim = (n: unknown): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(3, Math.max(1, Math.trunc(n))) : 1

  export function parseShape(raw: unknown): GridShape {
    // 新形式 { rows, cols }
    if (isRecord(raw)) return { rows: clampDim(raw.rows), cols: clampDim(raw.cols) }
    // 旧形式 "RxC" は **列×行**（"2x1" = 2列1行）。現行 GridHost/GridShape 文字列は
    // grid-cols-2 grid-rows-1 = 横並びを意味しており、先頭が cols。ここを rows に入れると
    // 既存の "2x1" 保存が縦2段に化ける（Codex review P1）。第1要素=cols, 第2要素=rows で読む。
    if (typeof raw === 'string') {
      const [c, r] = raw.split('x').map((v) => parseInt(v, 10))
      return { rows: clampDim(r), cols: clampDim(c) }
    }
    return { rows: 1, cols: 1 }
  }
  ```
  旧値の対応: `"1x1"`→`{1,1}` / `"2x1"`→`{rows:1,cols:2}`（横並び維持）/ `"2x2"`→`{2,2}`。
- `parseLayout` 内の `const shape = isGridShape(raw.shape) ? raw.shape : '1x1'` を
  `const shape = parseShape(raw.shape)` に置換。
- `defaultLayout` の `shape: '1x1'` を `shape: { rows: 1, cols: 1 }` に。
- `SCHEMA_VERSION` は据え置き（parseLayout が両形式を吸収するため bump 不要）。

### 3. ストア (`src/renderer/store.ts`)

- `import { VISIBLE_COUNT }` → `import { cellCount }`。
- `setShape` 内の `const target = VISIBLE_COUNT[shape]` を `const target = cellCount(shape)` に。
  セル増殖・active セル維持ロジックはそのまま（セル数だけで駆動しており汎用）。
- 初期 `shape` は `defaultLayout` 由来なので追加変更なし。

### 4. lib (`src/renderer/lib/refreshTargets.ts`, `quoteTargets.ts`)

- `VISIBLE_COUNT[shape]` → `cellCount(shape)`。import 差し替えのみ。
- 引数 `shape: GridShape` の型注釈は変わらないが、実体がオブジェクトになる点に注意（呼び出し側は不変）。

### 5. グリッド描画 (`src/renderer/components/GridHost.tsx`)

- `GridHost` の `templateClass` 三項を廃止。
- `const { rows, cols } = shape` を取り出し、可視セルは `cells.slice(0, cellCount(shape))`。
- グリッドは Tailwind 動的クラスが効かないためインライン style：
  ```tsx
  <div
    className="grid h-full gap-4 p-4"
    style={{
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
    }}
  >
  ```
  （`minmax(0,1fr)` は既存の 2x2 で使っていた `min-h-0/min-w-0` と同趣旨のトラック縮小保証。
  セル側の `min-h-0 min-w-0` はそのまま残す。）

### 6. UI ラッパー (`src/renderer/components/ui/popover.tsx`) 新規

shadcn 標準の薄いラッパー（dropdown-menu.tsx と同じ流儀）：
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

### 7. ピッカー (`GridShapeRow.tsx` → `GridShapePicker.tsx`)

- 旧 `GridShapeRow`（ToggleGroup + 3 ボタン）を撤去し `GridShapePicker` に置換。
- 構成:
  - **トリガー**: `Grid2x2` アイコン + 現在シェイプ表示（`{cols}×{rows}` 等）を持つボタン。
  - **ポップオーバー内**: 3×3（`MAX=3`）のマス目。各マスは `PopoverClose asChild` で包んだ
    実 `<button>`（Radix の通常ボタンは自動で閉じないため `PopoverClose` 必須 — Codex review P2）。
    - ホバー中のマス `(r,c)` に対し `1..r × 1..c` の矩形をハイライト。
    - マウスが離れたら現在の選択シェイプをハイライト（`onMouseLeave` で hover 状態クリア）。
    - クリックで `setShape({ rows: r, cols: c })`、`PopoverClose` がポップオーバーを閉じる。
    - 各 `<button>` に `aria-label={`${c} columns by ${r} rows`}`。Tab/Enter で選択可能
      （キーボードでも全 9 通り到達可能）。
  - 下部に選択予定サイズのラベル（`{hoverCols || cols} × {hoverRows || rows}`）。
- ローカル state は hover 座標のみ（`useState<{r,c}|null>`）。シェイプ本体は store が真実。
- `App.tsx` の `import { GridShapeRow }` / `<GridShapeRow />` を `GridShapePicker` に差し替え。

### 8. 依存追加

`package.json` に `@radix-ui/react-popover`（`^1` 系、他 radix と同系統）。
`npm install` のみ。better-sqlite3 の再ビルドには影響しない純 JS パッケージ。

## テスト

- `tests/renderer/workspace.test.ts`
  - `parseShape`: 旧文字列は列×行で解釈 — `"2x1"` → `{rows:1,cols:2}`（横並び維持）、
    `"3x1"` → `{rows:1,cols:3}`、`"2x2"` → `{rows:2,cols:2}`。
  - `parseShape`: `{rows:5,cols:0}` → クランプ `{rows:3,cols:1}`。
  - `parseShape`: 不正（`null`/数値/未知文字列）→ `{rows:1,cols:1}`。
  - `parseLayout`: 旧 `"2x1"` shape を含む JSON が横並び（cols:2）で復元される（後方互換の向き保持）。
- `tests/renderer/store.test.ts`
  - `setShape({rows:3,cols:3})` で cells が 9 まで増える。
  - シェイプ縮小時に active セルが可視範囲外なら先頭にフォールバック。
- `tests/renderer/refreshTargets.test.ts` / `quoteTargets.test.ts`
  - shape 引数を新形式 `{rows,cols}` に更新。`cellCount` 経由の可視スライスが従来通り。
- `tests/main/workspaceStore.test.ts`
  - shape を含む往復（保存→parse）が新形式で一致することを確認（既存テストの追随修正）。

## 影響ファイル一覧

| ファイル | 変更 |
|---|---|
| `src/shared/types.ts` | `GridShape` をオブジェクト型へ |
| `src/shared/workspace.ts` | `cellCount`/`parseShape` 新設、`VISIBLE_COUNT`/`isGridShape`/`GRID_SHAPES` 撤去、`parseLayout`/`defaultLayout` 追随 |
| `src/renderer/store.ts` | `cellCount` へ差し替え |
| `src/renderer/lib/refreshTargets.ts` | `cellCount` へ差し替え |
| `src/renderer/lib/quoteTargets.ts` | `cellCount` へ差し替え |
| `src/renderer/components/GridHost.tsx` | 動的 gridTemplate、`cellCount` |
| `src/renderer/components/ui/popover.tsx` | 新規（shadcn ラッパー） |
| `src/renderer/components/GridShapePicker.tsx` | 新規（旧 GridShapeRow 置換） |
| `src/renderer/components/GridShapeRow.tsx` | 削除 |
| `src/renderer/App.tsx` | import / 使用箇所差し替え |
| `package.json` | `@radix-ui/react-popover` 追加 |
| `tests/*` | 上記4テストの追随 |

## 非対象（YAGNI）

- 3x3 超（4列以上）の対応。上限は 3。
- グリッドサイズの永続化フォーマットの schemaVersion bump（parseShape が両形式吸収で不要）。
- セルのドラッグ入替・リサイズ・個別スパン。均等 `1fr` グリッドのみ。
