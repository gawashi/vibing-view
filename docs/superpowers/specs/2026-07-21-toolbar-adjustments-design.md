# ツールバー調整 設計

## 目的

ヘッダーのツールバーを使いやすく調整する。4つの独立した変更:

1. 更新ボタンを検索ボックスの左へ移動
2. 銘柄検索を会社名でもヒットするように
3. 検索候補の表示件数を増やす
4. Settings にテーマ切替(ライト/ダーク)を追加

## 1. ツールバー並び替え

**現状** (`App.tsx`): 更新ボタン(`RefreshCw`)はヘッダー左端、サイドバートグルの直後。検索ボックス(`SearchBar`)と `SettingsDialog` は右端の `ml-auto` グループ。

**変更**: 更新ボタンを右側グループへ移動し、並び順を `[更新] [SearchBar] [Settings]` にする。左側グループはサイドバートグル・`GridShapeRow`・`LayoutMenu` のみ残す。ボタンの見た目・挙動(`handleReload`, `reloading` スピナー, tooltip)は変更なし。JSX の位置だけ移す。

## 2. 会社名検索(2エンドポイント併用)

**現状** (`FmpProvider.searchSymbols`): FMP の `search-symbol` のみ呼ぶ。これはティッカー一致専用で、会社名(例: "Apple")ではヒットしない。

**変更**: `search-symbol`(ティッカー) と `search-name`(会社名) を `Promise.all` で並列に呼び、結果を `symbol` で重複排除してマージする。

- 両レスポンスとも既存の `fmpSearchResponse` スキーマ(zod)でパース(同一形状)。
- マージ順は search-symbol 優先(完全一致ティッカーを上に)。dedup は `Set<symbol>` で先勝ち。
- 検索は `searchCache`(クエリ単位のメモリキャッシュ, TTL付き)を通るため、追加のAPI消費は一意クエリごとに一度だけ。
- 片方が失敗(rate-limit等)しても、もう片方の結果は返す(`Promise.allSettled` で fulfilled のみ採用)。両方失敗時のみ throw。

## 3. 候補件数を増やす(スクロールで段階表示)

**現状**: API `limit=8`、かつ `SearchResults` で `results.slice(0, 8)`。二重に8件で絞られている。

**変更**: 一度に多めに取得し、クライアント側で段階的に開示する(スクロールでのAPI追加取得はしない — API消費を増やさないため)。

- 両エンドポイントの `limit=8` → `limit=50`(併用マージで最大~100件を1クエリで取得, `searchCache` にキャッシュ)。
- `SearchResults` に `visibleCount` state(初期15)を持たせる。`slice(0, 8)` → `slice(0, visibleCount)`。
- リスト(`max-h-[280px] overflow-y-auto`)の `onScroll` で末尾付近(残り数十px)まで来たら `visibleCount += 15`。上限は `results.length`(取得済み件数)。
- `results` が変わったら(新しい検索)`useEffect` で `visibleCount` を15にリセット。
- 取得済み件数を超えるスクロールでは何もしない(追加ネットワーク無し)。

## 4. テーマ切替(Settings機能強化)

> ダイアログの器(左ナビ/レジストリ、歯車トリガー、項目のコンポーネント分割)は
> `2026-07-21-settings-dialog-structure-design.md` を参照。本節はテーマ機能そのもの
> (CSS パレット・永続化・適用ロジック)を定める。

**現状**: `index.css` は `:root, .dark` が同一のダーク値のみを持つダーク固定。

**変更**:

### CSS
- `index.css` にライトパレットを定義。`:root` = ライト値、`.dark` = 現状のダーク値、に分離する。
- ライトパレットは既存のダーク配色に対応する明色を割り当てる(背景=白系、テキスト=濃色、アクセント `#2E7DE1` は据え置き)。

### 永続化
- `settings.ts` に `getTheme()` / `setTheme(t)` を追加。値は `'light' | 'dark' | 'system'`、既定は `'system'`。
- `settings.json` の `theme` フィールドに保存。preload/api にIPC を1本追加。

### 適用(renderer)
- 起動時に `api.settings.getTheme()` を読み、`'system'` なら `window.matchMedia('(prefers-color-scheme: dark)')` で解決して `<html>` に `.dark` クラスを付け外し。IPC 越しのネイティブ判定は不要。
- `SettingsDialog` に Light / Dark / System の3択トグルを追加。選択で即座に `<html>` のクラスを更新し、`setTheme` で永続化。

### トリガーを歯車アイコンに
- `SettingsDialog` の `DialogTrigger` を `<Button variant="secondary">Settings</Button>` から歯車アイコンボタンに変更(`lucide-react` の `Settings` アイコン、更新ボタンと揃えて `variant="ghost" size="icon"` + `aria-label="Settings"` + tooltip "Settings")。

## スコープ外(YAGNI)

- キャッシュ容量管理・検索件数の設定化・データソース設定は今回やらない(将来別スペック)。
- テーマの `system` 選択中に OS 設定がライブ変更されたときの自動追従(mediaQuery の change リスナー)は入れない。起動時解決のみ。必要になれば追加。

## 変更ファイル

- `src/renderer/App.tsx` — 更新ボタン移動 / 起動時テーマ適用
- `src/main/providers/FmpProvider.ts` — search 2エンドポイント併用, limit
- `src/renderer/components/SearchResults.tsx` — slice件数
- `src/renderer/components/SettingsDialog.tsx` — テーマトグル
- `src/renderer/index.css` — light/dark パレット分離
- `src/main/settings.ts` + preload/api/ipc — theme 永続化
