# 出来高チャート リファクタ 設計

**日付:** 2026-07-20
**対象:** 出来高ヒストグラムペイン（`volume` インジケータ）

## 目的

出来高チャートの2つの見づらさを解消する。

1. 出来高の軸目盛りが桁数過多で読みづらい（例 `12,450,200`）→ K/M/B 短縮表記にする。
2. 価格ペインと出来高ペインの境目が分かりにくい → 区切り線を明るくする。

## 決定事項

- 軸表記フォーマット: **小数2桁の短縮**（`12.45M`）。
- クロスヘアの凡例（レジェンド）の出来高: **フル桁のまま**（`12,450,200`）。軸のみ短縮する。
- 境目: **区切り線 (`separatorColor`) を明るくする**（最小変更）。

## 変更内容

### 1. 軸ラベルの K/M/B 短縮（小数2桁）

- `src/renderer/indicators/types.ts`: histogram の `OutputMeta` に任意フィールドを追加。
  ```ts
  | { key: string; kind: 'histogram'; priceFormat?: (v: number) => string }
  ```
- `src/renderer/indicators/volume.ts`: 短縮フォーマッタを定義し、volume 出力に宣言。
  ```ts
  function abbreviate(v: number): string {
    const abs = Math.abs(v)
    if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B'
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M'
    if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'K'
    return String(Math.round(v))
  }
  ```
  出力: `outputs: [{ key: 'volume', kind: 'histogram', priceFormat: abbreviate }]`
- `src/renderer/components/Chart.tsx`（現 297 行の histogram 生成箇所）: `output.priceFormat` があれば
  `priceFormat: { type: 'custom', minMove: 1, formatter: output.priceFormat }` を `addSeries` オプションに渡す。
  これで軸ティックとクロスヘアの価格ラベルのみ短縮される。

### 2. 凡例は変更なし

`volume.ts` の `formatReadout`（`toLocaleString('en-US')`）は据え置き。凡例はフル桁 `12,450,200` を維持。

### 3. 影響範囲の限定

MACD ヒストグラムは `priceFormat` を宣言しないため、`Chart.tsx` の分岐で影響を受けない（従来通りデフォルト表示）。

### 4. ペインの境目

`src/renderer/components/Chart.tsx`（現 83 行）:
`panes: { separatorColor: '#151920', ... }` の `separatorColor` を `'#2A2F3A'` に変更（グリッド色とテキスト色の中間）。`separatorHoverColor` は据え置き。

## テスト

`tests/indicators/volume.test.ts` に abbreviate の assert を追加:

- `12450200 → "12.45M"`
- `1234 → "1.23K"`
- `950 → "950"`
- `3.4e9 → "3.40B"`

## 想定される期待値の変換例

| 入力 | 軸表記 | 凡例 |
|------|--------|------|
| 1,234 | `1.23K` | `1,234` |
| 12,450,200 | `12.45M` | `12,450,200` |
| 3,400,000,000 | `3.40B` | `3,400,000,000` |
| 950 | `950` | `950` |
