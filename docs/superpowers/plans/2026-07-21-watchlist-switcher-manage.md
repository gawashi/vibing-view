# Watchlist Switcher Manage (reorder/rename/delete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サイドバー上部のウォッチリスト・スイッチャーで、任意のリストを ↑↓ で並び替え・rename・delete できるようにする（アクティブに切り替えずに直接操作）。

**Architecture:** zustand ストアに「リスト群の並び替え」アクション `reorderWatchlists(from, to)` を追加し、`WatchlistSwitcher` のドロップダウン内の各リスト行を Radix `DropdownMenuItem` から素のカスタム行へ置き換える。各行にホバー/フォーカスで現れる ↑↓✎🗑 を持たせ、rename/delete の対象を「アクティブ固定」から「その行のリスト」へ変更する。永続化は `App.tsx` の既存購読（`watchlists` 配列を監視して `watchlist.json` に保存）にそのまま乗るため追加不要。

**Tech Stack:** Electron + React 19 + TypeScript, zustand 5, Radix UI (shadcn DropdownMenu/Dialog), Tailwind CSS, lucide-react, Vitest 3 (node 環境).

## Global Constraints

- テストは Vitest（`environment: 'node'`、`include: ['tests/**/*.test.ts']`）。`.tsx` のコンポーネントテスト基盤は存在しない → UI 変更はストア単体テスト＋`typecheck`＋`build`＋手動確認で担保する。
- ストアのウォッチリスト系アクションは `WatchlistActionResult = { ok: true } | { ok: false; error: string }` を返す既存パターンに合わせる。
- 破壊的メニュー項目/ボタンは `text-destructive` を付ける（既存慣習）。
- コミットは細かく。各タスク末尾でコミットする。
- 型チェックコマンド: `npm run typecheck`（`tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit`）。テスト: `npm run test`（`vitest run`）。ビルド: `npm run build`。

---

## Task 1: ストアに `reorderWatchlists(from, to)` を追加

**Files:**
- Modify: `src/renderer/store.ts`（型宣言 `:73` 付近、実装 `:313` 付近）
- Test: `tests/renderer/store.test.ts`（`describe('watchlists (multi-list)')` ブロック内、`:218-314`）

**Interfaces:**
- Consumes: 既存 `watchlists: NamedWatchlist[]`、`activeWatchlist: string`、`WatchlistActionResult`。
- Produces: `reorderWatchlists: (from: number, to: number) => WatchlistActionResult` — `watchlists` 配列内で index `from` の要素を index `to` の位置へ移動する（プレーンな配列 move）。範囲外 or `from === to` は `{ ok: false, error }` を返し状態を変えない。`activeWatchlist` は不変。Task 2 の UI が `reorderWatchlists(i, i-1)`（↑）/ `reorderWatchlists(i, i+1)`（↓）で使用する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/renderer/store.test.ts` の `describe('watchlists (multi-list)', () => { ... })` ブロックの末尾（`deleteWatchlist protects the last list ...` の `it` の直後、`:313` の `})` の前）に以下を追加する。ファイル冒頭の import は既存の `useAppStore, selectActiveItems` をそのまま使う（変更不要）。

```ts
    it('reorderWatchlists moves a list DOWN (from < to) without touching active', () => {
      useAppStore.setState({
        watchlists: [
          { name: 'A', items: [] },
          { name: 'B', items: [] },
          { name: 'C', items: [] }
        ],
        activeWatchlist: 'A'
      })
      expect(useAppStore.getState().reorderWatchlists(0, 1)).toEqual({ ok: true })
      expect(useAppStore.getState().watchlists.map((w) => w.name)).toEqual(['B', 'A', 'C'])
      expect(useAppStore.getState().activeWatchlist).toBe('A')
    })

    it('reorderWatchlists moves a list UP (from > to)', () => {
      useAppStore.setState({
        watchlists: [
          { name: 'A', items: [] },
          { name: 'B', items: [] },
          { name: 'C', items: [] }
        ],
        activeWatchlist: 'A'
      })
      expect(useAppStore.getState().reorderWatchlists(2, 1)).toEqual({ ok: true })
      expect(useAppStore.getState().watchlists.map((w) => w.name)).toEqual(['A', 'C', 'B'])
    })

    it('reorderWatchlists rejects out-of-range and no-op indices, leaving order unchanged', () => {
      useAppStore.setState({
        watchlists: [
          { name: 'A', items: [] },
          { name: 'B', items: [] }
        ],
        activeWatchlist: 'A'
      })
      expect(useAppStore.getState().reorderWatchlists(0, 5).ok).toBe(false)
      expect(useAppStore.getState().reorderWatchlists(-1, 0).ok).toBe(false)
      expect(useAppStore.getState().reorderWatchlists(1, 1).ok).toBe(false)
      expect(useAppStore.getState().watchlists.map((w) => w.name)).toEqual(['A', 'B'])
    })
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm run test -- tests/renderer/store.test.ts`
Expected: FAIL（`reorderWatchlists is not a function` 相当。TypeScript 経由で `getState().reorderWatchlists` が存在しない）。

- [ ] **Step 3: 型宣言を追加**

`src/renderer/store.ts` の `AppState` 型内、`reorderWatchlist: (from: number, to: number) => void`（`:73`）の直後に1行追加する。

```ts
  reorderWatchlist: (from: number, to: number) => void
  reorderWatchlists: (from: number, to: number) => WatchlistActionResult
```

- [ ] **Step 4: 実装を追加**

`src/renderer/store.ts` の実装部、`reorderWatchlist` の実装ブロック（`:313-321`、末尾は `})),`）の直後に以下を追加する。

```ts
  reorderWatchlists: (from, to) => {
    const n = get().watchlists.length
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) {
      return { ok: false, error: 'Invalid index.' }
    }
    set((state) => {
      const lists = [...state.watchlists]
      const [moved] = lists.splice(from, 1)
      lists.splice(to, 0, moved)
      return { watchlists: lists }
    })
    return { ok: true }
  },
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npm run test -- tests/renderer/store.test.ts`
Expected: PASS（新規3件を含め全て緑）。

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなしで終了。

- [ ] **Step 7: コミット**

```bash
git add src/renderer/store.ts tests/renderer/store.test.ts
git commit -m "feat(watchlist): add reorderWatchlists store action"
```

---

## Task 2: スイッチャーの各行を管理可能にする（並び替え/rename/delete）

**Files:**
- Modify: `src/renderer/components/WatchlistSwitcher.tsx`（全面的に書き換え。全 127 行）

**Interfaces:**
- Consumes: Task 1 の `reorderWatchlists(from, to)`。既存 `watchlists`, `activeWatchlist`, `createWatchlist`, `renameWatchlist(from, to)`, `deleteWatchlist(name)`, `switchWatchlist(name)`。
- Produces: UI のみ（他タスクからの参照なし）。

**背景（現状の要点）:** 現行 `WatchlistSwitcher.tsx` は各リストを `DropdownMenuItem`（クリックで `switchWatchlist` のみ）として描画し、下部に `New list…` / `Rename…`（`activeWatchlist` 固定）/ `Delete…`（`activeWatchlist` 固定）を持つ。`NameDialogState = { mode; value; error }`。rename 確定は `renameWatchlist(activeWatchlist, value)`。

**この変更でやること:**
1. `NameDialogState` に `target: string` を追加し、rename を `renameWatchlist(nameDialog.target, nameDialog.value)` へ。
2. リスト部分を素のカスタム行に置換。各行 = 名前ボタン（クリックで切替＋メニュー閉じ）＋ ホバー/フォーカスで現れる ↑↓✎🗑。
3. ドロップダウンを制御コンポーネント化（`open`/`onOpenChange`）。名前クリックと rename/delete 起動時はメニューを閉じる。↑↓ は閉じない。
4. 下部は `New list…` のみ残し、`Rename…` / `Delete…` を撤去。
5. 操作ボタンは `e.stopPropagation()` で行の切替へ伝播させない。↑ は先頭行、↓ は末尾行、🗑 はリスト1つのとき `disabled`。

- [ ] **Step 1: ファイルを全面書き換え**

`src/renderer/components/WatchlistSwitcher.tsx` を以下の内容で置き換える。

```tsx
import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { useAppStore } from '../store'

type NameDialogState = { mode: 'create' | 'rename'; value: string; error: string | null; target: string }

// サイドバー上部のウォッチリスト切替＋管理。各行にホバー/フォーカスで現れる ↑↓✎🗑 を持たせ、
// アクティブに切り替えずに任意のリストを並び替え/rename/delete できる。
// リスト部分は Radix DropdownMenuItem ではなく素の行（行内ボタンとの捕捉競合を避けるため）。
export function WatchlistSwitcher(): React.JSX.Element {
  const watchlists = useAppStore((s) => s.watchlists)
  const activeWatchlist = useAppStore((s) => s.activeWatchlist)
  const createWatchlist = useAppStore((s) => s.createWatchlist)
  const renameWatchlist = useAppStore((s) => s.renameWatchlist)
  const deleteWatchlist = useAppStore((s) => s.deleteWatchlist)
  const switchWatchlist = useAppStore((s) => s.switchWatchlist)
  const reorderWatchlists = useAppStore((s) => s.reorderWatchlists)

  const [menuOpen, setMenuOpen] = useState(false)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const confirmNameDialog = (): void => {
    if (!nameDialog) return
    const result =
      nameDialog.mode === 'create'
        ? createWatchlist(nameDialog.value)
        : renameWatchlist(nameDialog.target, nameDialog.value)
    if (!result.ok) {
      setNameDialog({ ...nameDialog, error: result.error })
      return
    }
    setNameDialog(null)
  }

  return (
    <>
      {/* modal={false}: メニュー項目/行から Dialog を開くときの body ロック競合を避ける (LayoutMenu と同じ)。 */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="w-full justify-between">
            <span className="truncate" title={activeWatchlist}>{activeWatchlist}</span>
            <ChevronDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {watchlists.map((w, i) => (
            <div
              key={w.name}
              className={`group flex items-center gap-1 rounded-sm px-2 py-1.5 text-sm ${
                w.name === activeWatchlist ? 'bg-accent text-accent-foreground' : ''
              }`}
            >
              <button
                type="button"
                title={w.name}
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => { switchWatchlist(w.name); setMenuOpen(false) }}
              >
                {w.name}
              </button>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); reorderWatchlists(i, i - 1) }}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === watchlists.length - 1}
                  className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); reorderWatchlists(i, i + 1) }}
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Rename"
                  className="rounded p-0.5 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    setNameDialog({ mode: 'rename', value: w.name, error: null, target: w.name })
                  }}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  disabled={watchlists.length <= 1}
                  className="rounded p-0.5 text-destructive hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setDeleteTarget(w.name) }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setNameDialog({ mode: 'create', value: '', error: null, target: '' })}
          >
            New list…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={nameDialog !== null} onOpenChange={(open) => { if (!open) setNameDialog(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === 'rename' ? 'Rename watchlist' : 'New watchlist'}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="watchlist-name">Name</label>
            <Input
              id="watchlist-name"
              value={nameDialog?.value ?? ''}
              placeholder="e.g. Tech"
              onChange={(e) => setNameDialog((prev) => (prev ? { ...prev, value: e.target.value, error: null } : prev))}
            />
            {nameDialog?.error && <p className="text-sm text-destructive">{nameDialog.error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button onClick={confirmNameDialog} disabled={(nameDialog?.value ?? '').trim().length === 0}>
              {nameDialog?.mode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Delete watchlist?</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            This removes the watchlist "{deleteTarget}" and its symbols. This can't be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteTarget) deleteWatchlist(deleteTarget); setDeleteTarget(null) }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなしで終了（`reorderWatchlists` は Task 1 で型定義済み。`NameDialogState.target` の追加で `create` 分岐も `target: ''` を渡しているため型エラーなし）。

- [ ] **Step 3: 既存テストの回帰確認**

Run: `npm run test`
Expected: 全 PASS（このタスクはストアを変更しないため Task 1 のテストを含め緑のまま）。

- [ ] **Step 4: 本番ビルドが通ることを確認**

Run: `npm run build`
Expected: `electron-vite build` が成功（型・バンドルエラーなし）。

- [ ] **Step 5: 手動確認（`npm run dev`）**

Run: `npm run dev`
以下を目視で確認する:
  - サイドバー上部のスイッチャーを開くと、各リスト行の右側は通常アイコン非表示。行にマウスを乗せる/Tab フォーカスすると ↑↓✎🗑 が現れる。
  - ↑↓ でリストの表示順が変わり、押してもメニューが閉じない。先頭行は↑無効、末尾行は↓無効。
  - 行名クリックでそのリストへ切替＆メニューが閉じる。
  - ✎ で rename ダイアログが「その行の名前」で開き、リネームできる（重複名はエラー表示）。アクティブでない行もリネーム可。
  - 🗑 で削除確認が「その行の名前」で開き、削除できる。リストが1つのときは無効。
  - アプリ再起動後も並び替え順が保持される（`watchlist.json` への永続化）。

- [ ] **Step 6: コミット**

```bash
git add src/renderer/components/WatchlistSwitcher.tsx
git commit -m "feat(watchlist): per-row reorder/rename/delete in switcher"
```

---

## Self-Review

**Spec coverage:**
- 目的1（リスト群の並び替え, ↑↓）→ Task 1（`reorderWatchlists`）＋ Task 2（行内 ↑↓ ボタン）。✓
- 目的2（rename/delete を任意リストに, アクティブ固定廃止）→ Task 2（`NameDialogState.target`、行内 ✎🗑、下部 Rename…/Delete… 撤去）。✓
- スイッチャー内で完結・右クリック/専用ダイアログ非導入 → Task 2 は既存 DropdownMenu を拡張。✓
- ホバー/フォーカス表示 → Task 2 の `group-hover`/`group-focus-within`。✓
- エッジケース（1リスト時の delete/↑↓ 無効、重複名エラー、active 付け替え、↑↓ でメニュー非閉鎖）→ Task 2 の `disabled` と `stopPropagation`＋制御 open、既存ストアガード。✓
- 永続化 → 既存 `App.tsx` 購読に自動追従（追加作業なし、手動確認で検証）。✓
- 非対象（DnD/右クリック/インライン編集/シンボル並び替え）→ プランに含めず。✓

**Placeholder scan:** TBD/TODO/「適切に処理」等なし。各コード手順は完全なコードを提示。✓

**Type consistency:** `reorderWatchlists: (from: number, to: number) => WatchlistActionResult` を Task 1 の型宣言・実装・Task 2 の呼び出しで一致。`NameDialogState` の `target: string` を型・`create`(`target: ''`)・`rename`(`target: w.name`)・`confirmNameDialog`（`renameWatchlist(nameDialog.target, ...)`）で一貫。既存 `switchWatchlist`/`deleteWatchlist`/`createWatchlist`/`renameWatchlist` のシグネチャは変更なし。✓
