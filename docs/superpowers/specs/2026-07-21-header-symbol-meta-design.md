# ヘッダーへの社名・取引所表示＋お気に入り星ボタン — 設計

## 目的

各グリッドセルのヘッダー（`GridHost.tsx` の `SymbolLabel`）に、ティッカーコードに加えて **取引所名・社名** を表示し、さらに **お気に入り（ウォッチリスト）追加/削除の星ボタン** を置く。

表示イメージ：

```
AAPL · NASDAQ   Apple Inc.        232.14  +1.20%   ☆
```

## 背景と核心

現状 `Cell` は `symbol: string | null` しか保持しておらず、社名・取引所は検索結果（`SymbolResult { symbol, name, exchange }`）にしか存在しない。ヘッダーに社名・取引所を出すにも、星でウォッチリストへ追加するにも `{ symbol, name, exchange }` が必要。

したがって両機能は「**あるティッカーの社名・取引所を知る**」という単一の必要性に帰着する。そこで **銘柄プロファイル・リゾルバ（永続キャッシュ付き）** を1本追加し、ヘッダー表示と星ボタンの双方がそれを共有する。

設計方針は OHLCV と同じ read-through：**銘柄あたり最大1回だけフェッチし、以後は無通信**（CLAUDE.md「API節約が最優先」に準拠）。`Cell` のスキーマは変更しない（ワークスペースのマイグレーション不要）。

## アーキテクチャ

```
Header (SymbolLabel) ─┐
                      ├─ useQuery(qk.profile(symbol)) → api.symbols.profile
Star button ──────────┘                                      │
                                                     IPC: symbols:profile
                                                             │
                                                    ProfileService (read-through)
                                                       │            │
                                          symbol_profiles (SQLite)  FmpProvider.searchSymbols
```

### バックエンド

#### 1. SQLite テーブル `symbol_profiles`

`src/main/db/schema.ts` に追加：

| column   | type | 備考 |
|----------|------|------|
| `symbol` | text（PK） | ティッカー |
| `name`   | text | 社名 |
| `exchange` | text | 取引所名 |

OHLCV と同じ「フェッチ済みデータを永続キャッシュ」の考え方。ユーザ設定ではなく取得データなので JSON ではなく SQLite に置く（CLAUDE.md の区分に準拠）。書き込み/読み出しは `barStore` と同様のモジュール（`profileStore`）に置く。

#### 2. `ProfileService`（read-through リゾルバ）

`src/main/profile/ProfileService.ts`（`CacheService` のテスト様式に倣う。`{ provider, store }` を注入）。

`getProfile(symbol)` の分岐：

1. **キャッシュヒット** → 無通信で返す。
2. **一時的失敗**（APIキー未設定、または `searchSymbols` が通信・HTTPエラーを投げた）→ フォールバック `{ symbol, name: symbol, exchange: '' }` を返す。**キャッシュには書かない。** 後で取得可能になったとき、次回は「真のミス」として再フェッチされる（キャッシュ汚染の防止）。
3. **正常応答**（`searchSymbols(symbol)` が成功）：
   - `symbol` 完全一致（大文字小文字を無視）の行があれば、それを **書き込み＋返す**。
   - 完全一致なしなら、フォールバック `{ symbol, name: symbol, exchange: '' }` を **書き込み＋返す**（正常応答で名前が無いことが確定した稀なケース。無駄な再フェッチを防ぐため永続キャッシュしてよい）。

ミス時のフェッチは既存の `FmpProvider.searchSymbols(symbol)` を再利用する（プロバイダに新メソッドを追加しない）。

#### 3. 検索結果によるキャッシュ種まき

`ipc.ts` の `symbols:search` ハンドラが返す各 `SymbolResult` を `symbol_profiles` に upsert する。→ 検索で選択した銘柄は **追加のAPIフェッチ0回** で社名・取引所が確定（Q1「検索選択時に保存」の意図を達成）。

#### 4. 新 IPC `symbols:profile`

- `src/shared/ipc.ts`：`CH.symbolsProfile = 'symbols:profile'` と `Api.symbols.profile(symbol): Promise<SymbolResult>` を追加。
- `src/preload/index.ts`：`profile: (symbol) => ipcRenderer.invoke(CH.symbolsProfile, symbol)`。
- `src/main/ipc.ts`：`ProfileService.getProfile(symbol)` を呼ぶハンドラを登録。`ProfileService` は `symbolsSearch` と同様、呼び出し毎に `getApiKey()` を見て `FmpProvider` を構築する（キー未設定でも例外を投げず、キャッシュ or フォールバックを返す）。

### フロントエンド

#### 5. query key

`src/renderer/api.ts` の `qk` に追加：

```ts
profile: (symbol: string) => ['profile', symbol] as const
```

`staleTime: Infinity`（プロファイルはほぼ不変。以後の再取得は invalidate 契機のみ）。

#### 6. ヘッダー `SymbolLabel`（`GridHost.tsx`）

- `useQuery(qk.profile(symbol))` で `{ name, exchange }` を取得。
- 表示レイアウト：

  ```
  AAPL · NASDAQ   Apple Inc.        232.14  +1.20%   ☆
  ```

  - ティッカー：`text-lg font-semibold`（現状維持）。
  - 取引所：ティッカー直後に `· NASDAQ` を `text-muted-foreground`。`exchange` が空なら非表示。
  - 社名：その隣に `text-sm text-muted-foreground` + `truncate`。`name === symbol`（フォールバック）なら非表示。
  - 現在値・騰落率：現状の `computeChange` 表示を維持。
  - 狭い2x2セルでは既存の `flex-wrap`（`GridCell` のツールバー行）に従い、溢れたら折り返す。

#### 7. 星ボタン（ヘッダー）

- 配置：ヘッダー行の右側、× ボタンの手前。
- 実装は `SearchResults.tsx` の星を踏襲（`lucide-react` の `Star`、Tooltip 付き）：
  - `watched = selectActiveItems(store).some((w) => w.symbol === symbol)`。
  - watched → 塗り星（`fill-current`、`text-primary`）、クリックで `removeFromWatchlist(symbol)`。
  - 未追加 → 空星、クリックで `addToWatchlist({ symbol, name, exchange })`（`name`/`exchange` はプロファイルから。フォールバック時は `name = symbol`, `exchange = ''`）。
  - `e.stopPropagation()` でセルのアクティブ化クリックと干渉させない。
- store のアクション（`addToWatchlist` / `removeFromWatchlist`）は既存のまま再利用（変更なし）。サイドバーの星（`SearchResults`）とヘッダーの星は同じアクションを叩くので、状態は常に一致する。

#### 8. キー登録時の再クエリ

`SettingsDialog.save()` の既存 invalidate に1行追加：

```ts
void queryClient.invalidateQueries({ queryKey: ['profile'] })
```

→ Save 直後にヘッダーの `profile` クエリが再実行される。一時失敗のフォールバックはキャッシュに書いていないため「ミス」扱いとなり、そのままフェッチ→社名・取引所が反映（ユーザ操作は Save のみ、リロード不要）。

## データフローとエッジケース

| シナリオ | 挙動 |
|----------|------|
| 検索→銘柄選択 | 種まき済みなので `profile` は無通信ヒット。社名・取引所を即表示。 |
| デフォルト AAPL / 旧レイアウト復元 | 初回だけ `profile` ミス→1回フェッチ→永続保存。以後は無通信。 |
| APIキー未設定 / オフライン | キャッシュに無ければ一時フォールバック（ティッカーのみ表示）。**キャッシュに書かない**。 |
| キー未設定→キー登録 | `SettingsDialog.save()` の `['profile']` invalidate で再クエリ→フェッチ→反映。 |
| 実在しないティッカー等（正常応答で一致なし） | フォールバックを永続キャッシュ（再フェッチ抑止）。 |
| 星の対象 | 既存仕様どおり「アクティブなウォッチリスト」。ヘッダー星とサイドバー星は同じ store アクションで常に一致。 |

## テスト（TDD）

- `ProfileService`：
  - キャッシュヒット → 無通信（provider 未呼び出し）。
  - ミス（正常応答・完全一致あり）→ 1フェッチ＋書き込み＋返却。
  - 完全一致の大文字小文字無視選択。
  - 一時的失敗（キー無し / provider が throw）→ フォールバック返却かつ **未書き込み**。
  - 正常応答・一致なし → フォールバックを **書き込み**。
- 検索種まき：`symbols:search` 経由で以後 `profile` がヒットすること。
- store の watchlist アクションは変更なし（既存テストで担保）。ヘッダー星は同一アクションの再利用のため、重い UI テストは追加しない。

## 非対象（YAGNI）

- `Cell` スキーマへの `name`/`exchange` 追加（キャッシュで代替、マイグレーション不要）。
- FMP `/profile` 専用エンドポイントの利用（`searchSymbols` の再利用で足りる）。
- プロファイルの TTL / 定期リフレッシュ（社名・取引所はほぼ不変）。
