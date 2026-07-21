# Settings ダイアログ構成 設計

## 目的

設定項目が今後増える前提で、**カテゴリの追加・項目の付け替えが容易**な settings ダイアログの器を作る。今は項目が少ない(テーマ / APIキー)が、配置をJSX直書きにせずデータ駆動にすることで、後からの再編を小さな差分で済ませる。

この設計はツールバー調整スペック(`2026-07-21-toolbar-adjustments-design.md`)のセクション4「テーマ切替」を包含・具体化する。テーマとAPIキーの機能内容自体は同スペックの通りで、本スペックは**それらをどう収める器か**を定める。

## レイアウト

左ナビ(縦タブ)＋右コンテンツの2ペイン(TradingView/VSCode風)。

- 起動トリガーは歯車アイコン(`lucide-react` の `Settings`、`variant="ghost" size="icon"` + tooltip)。※ツールバースペックと同一。
- `DialogContent` を横長にする(左ナビ + 右ペインが並ぶ幅)。
- 左ナビ = セクション一覧。選択中セクションの `id` を `useState` で保持(初期は最初のセクション)。
- 右ペイン = 選択中セクションに属する項目を縦に並べる。

## 拡張しやすさの肝：宣言的レジストリ

項目の所属カテゴリを**データ**で持ち、描画はそこから行う。`SettingsDialog.tsx` 内(またはすぐ隣)に定義する。

```ts
// セクション定義(左ナビ)。カテゴリ追加はここに1エントリ足すだけ。
const SECTIONS = [{ id: 'general', label: 'General' }] as const

// 設定項目。section を書き換えるだけで付け替え可能。
const ITEMS = [
  { id: 'theme',  section: 'general', render: () => <ThemeSetting /> },
  { id: 'apikey', section: 'general', render: () => <ApiKeySetting /> },
]
```

- 左ナビ = `SECTIONS.map(...)`。
- 右ペイン = `ITEMS.filter((i) => i.section === active).map((i) => <div key={i.id}>{i.render()}</div>)`。
- **カテゴリ追加** = `SECTIONS` に1エントリ追加。
- **項目の付け替え** = その項目の `section` 文字列を変えるだけ(JSXは触らない)。
- **項目の並び順** = `ITEMS` 内の順序。
- 空カテゴリは作らない(YAGNI)。今は `general` 1つのみ。左ナビは1項目だけ表示される(器としては正しい)。

`section` は `SECTIONS` の `id` を指す。型で縛る場合は `section: (typeof SECTIONS)[number]['id']`。存在しない `id` を指す項目はどのペインにも出ない(実装時に目視で担保、テスト対象外の単純ミス)。

## 項目のコンポーネント分割

現在 `SettingsDialog` に直書きされているUIを、項目ごとの自己完結コンポーネントに切り出す。

- `ThemeSetting` — Light/Dark/System トグル。選択で `<html>` の `.dark` を更新し `api.settings.setTheme` で永続化(ツールバースペック参照)。
- `ApiKeySetting` — APIキーの入力/保存/削除、暗号化非対応の警告 alert、保存時の関連クエリ invalidate(現行 `SettingsDialog` のロジックをそのまま移設)。加えて**保存済みキーのマスク表示**(下記)。
- `SettingsDialog` — 器に専念: Dialog + 歯車トリガー + 左ナビ + レジストリ描画。個々の設定ロジックは持たない。

各項目コンポーネントは自身の state / IPC 呼び出しを内部で完結させ、`SettingsDialog` から props は受け取らない(またはダイアログ open 状態のみ)。これにより項目の追加・移動が他項目に影響しない。

### 保存済みAPIキーのマスク表示

保存後、入力ボックスの上に「どのキーを設定したか」が分かるマスク済みプレビューを薄字で表示する(例: `保存済み: ••••••AAAA`)。

- **末尾4文字のみ実文字**、前はドットでマスク。ドット数は実キー長に合わせる(全体の文字数がAPIキーと同じ)。
- 実装は `keystore.getKeyStatus()` を拡張し、戻り値に `maskedKey?: string` を追加:
  - キーが復号取得できる(`getApiKey()` が非 null)とき: `key.length > 4 ? '•'.repeat(key.length - 4) + key.slice(-4) : '•'.repeat(key.length)`(4文字以下は全長ぶんマスク)。
  - 暗号化非対応でファイルが読めない等、実キーを取得できない場合は `maskedKey` を返さない(`hasKey: true` のみ)。UI は「保存済み(内容表示不可)」の従来挙動。
- IPC / preload / `api.apikey.status` の戻り型に `maskedKey?: string` を追加。`CapabilityStatus` 等とは別の apikey status 型。
- `ApiKeySetting` は open 時に `api.apikey.status()` を読み、`maskedKey` があれば入力ボックス上に表示。保存・削除後は再取得して更新。

## スコープ外(YAGNI)

- 空の将来カテゴリ(Appearance/Chart 等)の事前追加はしない。項目が来たときに `SECTIONS` へ足す。
- 設定検索、キーボードナビゲーション、カテゴリの折りたたみは入れない。
- レジストリを別ファイル/プラグイン機構に一般化しない。1ファイル内の2定数で足りる。

## 変更ファイル

- `src/renderer/components/SettingsDialog.tsx` — 器化(Dialog + 左ナビ + レジストリ描画)
- `src/renderer/components/settings/ThemeSetting.tsx`(新規) — テーマ項目
- `src/renderer/components/settings/ApiKeySetting.tsx`(新規) — APIキー項目 + マスク表示
- `src/main/keystore.ts` — `getKeyStatus` に `maskedKey?` 追加
- `src/main/ipc.ts` / `src/preload/index.ts` / `src/renderer/api.ts` — `apikey.status` 戻り型に `maskedKey?` 追加

テーマ永続化(`settings.ts` / preload / ipc の `theme`)と CSS の light/dark 分離はツールバースペックの担当。
