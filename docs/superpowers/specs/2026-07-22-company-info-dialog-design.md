# 会社情報ダイアログ 設計

作成日: 2026-07-22

## 目的

チャートセルを右クリックし、コンテキストメニューの「Show company info」を選ぶと、
その銘柄の会社情報（要点＋市場指標）をダイアログ表示する。

TradingView 相当の「銘柄の会社概要」を、ログイン不要・ローカル完結で提供する。

## スコープ外 (YAGNI)

- サイドパネル/チャート上オーバーレイ表示（ダイアログのみ）。
- CUSIP/ISIN/CIK・住所・電話などの全フィールド（要点＋市場指標に絞る）。
- 会社情報の自動更新・リアルタイム反映（TTL による都度再取得のみ）。

## 用語の注意（既存との衝突回避）

既存の "profile"（`ProfileService` / `symbol_profiles` テーブル / `symbols:profile` IPC）は
**シンボル名解決（symbol → name/exchange）専用**で、本機能とは別物。
本機能は `company` 名前空間（`CompanyInfo` / `company:info` / `company_profiles`）で分離する。

## 1. データ層（main）

### FmpProvider.getCompanyProfile(symbol)
- `GET /stable/profile?symbol=<sym>&apikey=<key>` を叩く。
- 既存 `parseOrThrowHttpError(fmpProfileResponse, rawBody)` でパース
  （error-shaped 200 は `FmpHttpError(200, body)` として既存の分類に乗る）。
- レスポンス配列の先頭を `CompanyInfo` にマップ。空配列は `FmpHttpError(200, rows)`。

### fmp.schema.ts: fmpProfileResponse
- 配列スキーマ。表示対象フィールドのみ定義し、その他は passthrough。
- 数値フィールドは string 混在があるため `z.coerce.number()`。欠損可能な項目は `.nullable()/.optional()`。

### 型: CompanyInfo（@shared/types）
```
symbol, companyName, image, exchange,
sector, industry, country,
marketCap, ceo, fullTimeEmployees, ipoDate, website, description,
beta, range, volume, averageVolume, lastDividend,
fetchedAt   // epoch秒。ダイアログの「YYYY-MM-DD 時点」表記用
```

## 2. キャッシュ（TTL 1日）

### SQLite テーブル company_profiles（db/schema.ts）
```
symbol      TEXT PRIMARY KEY
data        TEXT      -- CompanyInfo(fetchedAt除く) の JSON blob
fetched_at  INTEGER   -- epoch秒
```
JSON blob 一本にしてフィールド追加時のマイグレーションを不要にする。

### db/companyProfileStore.ts
- payload 型 `CompanyProfileData = Omit<CompanyInfo, 'fetchedAt'>`（JSON blob と一致）。
- `getCompanyProfile(symbol): { data: CompanyProfileData; fetchedAt: number } | null`
- `upsertCompanyProfile(symbol, data: CompanyProfileData, fetchedAt): void`（onConflictDoUpdate）
- `fetchedAt` は blob に含めず列で持つ。`CompanyInfo`（`fetchedAt` 込み）への組み立ては `CompanyInfoService` 側で行う。

### CompanyInfoService.getInfo(symbol): Promise<CompanyInfo>
- TTL = 86400 秒（1日）。
- 行あり かつ `now - fetched_at < TTL` → キャッシュを返す（`fetchedAt` 付き）。
- 失効 or 行なし → provider 取得 → upsert(fetched_at = now) → 返す。
- 取得失敗（例外）かつ **stale 行あり → stale を返す**（空表示より良い）。
  行もなければ例外を再送出（ダイアログはエラー表示）。

### IPC
- `CH.companyInfo = 'company:info'`
- `Api.company.info(symbol): Promise<CompanyInfo>`
- preload/index.ts・main/ipc.ts に既存パターンで配線。

## 3. トリガー（renderer）

- 新依存 `@radix-ui/react-context-menu` を導入。
- `components/ui/context-menu.tsx` に shadcn 準拠の薄いラッパを追加（既存 ui/* と同様）。
- `GridCell` のセル内容を `ContextMenu` でラップし、項目 **「Show company info」**（英語ラベル）を表示。
- 選択で `openCompanyInfo(cell.symbol)` を呼ぶ。将来 Remove/timeframe 等の項目もここに集約可能。

## 4. ダイアログ UI（renderer）

### 状態（zustand store）
- `companyInfoSymbol: string | null`
- `openCompanyInfo(symbol)` / `closeCompanyInfo()`

### CompanyInfoDialog（App に常設、既存 dialog.tsx 流用）
- `useQuery(qk.companyInfo(symbol), () => api.company.info(symbol))` で取得。
- レイアウト:
  - ヘッダー: ロゴ（image）＋社名＋ティッカー＋取引所。
  - 属性グリッド（2カラム）: セクター/業種/国/時価総額/CEO/従業員数/上場日/
    beta/52週レンジ/出来高/平均出来高/直近配当。
  - フッター: 事業概要（`line-clamp` で折り畳み）＋公式サイトリンク＋「YYYY-MM-DD 時点」。
- ロード/エラー/未カバー（HTTP 40x）は Chart と同じ文言方針。

## 5. 確認（self-check）

- `CompanyInfoService` の TTL 判定に最小 assert デモ:
  fresh→キャッシュ / stale→再取得 / 取得失敗時 stale フォールバック。

## 実装対象ファイル

新規:
- `src/main/providers/` … fmp.schema.ts へ `fmpProfileResponse` 追記、FmpProvider へ `getCompanyProfile`
- `src/main/db/companyProfileStore.ts`
- `src/main/profile/CompanyInfoService.ts`（既存 profile/ ディレクトリに同居）
- `src/renderer/components/ui/context-menu.tsx`
- `src/renderer/components/CompanyInfoDialog.tsx`

変更:
- `src/main/db/schema.ts`（company_profiles の Drizzle 宣言）
- `src/main/db/client.ts`（**必須**: 既存の生 `CREATE TABLE IF NOT EXISTS` 群に `company_profiles` を追加。Drizzle 宣言はマイグレーションを生成しないため、ここで作らないと `no such table`）
- `src/shared/ipc.ts`（CH.companyInfo, Api.company）
- `src/shared/types.ts`（CompanyInfo）
- `src/main/ipc.ts` / `src/preload/index.ts`（配線）
- `src/renderer/api.ts`（qk.companyInfo, api.company.info）
- `src/renderer/store.ts`（companyInfoSymbol 他）
- `src/renderer/components/GridHost.tsx`（ContextMenu ラップ）
- `src/renderer/App.tsx`（CompanyInfoDialog 常設）
- `package.json`（@radix-ui/react-context-menu）
