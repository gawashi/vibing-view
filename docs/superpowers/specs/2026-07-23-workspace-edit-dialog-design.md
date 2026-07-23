# ワークスペース編集モーダル

## 背景 / 課題

ワークスペースの切替器（`WorkspaceSwitcher`）は、ドロップダウン内の各行に ▲▼ ボタンを持ち、
1 クリックで 1 つ隣へ動かす方式で並べ替える。遠くへ動かすとクリックを連打する必要があり煩雑。
rename / delete / duplicate も同じドロップダウンに詰め込まれ、hover でしか出ない行アクションと
相まって操作性が悪い。

切替（日常操作）と管理（並べ替え・rename・delete・複製）の責務を分離し、管理は 1 枚の編集モーダルに
集約する。最優先で解消したいのは並べ替えの煩雑さで、ドラッグ&ドロップに置き換える。

## 方針

- ドロップダウンは**切替専用**に単純化。管理操作は新規の**編集モーダル**に集約。
- 並べ替えは **Watchlist と同じネイティブ HTML5 ドラッグ&ドロップ**で実装（新規依存なし。`Watchlist.tsx` の
  `draggable` + `dataTransfer` パターンに揃える）。
- store は**無改修**。既存アクション（`reorderWorkspaces` / `createWorkspace` / `duplicateWorkspace` /
  `renameWorkspace` / `deleteWorkspace`）をそのまま使う。
- 別 OS ウィンドウにはしない。Radix Dialog によるモーダルダイアログ。

## コンポーネント設計

### 1. `WorkspaceSwitcher.tsx`（改修）

ドロップダウンを切替専用に単純化する。

- 一覧行 = クリックで `switchWorkspace` のみ。アクティブ行をハイライト。
- 行内の ▲▼ / rename / delete ボタンは撤去。
- 区切り線の下に 2 項目:
  - `New workspace…` → name ダイアログを `create` モードで開く
  - `Edit workspaces…` → 編集モーダルを開く

### 2. `WorkspaceEditDialog.tsx`（新規）

管理を 1 枚で完結させるモーダル。

- **一覧**: 全ワークスペースを縦リスト表示。各行:
  - ドラッグハンドル（`GripVertical`）+ ワークスペース名
  - 右寄せの行アクション（**常時表示**）: rename（Pencil）/ duplicate（Copy）/ delete（Trash2）
  - delete は `workspaces.length <= 1` で無効化
- **並べ替え**: ネイティブ HTML5 DnD（Watchlist と同一挙動）
  - 行を `draggable`、`onDragStart` で index を `dataTransfer` に格納
  - `onDragOver` でドロップ先を `overIndex` state にセットし、行間にインジケータ線を表示
  - `onDrop` で index を変換して `reorderWorkspaces(from, to)` を呼ぶ（下記「インデックス変換」）
  - 末尾ドロップゾーン（リスト末尾の細い領域）で末尾へ移動
- **フッター**: 下部に `+ New workspace…`、右下に `Close`。操作は即時反映。
- 行クリックでの切替はしない（誤操作防止。切替はドロップダウン担当）。
- rename / duplicate / new の入力は既存 name ダイアログ（`create` / `rename` / `duplicate` の 3 モード、
  バリデーション込み）を、delete は既存の削除確認ダイアログを、このモーダル上にネストして再利用。

### 3. store / 型

無改修。

## インデックス変換（DnD → `reorderWorkspaces`）

`reorderWorkspaces(from, to)` は `to` を「削除後の配列に対する splice 直接インデックス」として扱い、
`to >= n` を弾く。一方 Watchlist の DnD は「行にドロップ = その行の前に挿入」「末尾ゾーン = 末尾へ」の
UX。この差を **DnD ハンドラ側で吸収**する（store は無改修）:

- 行 `drop`（ドロップ先の表示インデックス `d`）: `to = from < d ? d - 1 : d`
- 末尾ゾーン: `to = n - 1`
- `from === to` は store 側が弾く（no-op）

## 共有ロジック

name ダイアログ（create/rename/duplicate）と削除確認ダイアログは現在 `WorkspaceSwitcher` にある。
`WorkspaceSwitcher`（New workspace）と `WorkspaceEditDialog`（rename/duplicate/delete/new）の双方から
使うため、小さな共有フック（例 `useWorkspaceNameDialog`）または共有コンポーネントに切り出す。実装時に
重複が少ない形を選ぶ。

## テスト

- `tests/renderer/workspace.test.ts` に DnD インデックス変換の単体テストを 1 本追加
  （`from < to` シフト、末尾クランプ、`from === to` no-op の境界）。
- store ロジックは既存テストでカバー済み。

## スコープ外（YAGNI）

- DnD ライブラリ導入（ネイティブで足りる／Watchlist と統一）
- キーボードによる並べ替え、並べ替えアニメーション
- 別 OS ウィンドウ化
