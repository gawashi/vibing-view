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
  `draggable` + `dataTransfer` パターンに揃える）。**ドラッグは grip からのみ開始、行は drop ターゲット専用**
  （Watchlist の D-66 と同じ。`draggable` を行に付けると既存パターンと食い違う）。
- store は `duplicateWorkspace` にコピー元指定を追加する小改修のみ（下記）。他アクション
  （`reorderWorkspaces` / `createWorkspace` / `renameWorkspace` / `deleteWorkspace`）はそのまま使う。
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
- **並べ替え**: ネイティブ HTML5 DnD（Watchlist と同一挙動、D-66）
  - grip（`GripVertical`）のみ `draggable`。`onDragStart` で index を `dataTransfer` に `String(index)` で格納
  - 行は drop ターゲット。`onDragOver` で `preventDefault` し `overIndex` をセット、`border-t` で挿入線を表示
  - `onDrop` で `Number(getData('text/plain'))` を読み、`Number.isNaN` を弾いてから index を変換して
    `reorderWorkspaces(from, to)` を呼ぶ（下記「インデックス変換」）。空文字は `Number('') === 0` になるため、
    `dataTransfer` が空のケースは `getData` の戻り値が空文字か否かで先に弾く
  - 末尾ドロップゾーン（リスト末尾の細い領域）で末尾へ移動
- **スクロール**: ワークスペースが多い場合に備え、リストは `max-h`（例 `60vh`）+ `overflow-y-auto`。
- **フッター**: 下部に `+ New workspace…`、右下に `Close`。操作は即時反映。
- 行クリックでの切替はしない（誤操作防止。切替はドロップダウン担当）。
- rename / duplicate / new の入力は既存 name ダイアログ（`create` / `rename` / `duplicate` の 3 モード、
  バリデーション込み）を、delete は既存の削除確認ダイアログを、このモーダル上にネストして再利用。
- **ネストしたダイアログの重なり**: 編集モーダル（Radix Dialog）の上に name/削除ダイアログを開く。Radix は
  スタックを扱えるが、フォーカストラップとオーバーレイの二重掛けに注意。実装時、name/削除ダイアログを開く間は
  編集モーダルを開いたまま背後に残す（閉じない）。オーバーレイ色は最前面のみで良い。

### 3. store / 型

`duplicateWorkspace(newName)` はコピー元が常にアクティブワークスペース固定
（[store.ts:321](../../../src/renderer/store.ts) の `get().currentLayout()` / `selectActiveItems(get())`）。
編集モーダルは非アクティブな行も複製できる必要があるため、コピー元を指定できるよう小改修する:

- 署名を `duplicateWorkspace(newName: string, sourceName?: string)` に拡張。`sourceName` 省略時は現行どおり
  アクティブを複製（`WorkspaceSwitcher` の「Duplicate current」は無改修で動く）。
- `sourceName` 指定時はその名前のワークスペースの layout を `remintLayout` し、items をコピーして複製。
- 既存の重複名チェック等はそのまま。

## インデックス変換（DnD → `reorderWorkspaces`）

`reorderWorkspaces(from, to)` は `to` を「削除後の配列に対する splice 直接インデックス」として扱い、
`to >= n` を弾く。一方 Watchlist の DnD は「行にドロップ = その行の前に挿入」「末尾ゾーン = 末尾へ」の
UX。この差を **DnD ハンドラ側で吸収**する（store は無改修）:

- 行 `drop`（ドロップ先の表示インデックス `d`）: `to = from < d ? d - 1 : d`
- 末尾ゾーン: `to = n - 1`
- `from === to` は store 側が弾く（no-op）

## クロスウィンドウ同期

`reorderWorkspaces` は `useWorkspaceSync` 経由で他ウィンドウへブロードキャストされる。並べ替え自体は drop 時の
1 回のアトミックな `set` なのでドラッグ中に他ウィンドウが割り込む余地は小さいが、編集モーダルを開いている最中に
別ウィンドウからワークスペース構成が変わる可能性はある。リストは常に store の最新 `workspaces` を購読して描画し、
ドラッグ中のローカル state（`overIndex`）だけをコンポーネント内に持つ。ドラッグ開始時の index ではなく drop 時点の
最新配列に対して変換・`reorderWorkspaces` を呼ぶ。

## 共有ロジック

name ダイアログ（create/rename/duplicate）と削除確認ダイアログは現在 `WorkspaceSwitcher` にある。
`WorkspaceSwitcher`（New workspace）と `WorkspaceEditDialog`（rename/duplicate/delete/new）の双方から
使うため、小さな共有フック（例 `useWorkspaceNameDialog`）または共有コンポーネントに切り出す。実装時に
重複が少ない形を選ぶ。

## テスト

- `tests/renderer/workspace.test.ts` に DnD インデックス変換の単体テストを追加。ケース:
  `from < to` シフト、`from > to`、末尾クランプ、`from === to` no-op、`Number.isNaN` / 空文字ガード。
- `duplicateWorkspace(newName, sourceName)` の store テスト: 非アクティブ行を複製してもアクティブが変わらず、
  コピー元の layout/items が複製されること。
- 既存の store 並べ替え・rename・delete テストは維持。

## スコープ外（YAGNI）

- DnD ライブラリ導入（ネイティブで足りる／Watchlist と統一）
- キーボードによる並べ替え、並べ替えアニメーション
- 別 OS ウィンドウ化
