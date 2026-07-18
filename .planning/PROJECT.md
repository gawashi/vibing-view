# 自作チャートアプリ（TradingView 代替 / 作業名: trading-view）

## What This Is

TradingView の有料機能を、**制限なし・広告なし・ログイン不要**で使える自作の Windows デスクトップアプリ（TypeScript + React）。FMP（Financial Modeling Prep）から米国株・暗号資産の価格データを取得してローカルに永続キャッシュし、ローソク足に加えて移動平均・ボリンジャーバンド・出来高・RSI・MACD などの指標を**自由に重ねて**表示する。まず自分用、次に身内・少人数（各自が自分の FMP キーを設定）で使う。

## Core Value

**自分の手元で、制限なく、好きなだけチャートを並べて指標を重ねられること。** TradingView の完全再現ではなく、無料プランで邪魔だったもの（指標数の上限・複数チャートの制限・広告/ログイン・データ制限）が一切ない環境を持つこと。これが崩れたら意味がない。

## Requirements

### Validated

<!-- 出荷して価値が確認できたもの。 -->

(まだなし — 出荷して検証する)

### Active

<!-- 現在のスコープ。これに向けて作る。すべて出荷まで仮説。 -->

- [ ] 銘柄（米国株・暗号資産）を検索して選べる
- [ ] ローソク足チャートを表示できる（1分/5分/15分/1時間/日/週/月）
- [ ] 指標を自由にトグルで重ねられる（移動平均・ボリンジャーバンド・出来高・RSI・MACD）
- [ ] 指標のパラメータ（期間など）を変更できる
- [ ] 新しい指標を後から追加できるよう、指標システムを抽象化しておく
- [ ] 十字カーソル（クロスヘア）で価格・時刻を読み取れる
- [ ] 複数チャート／レイアウトを並べて表示できる
- [ ] ウォッチリスト（銘柄リスト）を管理できる
- [ ] チャート構成・レイアウトを保存し、次回復元できる
- [ ] 取得した価格データをローカルに永続キャッシュし、再取得を避ける（API 節約が主目的）
- [ ] FMP 以外のデータプロバイダを後から追加できるよう、データソース層を抽象化しておく
- [ ] ダークテーマで表示する

### Out of Scope

<!-- 明示的な境界。理由付きで、後から蒸し返さないため。 -->

- 日本株 — FMP のカバレッジが弱い。v1 は米国株・暗号資産に絞る（将来、別データソース併用で対応の可能性）
- リアルタイム（数秒単位）ストリーミング配信 — 分足・時間足も遅延 OK のため WebSocket 配信は作らない。手動更新＋キャッシュで足りる
- 描画ツール（トレンドライン等） — v1 では見送り、将来対応
- 価格アラート／通知 — v1 では見送り
- 認証サーバー・マルチユーザー管理 — 各自が自分の FMP キーを使うため不要
- 一般公開・配布ストア対応 — v1 は身内・少人数での共有まで

## Context

- ユーザーは TradingView 無料プランの制限（指標数の上限、複数チャート/レイアウトの制限、広告・重さ・要ログイン、データ制限）に不満があり、その全部を解消したい。
- データ源は FMP。米国株・暗号資産が得意。日本株（東証）は取得が不安定なため v1 では対象外。
- 開発中は FMP 無料枠で進め、アプリが実用になってきた段階で有料プランに登録する想定 → 無料枠の制限（分足取得の制限など）でアプリが壊れない設計にする必要がある。
- 使い方は「分足・時間足も見るが遅延 OK」。ザラ場のリアルタイム監視は想定しない。
- 配布は身内・少人数。各自が自分の FMP API キーを設定して使う。

## Constraints

- **Tech stack**: TypeScript + React — ユーザー指定
- **Platform**: Windows デスクトップアプリ — ユーザー指定（デスクトップの器は Electron / Tauri を研究フェーズで決定）
- **Data source**: FMP（Financial Modeling Prep） — ただしプロバイダ層を抽象化し、他 API を後から追加可能に
- **Data freshness**: 分足・時間足も扱うが遅延 OK — リアルタイム配信は不要
- **Cost**: 開発中は FMP 無料枠 → 実用段階で有料へ。無料枠のレート制限・取得制限で破綻しない設計
- **Persistence**: 取得済み価格データはローカルに永続保管し再取得しない（API 節約が最優先）
- **Distribution**: 身内・少人数。API キーは各インストールでユーザー自身が設定

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1 は米国株・暗号資産に限定、日本株は後回し | FMP の日本株カバレッジが弱く、単一データソースで完成度を上げるため | — Pending |
| リアルタイム配信は作らず手動更新＋キャッシュ | 遅延 OK の使い方で、WebSocket 配信の複雑さが不要 | — Pending |
| 指標システムとデータソース層を最初から抽象化 | 指標・API を後から差し込めるようにしたい（ユーザー明示要望）。ただし v1 中身は FMP＋指定指標に限定 | — Pending |
| 取得データはすべて永続キャッシュ | API 節約が主目的 | — Pending |
| デスクトップの器（Electron vs Tauri）は研究フェーズで決定 | 早すぎる技術固定を避け、TS+React・配布・サイズ要件から選ぶ | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-18 after initialization*
