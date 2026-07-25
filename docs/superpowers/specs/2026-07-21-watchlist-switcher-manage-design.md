# ウォッチリスト・スイッチャーの管理機能拡張 — 設計

作成日: 2026-07-21

## 目的

タブ（サイドバー）を開いたときに表示されるウォッチリスト一覧を、以下のように直接管理できるようにする。

1. **リスト群の並び替え** — 複数ウォッチリスト（`Watchlist`、`米国株` など）の表示順を各行の ↑ / ↓ ボタンで変更できる。
2. **rename / delete の提供方法の改善** — 現状は「アクティブなリスト」にしか rename / delete できない。アクティブに切り替えることなく、一覧の任意の行を直接 rename / delete できるようにする。

いずれも `WatchlistSwitcher` のドロップダウン内で完結させ、右クリックメニューや専用ダイアログは導入しない（アプリ全体が左クリックのドロップダウンで統一されているため）。

## 現状（起点）

- `src/renderer/components/WatchlistSwitcher.tsx` — サイドバー上部の shadcn/Radix `DropdownMenu`。
  - 各リストは `DropdownMenuItem`（クリックで `switchWatchlist(name)` のみ）。
  - 下部に `New list…` / `Rename…` / `Delete…` の3項目。Rename/Delete は **アクティブなリスト固定**（`activeWatchlist` を対象に `renameWatchlist` / `deleteWatchlist` を呼ぶ）。
  - name ダイアログ（create/rename 兼用、`NameDialogState`）と削除確認ダイアログを内包。
- `src/renderer/store.ts` — `watchlists: NamedWatchlist[]` と `activeWatchlist: string` を保持。
  - `createWatchlist`（重複名ガード）、`renameWatchlist(oldName, newName)`（重複ガード＋active更新、**任意リスト対応済み**）、`deleteWatchlist(name)`（最後の1つは削除拒否、active付け替え、**任意リスト対応済み**）、`switchWatchlist(name)`。
  - いずれも `WatchlistActionResult = { ok: true } | { ok: false; error: string }` を返す。
  - リスト内シンボルの並び替え `reorderWatchlist(from, to)` は存在するが、**リスト群の並び替えは存在しない**（新規リストは末尾に append）。
- `src/main/watchlistStore.ts` — `watchlist.json` に `WatchlistCollection { version, active, lists }` を保存。`lists` 配列の順序がそのまま表示順。
- `src/renderer/App.tsx` — `[watchlists, activeWatchlist]` を購読し 500ms デバウンスで全コレクションを保存。**配列順序を変えれば自動で永続化される**。

## 設計

### 1. ストア: `reorderWatchlists(from, to)` を追加（`store.ts`）

- 既存 `reorderWatchlist(from, to)`（シンボル版）と同じスプライス方式でリスト版を追加する。
  - `watchlists` 配列から `from` を取り出し、下方向移動時のインデックス補正を含めて `to` へ挿入。
  - 戻り値は `WatchlistActionResult`（既存パターン準拠）。範囲外インデックスは `{ ok: false }` を返す（no-op）。
- `activeWatchlist` は変更しない（順序のみ変わる）。
- rename / delete は既存アクションをそのまま使う（任意リスト対応済みのため追加不要）。

### 2. スイッチャー UI の行を管理可能にする（`WatchlistSwitcher.tsx`）

ドロップダウン内の各リストを、現状の `DropdownMenuItem`（切替のみ）から**カスタム行**に置き換える。Radix の `DropdownMenuItem` は内部でポインタ/キーボード/フォーカスを捕捉し、行内にボタンを埋め込むと競合するため、リスト部分は Radix メニュー項目ではなく素の行として描画する（`New list…` は従来どおり `DropdownMenuItem` のまま残す）。

1行の構成:

```
[ リスト名 (クリックで切替、アクティブは強調) ]        [↑] [↓] [✎] [🗑]
```

- **リスト名**: クリックで `switchWatchlist(name)`。アクティブ行は背景/文字色で強調（`activeWatchlist === w.name`）。`truncate` + `title` は維持。
- **操作アイコン（↑↓✎🗑）**: 通常は非表示。**ホバー / キーボードフォーカスした行にのみ表示**（`group-hover` / `focus-within` パターン。Tailwind の `group` + `opacity-0 group-hover:opacity-100 focus-within:opacity-100`）。アクティブ行かどうかに関わらず、どの行でも操作可能。
  - **↑**: `reorderWatchlists(index, index - 1)`。先頭行（`index === 0`）は `disabled`。
  - **↓**: `reorderWatchlists(index, index + 1)`。末尾行は `disabled`。
  - **✎ (rename)**: `setNameDialog({ mode: 'rename', value: w.name, error: null, target: w.name })` で既存 name ダイアログを開く。
  - **🗑 (delete)**: `setDeleteTarget(w.name)` で既存削除確認ダイアログを開く。リストが1つだけ（`watchlists.length <= 1`）のとき `disabled`。
- 各操作ボタンの `onClick` では `e.stopPropagation()` して行の切替クリックへ伝播しないようにする。
- アイコンは `lucide-react`（`ChevronUp` / `ChevronDown` / `Pencil` / `Trash2`）を使用。

### 3. ダイアログの対象をアクティブ固定から明示ターゲットへ（`WatchlistSwitcher.tsx`）

- `NameDialogState` に `target: string` を追加し、rename 確定時は `renameWatchlist(nameDialog.target, nameDialog.value)` を呼ぶ（現状の `activeWatchlist` 固定を廃止）。create 時は `target` 未使用。
- 削除確認は既存の `deleteTarget: string | null` をそのまま使用（すでに任意名対応）。
- 下部メニューは **`New list…` のみ残す**。従来の `Rename…` / `Delete…`（アクティブ固定）は行内アイコンへ移行するため撤去する。

### エッジケース

- リストが1つだけ: delete 無効、↑↓ 無効（先頭かつ末尾）。
- rename 重複名: 既存 `renameWatchlist` の重複ガードが `{ ok: false, error }` を返す → ダイアログにエラー表示（既存の `confirmNameDialog` フロー）。
- rename の対象がアクティブ: 既存 `renameWatchlist` が `activeWatchlist` を新名へ更新済み。
- アクティブなリストを delete: 既存 `deleteWatchlist` が active を別リストへ付け替え。
- 並び替え: `activeWatchlist` は不変。永続化は `App.tsx` の既存購読で自動反映。
- ドロップダウンを開いたままの連続操作（↑↓ 連打）でメニューが閉じないこと（行がカスタム要素で `onSelect` を持たないため閉じない）。

## テスト

- **ストア（`store.ts`）**:
  - `reorderWatchlists`: 中間→中間、先頭↑（no-op/範囲外）、末尾↓（no-op/範囲外）、隣接入れ替えで期待順序になること。`activeWatchlist` が不変であること。
  - `renameWatchlist` の重複ガード、delete 時の active 付け替え（既存挙動の回帰確認）。
- **永続化往復**: 並び替え後の `watchlists` 順序が `WatchlistCollection.lists` の順序として保存され、再ハイドレートで復元されること（`watchlistStore` の read/write）。
- **UI（可能な範囲で）**: ホバー時のみ操作アイコンが現れること、↑↓ の disabled 境界、操作ボタンクリックで行の切替が発火しないこと（`stopPropagation`）。

## 非対象（YAGNI）

- ドラッグ&ドロップによるリスト並び替え（Radix ドロップダウンとの相性が悪いため ↑↓ ボタンを採用）。
- 右クリック（コンテキストメニュー）／専用管理ダイアログ。
- インライン（その場編集）rename（既存の name ダイアログを再利用）。
- リスト内シンボルの並び替え（既に実装済み、本件の対象外）。
