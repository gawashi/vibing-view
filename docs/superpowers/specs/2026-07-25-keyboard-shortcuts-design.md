# キーボードショートカット導入 — 設計

日付: 2026-07-25

## 目的

グリッドチャート操作をキーボードから行えるようにする。マウス右クリックメニューや
ヘッダのボタンでしか出来ない操作（更新・お気に入り追加・コピー/カット/ペースト/削除）に
ショートカットを割り当て、操作を高速化する。

## スコープ

- **メインウィンドウ（`App`）のみ**。拡大ウィンドウ（`ChartWindow`）・企業ウィンドウには入れない。
  - 拡大ウィンドウはグリッドを持たず、更新も自前フェッチせず同期受信のみのため対象外。
- 新規依存ライブラリは追加しない。

## キーマッピング

| キー | 動作 | 呼び出し |
|---|---|---|
| Ctrl+R / F5 | 表示中チャートのデータ更新 | `reload({ source: 'manual' })` |
| Ctrl+D | アクティブセルの銘柄をお気に入り**トグル**（追加/解除） | 共有 `toggleWatchlist(symbol)` |
| Ctrl+C | アクティブセルをコピー | `copyCell(activeCellId)` |
| Ctrl+X | アクティブセルをカット | `cutCell(activeCellId)` |
| Ctrl+V | アクティブセルにペースト | `pasteCell(activeCellId)` |
| Delete | アクティブセルをクリア | `clearCell(activeCellId)` |

- 操作対象は常に `activeCellId`（クリックで選択済み、リング表示のセル）。
- store 操作は `useAppStore.getState()` から直接呼ぶ（メニューコンポーネントを経由しない）。

## 実装方式

`App.tsx` に `keydown` リスナーを1つ追加する。ロジックは専用フックに切り出す:

**`src/renderer/hooks/useGridShortcuts.ts`**

```
useGridShortcuts(reload)
```

- `App` から1行で呼ぶ。`reload` は `App` 内のローカルクロージャなので引数で渡す。
- フック内で `window.addEventListener('keydown', ...)` を張り、アンマウント時に解除。
- store 操作・`activeCellId` は `useAppStore.getState()` で取得。

## ガード（誤爆防止）

1. **入力フォーカスガード**: イベント発生源（`event.target`）が
   `input` / `textarea` / `select` / `contentEditable` の場合はショートカットを素通りさせる。
   → 検索バー・ダイアログ・パラメータ入力欄の通常の Ctrl+C/V/Delete/文字入力が壊れない。

2. **Ctrl+C とテキスト選択の衝突**: `window.getSelection()` が非空（テキスト選択あり）の場合は
   Ctrl+C を素通りさせ native のテキストコピーに任せる。選択が無い時だけ `copyCell` を実行。
   → ウォッチリストの銘柄・価格表示・企業ウィンドウ等のテキストコピーを妨げない。
   （Ctrl+X/V は入力欄外に native な意味がなく、入力欄は 1. でガード済みのため C のみ対応）

3. **Ctrl+R / F5**: `preventDefault()` で Electron 標準のページリロードを抑止し、
   データ更新に振り向ける。

## 付随改善: お気に入りトグルの一本化

現状「銘柄をお気に入りトグルする」処理が2箇所に重複している:
- `FavoriteStar`（`GridHost.tsx` の★ボタン）
- `ChartContextMenu` の "Add to watchlist"

ショートカットで3つ目の呼び出し元が増えるため、共有ヘルパー **`toggleWatchlist(symbol)`** に抽出し
3箇所から使う。プロファイル名/取引所は react-query キャッシュから引く既存パターンを踏襲する
（`store.addToWatchlist` / `removeFromWatchlist` と `selectActiveItems` の "watched?" 判定を再利用）。

## テスト

`useGridShortcuts` のキー→動作マッピングとガードを、`KeyboardEvent` をディスパッチして検証する
最小のユニットテストを1つ用意する:
- 各キーが対応する store 操作を呼ぶこと
- 入力欄フォーカス時は素通りすること
- テキスト選択あり時の Ctrl+C が素通りすること

## 対象外（YAGNI）

- ショートカットのユーザーカスタマイズ / 設定画面
- ショートカット一覧のヘルプ表示
- 拡大ウィンドウ・企業ウィンドウへの展開
- 更新以外のヘッダボタン（自動更新トグル・グリッド形状変更等）へのショートカット
