# ワークスペース編集モーダル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ワークスペースの並べ替え・rename・delete・複製を 1 枚のモーダルに集約し、ヘッダーのドロップダウンは切替専用に単純化する。

**Architecture:** ドロップダウン (`WorkspaceSwitcher`) を「クリックで切替 + New/Edit を開くだけ」に減量。管理は新規 `WorkspaceEditDialog` に集約し、並べ替えは Watchlist と同じネイティブ HTML5 DnD（grip のみ `draggable`、行は drop ターゲット、D-66）で行う。DnD のドロップ表示インデックスを `reorderWorkspaces` の splice インデックス契約へ変換する純粋関数を `@shared/workspace` に置く。store は `duplicateWorkspace` にコピー元指定を足す小改修のみ。name 入力ダイアログは共有コンポーネント `WorkspaceNameDialog` に切り出して両者で使う。

**Tech Stack:** TypeScript + React 19, zustand, Radix Dialog/DropdownMenu, lucide-react, Tailwind, Vitest。DnD はネイティブ HTML5（新規依存なし）。

## Global Constraints

- Vite は `^7` に固定（変更しない）。
- 新規 npm 依存を追加しない（DnD はネイティブ）。CLAUDE.md 準拠。
- SQLite = OHLCV キャッシュ / JSON = ユーザー設定。本機能は JSON 側（ワークスペース設定）のみ触る。DataSourceAdapter / TanStack Query / SQLite 層には一切触れない。
- store のミューテーションは純粋（IPC を持たない・単体テスト可能）に保つ。永続化と他ウィンドウ同期は既存の購読 (`useWorkspaceSync`) 任せ。
- 検証コマンド: `npm test`（vitest）、`npm run typecheck`（tsc web+node）、`npm run build`（electron-vite build）。コンポーネントの単体テスト基盤は無い（@testing-library 未導入）ので、UI タスクは typecheck+build+手動確認で検証する。

---

### Task 1: store `duplicateWorkspace` にコピー元指定を追加

現状 `duplicateWorkspace(name)` はコピー元がアクティブ固定。編集モーダルは非アクティブ行も複製する必要があるため、コピー元を選べるよう拡張する。`sourceName` 省略時は従来どおりアクティブを複製して新コピーへ切替（`WorkspaceSwitcher` の「Duplicate current」互換）。`sourceName` 指定時はそのワークスペースを複製し、**アクティブは変えない**。

**Files:**
- Modify: `src/renderer/store.ts` — 型宣言 `duplicateWorkspace`（74 行目付近）と実装（321-331 行目付近）
- Test: `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: 既存ヘルパー `snapshotActive()`, `remintLayout(layout)`, `activate(workspaces, name)`（すべて `store.ts` 内クロージャ）
- Produces: `duplicateWorkspace: (newName: string, sourceName?: string) => WatchlistActionResult`

- [ ] **Step 1: Write the failing test**

`tests/renderer/store.test.ts` の末尾（最後の `})` の直前）に追記:

```typescript
describe('duplicateWorkspace(newName, sourceName)', () => {
  it('duplicates a non-active workspace without changing the active one', () => {
    const store = useAppStore.getState()
    // 出発点を既知の状態に: アクティブ "Workspace 1" に加えてもう1つ作る
    store.createWorkspace('Source WS')          // これがアクティブになる
    useAppStore.getState().addToWatchlist({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' })
    useAppStore.getState().switchWorkspace('Workspace 1') // アクティブを別へ戻す

    const res = useAppStore.getState().duplicateWorkspace('Copy WS', 'Source WS')
    expect(res).toEqual({ ok: true })

    const s = useAppStore.getState()
    expect(s.activeWorkspace).toBe('Workspace 1')          // アクティブは変わらない
    const copy = s.workspaces.find((w) => w.name === 'Copy WS')!
    expect(copy).toBeDefined()
    expect(copy.items.map((i) => i.symbol)).toEqual(['AAPL']) // items がコピーされている
    // layout の cell/indicator id はコピー元と重複しない（remint 済み）
    const source = s.workspaces.find((w) => w.name === 'Source WS')!
    const srcIds = source.layout.cells.map((c) => c.id)
    for (const c of copy.layout.cells) expect(srcIds).not.toContain(c.id)
  })

  it('with no sourceName, duplicates the active workspace and switches to the copy (legacy)', () => {
    useAppStore.getState().switchWorkspace('Workspace 1')
    const res = useAppStore.getState().duplicateWorkspace('Legacy Copy')
    expect(res).toEqual({ ok: true })
    expect(useAppStore.getState().activeWorkspace).toBe('Legacy Copy')
  })

  it('rejects an unknown sourceName', () => {
    const res = useAppStore.getState().duplicateWorkspace('X', 'No Such WS')
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- store.test.ts`
Expected: FAIL（`duplicateWorkspace` が 2 引数を受けず、非アクティブ複製やアクティブ不変を満たさない）

- [ ] **Step 3: Update the type declaration**

`src/renderer/store.ts` の `AppState` 内、現在の行:

```typescript
  duplicateWorkspace: (name: string) => WatchlistActionResult
```

を次に変更:

```typescript
  duplicateWorkspace: (newName: string, sourceName?: string) => WatchlistActionResult
```

- [ ] **Step 4: Rewrite the implementation**

`src/renderer/store.ts` の現在の実装:

```typescript
  duplicateWorkspace: (name) => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (get().workspaces.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A workspace named "${trimmed}" already exists.` }
    }
    const layout = remintLayout(get().currentLayout())
    const items = selectActiveItems(get()).map((i) => ({ ...i }))
    activate([...snapshotActive(), { name: trimmed, items, layout }], trimmed)
    return { ok: true }
  },
```

を次に置き換え:

```typescript
  duplicateWorkspace: (newName, sourceName) => {
    const trimmed = newName.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (get().workspaces.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A workspace named "${trimmed}" already exists.` }
    }
    // snapshotActive() でアクティブのホットなグリッドを取り込んでから layout を読む。
    // これでコピー元がアクティブ自身でも編集中の内容を取りこぼさない。
    const snapshot = snapshotActive()
    const source = sourceName ?? get().activeWorkspace
    const src = snapshot.find((w) => w.name === source)
    if (!src) return { ok: false, error: `Workspace "${source}" not found.` }
    const layout = remintLayout(src.layout)
    const items = src.items.map((i) => ({ ...i }))
    const next = [...snapshot, { name: trimmed, items, layout }]
    // sourceName 省略 = 従来「現在の複製」: コピーへ切替。指定時 = 管理操作: アクティブ据え置き。
    if (sourceName === undefined) activate(next, trimmed)
    else set({ workspaces: next })
    return { ok: true }
  },
```

（`selectActiveItems` がこの action で未使用になっても、他所で export 利用されているため import は残す。）

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- store.test.ts`
Expected: PASS（新規 3 ケース含む）。続けて `npm run typecheck` が PASS すること。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store.ts tests/renderer/store.test.ts
git commit -m "feat(store): duplicateWorkspace can copy a non-active workspace by name"
```

---

### Task 2: DnD ドロップインデックス変換の純粋関数

Watchlist 流の「行にドロップ = その前に挿入」「末尾ゾーン = 末尾へ」という表示インデックスを、`reorderWorkspaces(from, to)` が期待する「削除後配列の splice インデックス」へ変換する純粋関数を追加する。`from === to` になるケースは `reorderWorkspaces` 側が no-op として弾くので、この関数はクランプと詰めだけを担う。

**Files:**
- Modify: `src/shared/workspace.ts`（末尾に関数を追加）
- Test: `tests/renderer/workspace.test.ts`

**Interfaces:**
- Produces: `reorderTargetIndex(from: number, dropIndex: number, length: number): number`
  - `dropIndex` は「その行の前に挿入」を表す表示インデックス。末尾ドロップゾーンは `length` を渡す。
  - 戻り値は `reorderWorkspaces` の第2引数 `to`。

- [ ] **Step 1: Write the failing test**

`tests/renderer/workspace.test.ts` の末尾に追記（先頭の import に `reorderTargetIndex` を足す）:

```typescript
import { reorderTargetIndex } from '../../src/shared/workspace'

describe('reorderTargetIndex (DnD drop index -> reorderWorkspaces `to`)', () => {
  it('shifts down by one when moving an item further down (from < drop)', () => {
    // [0,1,2,3] から index0 を row2 の前へ → 削除後は index1 に挿入
    expect(reorderTargetIndex(0, 2, 4)).toBe(1)
  })

  it('keeps the drop index when moving up (from > drop)', () => {
    // [0,1,2,3] から index3 を row1 の前へ → 削除後も index1
    expect(reorderTargetIndex(3, 1, 4)).toBe(1)
  })

  it('is a no-op position when dropping just below itself (drop === from+? -> equals from)', () => {
    // index1 を row2 の前へ = 自分の直後 = 動かない
    expect(reorderTargetIndex(1, 2, 4)).toBe(1)
  })

  it('clamps the end drop zone (dropIndex === length) to the last slot', () => {
    // index0 を末尾ゾーンへ → 削除後配列(長さ3)の末尾 index2
    expect(reorderTargetIndex(0, 4, 4)).toBe(2)
  })

  it('end drop zone on the already-last item resolves to itself (no-op)', () => {
    expect(reorderTargetIndex(3, 4, 4)).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- workspace.test.ts`
Expected: FAIL with "reorderTargetIndex is not a function"（または import エラー）

- [ ] **Step 3: Add the implementation**

`src/shared/workspace.ts` の末尾に追記:

```typescript
// DnD のドロップ表示インデックスを reorderWorkspaces(from, to) の `to`（削除後配列の splice
// インデックス）へ変換する。dropIndex は「その行の前に挿入」の意味。末尾ドロップゾーンは length を
// 渡す＝最後尾スロットへクランプ。from を抜いた後は from より下の座標が1つ詰まるので from<d のとき d-1。
// 戻り値が from と一致する場合の no-op 判定は reorderWorkspaces 側が担う。
export function reorderTargetIndex(from: number, dropIndex: number, length: number): number {
  const d = Math.min(dropIndex, length - 1)
  return from < d ? d - 1 : d
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- workspace.test.ts`
Expected: PASS（新規 5 ケース）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/workspace.ts tests/renderer/workspace.test.ts
git commit -m "feat(workspace): add reorderTargetIndex for DnD reordering"
```

---

### Task 3: name 入力ダイアログを共有コンポーネントに切り出す

現在 `WorkspaceSwitcher` の中にある name ダイアログ（create/rename/duplicate 兼用、バリデーション・エラー表示込み）を、`WorkspaceSwitcher`（New）と `WorkspaceEditDialog`（rename/duplicate/new）の双方から使えるよう独立コンポーネントへ抽出する。挙動は現状維持のリファクタリング。

**Files:**
- Create: `src/renderer/components/WorkspaceNameDialog.tsx`
- Modify: `src/renderer/components/WorkspaceSwitcher.tsx`（name ダイアログ部分を差し替え）

**Interfaces:**
- Produces:
  ```typescript
  export type NameDialogMode = 'create' | 'rename' | 'duplicate'
  export type WorkspaceNameDialogProps = {
    mode: NameDialogMode
    initialValue: string
    target: string          // rename/duplicate の対象ワークスペース名（create では '' ）
    onClose: () => void      // 成功またはキャンセルで呼ぶ
  }
  export function WorkspaceNameDialog(props: WorkspaceNameDialogProps): React.JSX.Element
  ```
- Consumes: store の `createWorkspace(name)`, `duplicateWorkspace(newName, sourceName?)`, `renameWorkspace(from, to)`

- [ ] **Step 1: Create the shared dialog component**

`src/renderer/components/WorkspaceNameDialog.tsx` を新規作成:

```tsx
import React, { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { useAppStore } from '../store'

export type NameDialogMode = 'create' | 'rename' | 'duplicate'

export type WorkspaceNameDialogProps = {
  mode: NameDialogMode
  initialValue: string
  target: string
  onClose: () => void
}

// ワークスペース名を入力する共用ダイアログ。create=新規 / duplicate=target の複製 / rename=target の改名。
// 成功で onClose、失敗はインラインでエラー表示（ダイアログは開いたまま）。
export function WorkspaceNameDialog({ mode, initialValue, target, onClose }: WorkspaceNameDialogProps): React.JSX.Element {
  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const duplicateWorkspace = useAppStore((s) => s.duplicateWorkspace)
  const renameWorkspace = useAppStore((s) => s.renameWorkspace)

  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  const title = mode === 'rename' ? 'Rename workspace' : mode === 'duplicate' ? 'Duplicate workspace' : 'New workspace'
  const cta = mode === 'rename' ? 'Rename' : mode === 'duplicate' ? 'Duplicate' : 'Create'

  const confirm = (): void => {
    const result =
      mode === 'create'
        ? createWorkspace(value)
        : mode === 'duplicate'
          ? duplicateWorkspace(value, target)
          : renameWorkspace(target, value)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="workspace-name">Name</label>
          <Input
            id="workspace-name"
            value={value}
            placeholder="e.g. Morning watch"
            autoFocus
            onChange={(e) => { setValue(e.target.value); setError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim().length > 0) {
                e.preventDefault()
                confirm()
              }
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={value.trim().length === 0}>{cta}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

> 注: `mode === 'duplicate'` は `duplicateWorkspace(value, target)` を呼ぶ。`WorkspaceSwitcher` の「Duplicate current」は target にアクティブ名を渡すので従来どおりコピーへ切替される（Task 1 の sourceName 指定パスだが、アクティブ自身指定なので体感差なし。切替はしない挙動になる点だけ後述の Task 5 で吸収）。

- [ ] **Step 2: Refactor WorkspaceSwitcher to use it (New/Duplicate/Rename)**

`src/renderer/components/WorkspaceSwitcher.tsx` の name ダイアログ関連を差し替える。まず import を追加:

```tsx
import { WorkspaceNameDialog, type NameDialogMode } from './WorkspaceNameDialog'
```

`NameDialogState` 型と `confirmNameDialog`/`dialogTitle` を削除し、state をこう変える:

```tsx
  const [nameDialog, setNameDialog] = useState<{ mode: NameDialogMode; value: string; target: string } | null>(null)
```

ファイル末尾の `<Dialog open={nameDialog !== null} ...> ... </Dialog>` ブロック全体を次に置き換え:

```tsx
      {nameDialog && (
        <WorkspaceNameDialog
          mode={nameDialog.mode}
          initialValue={nameDialog.value}
          target={nameDialog.target}
          onClose={() => setNameDialog(null)}
        />
      )}
```

`setNameDialog({ ..., error: null, ... })` を呼んでいた箇所（rename ボタン、New workspace、Duplicate current）から `error: null` を除去する（`error` はダイアログ内部 state へ移動したため）。

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck`
Expected: PASS（未使用 import・型不一致なし）

Run: `npm run build`
Expected: 成功（レンダラがバンドルされる）

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`
確認: ヘッダーのワークスペースメニューから「New workspace…」「Duplicate current…」、各行の rename が従来どおり動く（作成・複製・改名・重複名エラー表示）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/WorkspaceNameDialog.tsx src/renderer/components/WorkspaceSwitcher.tsx
git commit -m "refactor(workspace): extract WorkspaceNameDialog shared component"
```

---

### Task 4: `WorkspaceEditDialog` を新規作成

並べ替え（DnD）・rename・duplicate・delete・新規を 1 枚で完結させる管理モーダル。行クリックでの切替はしない。DnD は grip のみ `draggable`、行は drop ターゲット、末尾ゾーンあり。rename/duplicate/new は `WorkspaceNameDialog`、delete はモーダル内蔵の確認ダイアログ。

**Files:**
- Create: `src/renderer/components/WorkspaceEditDialog.tsx`

**Interfaces:**
- Produces:
  ```typescript
  export type WorkspaceEditDialogProps = { open: boolean; onOpenChange: (open: boolean) => void }
  export function WorkspaceEditDialog(props: WorkspaceEditDialogProps): React.JSX.Element
  ```
- Consumes: store `workspaces`, `activeWorkspace`, `reorderWorkspaces(from, to)`, `deleteWorkspace(name)`; `reorderTargetIndex` (@shared/workspace); `WorkspaceNameDialog`。

- [ ] **Step 1: Create the component**

`src/renderer/components/WorkspaceEditDialog.tsx` を新規作成:

```tsx
import React, { useState } from 'react'
import { Copy, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { useAppStore } from '../store'
import { reorderTargetIndex } from '@shared/workspace'
import { WorkspaceNameDialog, type NameDialogMode } from './WorkspaceNameDialog'
import { cn } from '../lib/utils'

export type WorkspaceEditDialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

// ワークスペース管理を1枚で完結させるモーダル。並べ替え(DnD)/rename/duplicate/delete/新規。
// 切替はしない（誤操作防止。切替はヘッダーのドロップダウン担当）。
export function WorkspaceEditDialog({ open, onOpenChange }: WorkspaceEditDialogProps): React.JSX.Element {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const reorderWorkspaces = useAppStore((s) => s.reorderWorkspaces)
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)

  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [nameDialog, setNameDialog] = useState<{ mode: NameDialogMode; value: string; target: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // 表示ドロップ位置 dropIndex（末尾ゾーンは length）で並べ替え。最新の workspaces に対して変換する。
  const handleDrop = (from: number, dropIndex: number): void => {
    const to = reorderTargetIndex(from, dropIndex, useAppStore.getState().workspaces.length)
    reorderWorkspaces(from, to) // from===to は store 側で no-op
    setOverIndex(null)
  }

  const readFrom = (e: React.DragEvent): number | null => {
    const raw = e.dataTransfer.getData('text/plain')
    if (raw === '') return null // 空 dataTransfer を弾く（Number('')===0 の誤爆防止）
    const n = Number(raw)
    return Number.isNaN(n) ? null : n
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Edit workspaces</DialogTitle>
          </DialogHeader>

          <ul className="mt-4 max-h-[60vh] overflow-y-auto">
            {workspaces.map((w, i) => (
              <li
                key={w.name}
                onDragOver={(e) => { e.preventDefault(); setOverIndex(i) }}
                onDrop={(e) => { e.preventDefault(); const from = readFrom(e); if (from !== null) handleDrop(from, i) }}
                className={cn(
                  'group flex items-center gap-1 border-t-2 border-transparent px-2 py-2',
                  w.name === activeWorkspace && 'bg-accent text-accent-foreground rounded-sm',
                  overIndex === i && 'border-primary'
                )}
              >
                <span
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)) }}
                  onDragEnd={() => setOverIndex(null)}
                  aria-label={`Reorder ${w.name}`}
                  className="shrink-0 cursor-grab text-muted-foreground"
                >
                  <GripVertical className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate" title={w.name}>{w.name}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button" aria-label="Rename" className="rounded p-1 hover:bg-muted"
                    onClick={() => setNameDialog({ mode: 'rename', value: w.name, target: w.name })}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button" aria-label="Duplicate" className="rounded p-1 hover:bg-muted"
                    onClick={() => setNameDialog({ mode: 'duplicate', value: `${w.name} copy`, target: w.name })}
                  >
                    <Copy className="size-4" />
                  </button>
                  <button
                    type="button" aria-label="Delete" disabled={workspaces.length <= 1}
                    className="rounded p-1 text-destructive hover:bg-muted disabled:opacity-30"
                    onClick={() => setDeleteTarget(w.name)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
            {/* 末尾ドロップゾーン: dropIndex = length で末尾へ移動 */}
            <li
              onDragOver={(e) => { e.preventDefault(); setOverIndex(workspaces.length) }}
              onDrop={(e) => { e.preventDefault(); const from = readFrom(e); if (from !== null) handleDrop(from, workspaces.length) }}
              className={cn('h-3 border-t-2 border-transparent', overIndex === workspaces.length && 'border-primary')}
            />
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <Button variant="secondary" onClick={() => setNameDialog({ mode: 'create', value: '', target: '' })}>
              <Plus className="size-4" /> New workspace…
            </Button>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {nameDialog && (
        <WorkspaceNameDialog
          mode={nameDialog.mode}
          initialValue={nameDialog.value}
          target={nameDialog.target}
          onClose={() => setNameDialog(null)}
        />
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Delete workspace?</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            This removes the workspace "{deleteTarget}", its watchlist, and its layout. This can't be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (deleteTarget) deleteWorkspace(deleteTarget); setDeleteTarget(null) }}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

> `cn` は `src/renderer/lib/utils.ts` の既存ユーティリティ（`Watchlist.tsx` が使用済み）。存在をこの手順で確認して import する。

- [ ] **Step 2: Verify typecheck + build**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: 成功

（この時点ではまだどこからも `WorkspaceEditDialog` を開いていない。未使用 export の typecheck 警告は出ない。次タスクで結線する。）

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/WorkspaceEditDialog.tsx
git commit -m "feat(workspace): add WorkspaceEditDialog (DnD reorder + manage)"
```

---

### Task 5: `WorkspaceSwitcher` を切替専用に単純化して編集モーダルを結線

ドロップダウンから行内 ▲▼ / rename / delete を撤去し、クリックで切替のみに。区切り線の下に「New workspace…」「Edit workspaces…」を置き、後者で `WorkspaceEditDialog` を開く。

**Files:**
- Modify: `src/renderer/components/WorkspaceSwitcher.tsx`

**Interfaces:**
- Consumes: `WorkspaceEditDialog`（Task 4）, `WorkspaceNameDialog`（Task 3）, store `switchWorkspace`, `workspaces`, `activeWorkspace`
- 使わなくなる import/action: `ChevronUp`, `Pencil`, `Trash2`, `reorderWorkspaces`, `renameWorkspace`, `deleteWorkspace`, `duplicateWorkspace`（New/Edit へ移譲）。撤去する。

- [ ] **Step 1: Rewrite WorkspaceSwitcher**

`src/renderer/components/WorkspaceSwitcher.tsx` を全面的に次へ置き換え:

```tsx
import React, { useState } from 'react'
import { ChevronDown, Copy, Pencil, Plus } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { useAppStore } from '../store'
import { WorkspaceNameDialog, type NameDialogMode } from './WorkspaceNameDialog'
import { WorkspaceEditDialog } from './WorkspaceEditDialog'

// ヘッダーのワークスペース切替器。クリックで切替、New で新規、Edit で管理モーダル（並べ替え/rename/
// delete/複製）を開く。管理操作そのものは WorkspaceEditDialog に集約（このメニューは切替専用）。
export function WorkspaceSwitcher(): React.JSX.Element {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)

  const [menuOpen, setMenuOpen] = useState(false)
  const [nameDialog, setNameDialog] = useState<{ mode: NameDialogMode; value: string; target: string } | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      {/* modal={false}: メニュー項目から Dialog を開くときの body ロック競合を避ける。 */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="max-w-[220px]">
            <span className="truncate" title={activeWorkspace}>{activeWorkspace}</span>
            <ChevronDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.name}
              className={w.name === activeWorkspace ? 'bg-accent text-accent-foreground' : ''}
              onClick={() => { switchWorkspace(w.name); setMenuOpen(false) }}
            >
              <span className="truncate" title={w.name}>{w.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'create', value: '', target: '' })}>
            <Plus className="size-4" /> New workspace…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'duplicate', value: `${activeWorkspace} copy`, target: activeWorkspace })}>
            <Copy className="size-4" /> Duplicate current…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" /> Edit workspaces…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {nameDialog && (
        <WorkspaceNameDialog
          mode={nameDialog.mode}
          initialValue={nameDialog.value}
          target={nameDialog.target}
          onClose={() => setNameDialog(null)}
        />
      )}

      <WorkspaceEditDialog open={editOpen} onOpenChange={setEditOpen} />
    </>
  )
}
```

> 「Duplicate current…」は `target=activeWorkspace` で `WorkspaceNameDialog` → `duplicateWorkspace(value, activeWorkspace)` を呼ぶ。sourceName 指定パスなのでアクティブは切り替わらない（新コピーは一覧に追加される）。これは「切替はドロップダウン担当」という本設計の責務分離と整合する。

- [ ] **Step 2: Verify typecheck + build**

Run: `npm run typecheck`
Expected: PASS（撤去した import/action の未使用参照が残っていないこと）

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: 全 PASS（Task 1・2 の新規テスト含む既存スイート）

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`
確認:
- ドロップダウン: 行クリックで切替、アクティブ行ハイライト。▲▼/rename/delete が無い。
- 「New workspace…」で作成、「Duplicate current…」で現在の複製（アクティブは変わらず一覧に追加）。
- 「Edit workspaces…」でモーダルが開き、grip ドラッグで並べ替え（末尾ゾーン含む）、行の rename/duplicate/delete、下部 New、Close が動く。delete は 1 件のとき無効。
- 複数ウィンドウを開き、片方で並べ替え・作成→もう片方に反映されること（`useWorkspaceSync`）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/WorkspaceSwitcher.tsx
git commit -m "feat(workspace): switch-only dropdown + Edit workspaces modal"
```

---

## Self-Review

**Spec coverage:**
- ドロップダウン切替専用化 + New/Edit → Task 5 ✓
- 編集モーダル（一覧・行アクション常時表示・delete 無効化）→ Task 4 ✓
- DnD（grip のみ draggable・行 drop・末尾ゾーン・NaN/空文字ガード）→ Task 4（`readFrom`）+ Task 2（変換）✓
- スクロール（max-h + overflow）→ Task 4 ✓
- フッター（New / Close）→ Task 4 ✓
- ネスト重なり（編集モーダルを閉じずに name/削除を重ねる）→ Task 4（`WorkspaceNameDialog`/delete Dialog を編集モーダルと兄弟で同時マウント）✓
- store `duplicateWorkspace(newName, sourceName?)` → Task 1 ✓
- インデックス変換 → Task 2 ✓
- クロスウィンドウ同期（最新 workspaces に対して変換）→ Task 4（`handleDrop` が `getState().workspaces.length`）✓
- 共有ロジック（name ダイアログ切り出し）→ Task 3 ✓
- テスト（DnD 変換ケース・duplicate の非アクティブ複製）→ Task 2・Task 1 ✓

**Placeholder scan:** なし（全ステップに実コード/実コマンド）。

**Type consistency:** `duplicateWorkspace(newName, sourceName?)`・`reorderTargetIndex(from, dropIndex, length)`・`WorkspaceNameDialog`/`WorkspaceEditDialog` の props は各タスク間で一致。`NameDialogMode` は Task 3 で定義し Task 4/5 が import。
