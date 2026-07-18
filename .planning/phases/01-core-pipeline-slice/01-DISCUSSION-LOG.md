# Phase 1: Core Pipeline Slice - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-19
**Phase:** 1-Core Pipeline Slice
**Areas discussed:** 銘柄検索の挙動とAPI消費, FMPキーの初回入力フロー, 起動時の初期表示・空状態, 日足の取得レンジ戦略

---

## 銘柄検索の挙動とAPI消費

| Option | Description | Selected |
|--------|-------------|----------|
| 確定検索＋結果キャッシュ | Enter/ボタンで確定、同一クエリは短期キャッシュ。API消費最小 | ✓ |
| デバウンス付き逐次検索 | 打鍵中に候補表示。UX良いがquota消費増 | |
| ローカル銘柄マスタで検索 | 初回DL/同梱でオフライン検索、FMP消費ゼロだが仕組み増 | |

**User's choice:** 確定検索＋結果キャッシュ
**Notes:** API節約が最優先という方針に沿った選択。打鍵ごとのリクエストは避ける。

---

## FMPキーの初回入力フロー

| Option | Description | Selected |
|--------|-------------|----------|
| 設定画面＋safeStorage暗号化 | mainでElectron safeStorage暗号化、userData保管、UI非露出、IPC経由のみ使用 | ✓ |
| 設定画面＋平文JSON | userData配下に平文保管。最小実装 | |
| 初回起動モーダル必須入力 | 未設定なら起動時モーダルで必須入力 | |

**User's choice:** 設定画面＋safeStorage暗号化
**Notes:** キーはレンダラー/devtools非露出、main内でのみ使用。safeStorage非対応環境では安全側に警告デグレード（無言平文フォールバックしない）。

---

## 起動時の初期表示・空状態

| Option | Description | Selected |
|--------|-------------|----------|
| 既定銘柄を表示 | 起動時にAAPL等を出す。最小実装 | |
| 前回の銘柄を軽く覚える | 最後の銘柄のみelectron-storeに記録し復元 | ✓ |
| 空チャート＋プレースホルダ | 「銘柄を検索」空状態。FMP非叩きで起動 | |

**User's choice:** 前回の銘柄を軽く覚える
**Notes:** P5のレイアウト永続とは別の最小記録。初回（記録なし）は既定銘柄にフォールバック。

---

## 日足の取得レンジ戦略

| Option | Description | Selected |
|--------|-------------|----------|
| 全履歴を一度に取得 | 日足EODは1リクエストで全期間。初回一括取得、以降再取得なし。カバレッジは[最古,最新]区間 | ✓ |
| 直近N年の窓（例5年） | 初回は数年、パン時に追加取得（P2） | |
| 最小（直近1年等） | 短期だけ取得、必要時拡張。リクエスト増でAPI節約と逆行 | |

**User's choice:** 全履歴を一度に取得
**Notes:** 長期的にAPI消費最小。[最古,最新]区間モデルがP2のパン時ギャップ取得の土台になる。

---

## Claude's Discretion

- ダークテーマの具体パレット
- 検索結果キャッシュのTTL/保管方式（インメモリ想定）
- IPCチャンネル設計・drizzleテーブル定義の具体形
- 既定フォールバック銘柄の最終選定（AAPL想定）
- FMPレスポンスのzod検証スキーマ具体形

## Deferred Ideas

- 時間軸切替・パン/ズーム・無料枠デグレード → Phase 2
- MA/BBオーバーレイ・pluggable指標 → Phase 3
- Volume/RSI/MACDサブペイン・十字カーソル同期・TV一致計算 → Phase 4
- レイアウトグリッド・保存/復元・ウォッチリスト → Phase 5
