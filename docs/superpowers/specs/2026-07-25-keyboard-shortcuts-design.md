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

### 純関数への切り出し（テスタビリティ）

副作用の判定ロジックは純関数 **`handleGridShortcut(event, deps)`** に切り出す:

```
handleGridShortcut(event: KeyboardEvent, deps: {
  reload, copyCell, cutCell, pasteCell, clearCell, toggleWatchlist,
  getActiveCellId, getActiveSymbol,
}): boolean   // 処理したら true（呼び出し側で preventDefault 判断に使う）
```

- フックの `keydown` リスナーは薄いラッパで、`handleGridShortcut(event, deps)` を呼ぶだけ。
- 既存 Vitest が `node` 環境（`vitest.config.ts` / `tests/renderer/setup.ts` に DOM グローバル無し）
  のため、実 DOM を張らずフェイクの `event`/`deps` で純関数を直接テストできる。

### 修飾キー一致 / preventDefault

- **修飾キーは厳密一致**。`Ctrl+C` は `ctrlKey && !shiftKey && !altKey && !metaKey`（Windows 前提）。
  余計な修飾キーが付いた組合せ（例: Ctrl+Shift+C）は素通りさせる。
- **`preventDefault` は「処理したキーのみ」**打つ（`handleGridShortcut` が true を返した時だけ）。
  特に Ctrl+R / F5 は Electron 標準リロードを止めるため必須。素通りしたキーには打たない。
- **キーリピート抑止**: 変更系ショートカット（Ctrl+D / C / X / V / Delete）は
  `if (event.repeat) return` で長押し連打を無視する。
  → 押しっぱなしでお気に入りが何度もトグルされる／ペーストが indicator id を再ミントし続ける事故を防ぐ。
  更新（Ctrl+R / F5）はリピートしても実害が小さいが、統一して repeat は無視でよい。

## ガード（誤爆防止）

1. **入力フォーカスガード**: イベント発生源（`event.target`）が次のいずれかに一致する場合は
   ショートカットを素通りさせる:
   - フォーム要素: `input` / `textarea` / `select` / `contentEditable`
   - モーダル/メニュー配下: `event.target.closest('[role="dialog"], [role="menu"]')` が非 null
     （`BulkDeleteMenu` 等、フォーム要素でないボタン/コンテナにフォーカスがある場合も拾う）
   → 検索バー・ダイアログ・メニュー・パラメータ入力欄の通常操作（Ctrl+C/V/Delete/文字入力・Enter 等）が壊れない。

2. **Ctrl+C とテキスト選択の衝突**: `window.getSelection()` が非空（テキスト選択あり）の場合は
   Ctrl+C を素通りさせ native のテキストコピーに任せる。選択が無い時だけ `copyCell` を実行。
   → ウォッチリストの銘柄・価格表示・企業ウィンドウ等のテキストコピーを妨げない。
   （Ctrl+X/V は入力欄外に native な意味がなく、入力欄は 1. でガード済みのため C のみ対応）

3. **Ctrl+R / F5**: `preventDefault()` で Electron 標準のページリロードを抑止し、
   データ更新に振り向ける。

## 付随改善: お気に入りトグルの一本化

現状「銘柄をお気に入りトグル／追加する」処理が複数箇所に重複している:
- `FavoriteStar`（`GridHost.tsx` の★ボタン）
- `ChartContextMenu` の "Add to watchlist"
- 検索まわり（`SearchResults.tsx` / `SearchBar.tsx`）

ショートカットで4つ目の呼び出し元が増えるため、共有ヘルパー **`toggleWatchlist(symbol)`** に抽出し
各所から使う。

**シグネチャ / メタデータ取得元**:

```
toggleWatchlist(symbol: string): void
```

- watched 判定: `selectActiveItems(store).some(w => w.symbol === symbol)`。
- watched なら `store.removeFromWatchlist(symbol)`、未 watched なら `store.addToWatchlist(item)`。
- 追加時の `name` / `exchange` は react-query キャッシュのプロファイルから引く
  （既存 `FavoriteStar` と同じ query key）。キャッシュ未取得なら `symbol` のみで追加し、
  取得済みのメタは後続の描画で反映される（`FavoriteStar` の現挙動を踏襲）。
- ヘルパーは `queryClient` と store 参照を必要とするため、置き場所は
  `src/renderer/lib/watchlist.ts`（純ロジック）＋呼び出し側で `queryClient` を渡す形にする。

これにより `FavoriteStar` / `ChartContextMenu` / 検索まわり / ショートカットが同一経路を通る。

## テスト

純関数 `handleGridShortcut(event, deps)` を、フェイクの `event` / `deps` で直接呼ぶユニットテストを
1つ用意する（実 DOM 不要、既存の `node` Vitest 環境で動く）:
- 各キー（Ctrl+R/F5, Ctrl+D, Ctrl+C/X/V, Delete）が対応する `deps` 操作を呼び、true を返すこと
- 入力欄 / `[role="dialog"]` / `[role="menu"]` 配下の `target` では何もせず false を返すこと
- テキスト選択あり時（`getSelection` 非空）の Ctrl+C が false を返す（素通り）こと
- 余計な修飾キー付き（例: Ctrl+Shift+C）は false を返すこと
- `event.repeat` の変更系キーは false を返すこと

## 対象外（YAGNI）

- ショートカットのユーザーカスタマイズ / 設定画面
- ショートカット一覧のヘルプ表示
- 拡大ウィンドウ・企業ウィンドウへの展開
- 更新以外のヘッダボタン（自動更新トグル・グリッド形状変更等）へのショートカット
