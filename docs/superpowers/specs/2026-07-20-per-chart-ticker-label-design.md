# 各チャートのセルごとコントロール（銘柄ラベル＋削除）

このドキュメントは「セルごとのコントロール」を2件まとめて扱う:

- **A. 銘柄ラベル＋現在値＋騰落率の表示**（各チャートが何の銘柄か一目で分かるように）
- **B. セルのチャート削除**（ブロックを空セルに戻す）

---

## A. 銘柄ラベル＋現在値＋騰落率

## 背景 / 問題

ヘッダー（`App.tsx:109`）は**アクティブなセルの銘柄だけ**を大きく1つ表示する。1x1 では十分だが、2x1 / 2x2 のグリッドでは非アクティブなチャートに銘柄表示が一切無く、どのチャートがどの銘柄か一目で分からない。各チャートをクリックして初めて（＝アクティブにして初めて）ヘッダーで確認できる状態になっている。

## ゴール

どのレイアウトでも、**全チャートが自分の銘柄・現在値・騰落率を常時表示**し、クリック不要で一目で判別できるようにする。

## 決定事項（ブレスト結果）

- ヘッダーの大きな銘柄表示は**削除**する（アクティブなセルは既存の青リング `ring-2 ring-primary` で区別できるため冗長）。
- 銘柄ラベルは各セルのツールバー行（`GridHost.tsx:116`、`TimeframeRow` の左）に置く。
- ラベルは **銘柄 + 現在値 + 騰落率** の3要素。表示専用（クリック編集・検索機能は付けない=YAGNI。検索は既存ヘッダーの `SearchBar` のまま）。

## 表示レイアウト

```
[ AAPL  201.45  +1.23% ]   [1m 5m 15m 1h 1d 1w]   [+ Indicator]
  銘柄   現在値   騰落率         TimeframeRow          AddIndicatorMenu
```

- 銘柄: `text-lg font-semibold`
- 現在値: 右隣に `text-muted-foreground`
- 騰落率: プラス=`text-green-500`、マイナス=`text-red-500`、`+1.23%` / `-0.45%` 形式（`.toFixed(2)`）
- 空セル（"Search a symbol to begin."）は従来どおりツールバーなし

## データロジック

すべて react-query キャッシュ（`qk.ohlcv`）から読む。Chart / capability-gating フックが既に埋めているエントリを再利用する。

### 現在値

- `bars.at(-1).close`（`qk.ohlcv(symbol, timeframe)` を **subscribe-only**〈`enabled: false`〉で購読）
- データ遅延は許容（プロジェクト方針）。「現在値」= 最新の取得済みバーの終値。
- キャッシュが空の間（初回ロード中）は現在値・騰落率を出さず、銘柄名だけ表示。

### 騰落率（基準値 prev の取り方を timeframe で切り替え）

**D / W / M**（日足・週足・月足）→ **前のバーの close**
```
prev = bars.at(-2).close   // 同一timeframeの1本前
```
（週足・月足は日足から派生した集計バー。それぞれ前週比・前月比になる。）

**1m / 5m / 15m / 1h**（intraday）→ **前日の終値（日足キャッシュ基準）**

ブローカー/TradingView と一致させるため、公式の前日終値＝日足の close を基準にする（intraday バーの前日最終プリントでは引け値と微妙にズレるため不採用）。

```
todayDay = floor(bars.at(-1).time / 86400)          // 現在バーのUTC日インデックス
daily    = qk.ohlcv(symbol, '1d') のバー配列
prev = floor(daily.at(-1).time / 86400) === todayDay
         ? daily.at(-2).close   // 日足に今日の(未確定)バーが既にある → その前日
         : daily.at(-1).close   // 今日の日足がまだ無い → 最新日足が前日終値
```

- **intraday セルは日足を1回だけ実フェッチする**（`qk.ohlcv(symbol, '1d')` を `enabled: true, staleTime: Infinity`）。日足が未取得だと騰落率が永遠に出ないため。日足は1銘柄1リクエストで永続キャッシュされ、週足/月足にも再利用されるので「API 節約最優先」とも整合。D/W/M セルは自分のバーで足りるので日足フェッチは行わない。

### 共通

```
pct = (curr - prev) / prev * 100
```
- `prev` が取れない（データが1本しか無い等）場合は騰落率を非表示にし、銘柄+現在値のみ表示。
- 前日終値の後方走査・pct 計算は `useMemo`（依存 `[bars, daily, timeframe]`）で毎レンダー再計算を避ける。

## 実装ノート / エッジケース

- **UTC 日区切り**: 米株の通常セッション（NY 9:30–16:00 = 同一 UTC 日）では安全。実装時に FMP `historical-chart` の返却に after-hours バー（〜翌 01:00 UTC）が混ざるか実データで1回確認する。混ざる場合のみ、日区切りを NY 日付ベースに変更（`date-fns-tz` は既存依存）。
- クロスヘア連動はしない。「現在値」は常に最新バー基準（カーソル位置の値ではない）。

## A. やらないこと（YAGNI）

- 銘柄ラベルのクリック編集・インライン検索
- 前日比の絶対額表示（騰落率=%のみ）
- クロスヘア追従の現在値表示

---

## B. セルのチャート削除（空セルに戻す）

### 背景

セルにチャートを入れる導線（空セルをクリック→アクティブ化→検索で `symbol` が入る）はあるが、**入れたチャートを外して空に戻す導線が無い**。`Cell.symbol` は既に `string | null` で、`null` が空セル（"Search a symbol to begin." 表示）を意味する。つまり空にする仕組みは既存で、必要なのは「symbol を null に戻すアクションとボタン」だけ。

### 決定事項

- チャート削除＝そのブロックを**まっさらな空セルに戻す**。銘柄・指標・クロスヘアはそのチャートに紐づくものなので一緒に消す。
- 全レイアウトで有効（1x1 でも押せる。空ブロックになり、再検索で入れ直せる）。

### 実装

**新規ストアアクション `clearCell(cellId)`（`store.ts`）**
```
clearCell(cellId):
  cells: 対象セルの symbol → null、indicators → []
  crosshairByCell: 対象 cellId のエントリを削除
```

**削除ボタン（`GridHost.tsx` のセルツールバー、`AddIndicatorMenu` の右）**
- lucide `X` アイコン、`ghost` ボタン
- `onClick`: `e.stopPropagation()`（セルクリック=アクティブ化と干渉させない）→ `clearCell(cell.id)`
- `symbol` がある時だけ表示（空セルには出さない）

### B. やらないこと（YAGNI）

- 削除前の確認ダイアログ（誤操作は再検索で戻せるコストなので不要）
- 空セル自体をグリッドから消す（＝レイアウト形状の変更）。形状変更は既存の `GridShapeRow` の責務。

---

## 変更ファイル（3つ）

1. **`src/renderer/App.tsx`**（A）
   - `App.tsx:109` のヘッダー銘柄 `<span>` を削除
   - 未使用になる `activeSymbol` セレクタ（`App.tsx:17`）を削除

2. **`src/renderer/store.ts`**（B）
   - `clearCell(cellId)` アクションを追加（型定義＋実装）

3. **`src/renderer/components/GridHost.tsx`**（A + B）
   - A: セルのツールバー行に `SymbolLabel`（同ファイル内の小コンポーネント、新規ファイルなし）を `TimeframeRow` の左に追加。subscribe-only の ohlcv クエリ（＋intraday時は日足クエリ）で現在値・騰落率を算出して表示
   - B: ツールバー行の `AddIndicatorMenu` の右に削除ボタン（`X`）を追加
