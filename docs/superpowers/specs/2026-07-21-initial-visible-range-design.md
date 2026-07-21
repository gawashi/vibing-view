# チャート初期表示範囲を timeframe ごとに固定する

## 背景 / 目的

現状、チャートを開く（= symbol または timeframe を切り替える）と `timeScale().fitContent()`
で読み込み済みの全バーをビューに収めている（`Chart.tsx:238`）。日足で数年分キャッシュが
あると全体が潰れて見づらい。timeframe ごとに「直近 N 本」を初期表示し、TradingView に近い
一定の見た目を出す。

## 決定事項

- **本数（バー数）ベース**で固定する。データの粗密・休場に左右されず見た目が安定する。
  カレンダー期間ベースは採らない。
- 初期表示本数マップ:

  | Timeframe | 本数 | 期間感 |
  |-----------|------|--------|
  | 1m  | 120 | 約2時間 |
  | 5m  | 120 | 約10時間 |
  | 15m | 120 | 約1.5日 |
  | 1h  | 150 | 約1週間 |
  | 1d  | 120 | 約半年 |
  | 1w  | 104 | 約2年 |
  | 1M  | 60  | 約5年 |

## 実装

変更は `src/renderer/components/Chart.tsx` の1箇所のみ。

1. モジュール定数を追加:

   ```ts
   const INITIAL_BARS: Record<Timeframe, number> = {
     '1m': 120, '5m': 120, '15m': 120,
     '1h': 150, '1d': 120, '1w': 104, '1M': 60,
   }
   ```

   `Record<Timeframe, number>` により全 timeframe 網羅は型で保証される。

2. データ push 効果内の「初回のみビューをリセット」ブロック（現 `Chart.tsx:236-239`）を置換:

   ```ts
   if (lastKeyRef.current !== key) {
     lastKeyRef.current = key
     const n = INITIAL_BARS[timeframe]
     const len = bars.length
     if (len > n) {
       chartRef.current?.timeScale().setVisibleLogicalRange({ from: len - n, to: len - 1 })
     } else {
       chartRef.current?.timeScale().fitContent() // 本数不足時は全表示にフォールバック
     }
   }
   ```

## 非干渉 / エッジケース

- **本数不足**（`len <= n`）: `fitContent()` にフォールバックし、左に空白を出さない。
- **gap-fetch（左パンで過去取得）**: 初期ビューが狭くなるだけ。`q.data` には全キャッシュが
  入っており、左スクロールでまずキャッシュ済みバーを辿り、論理インデックス端（`range.from <= 1`）
  に達したら従来どおり fetch が走る。ロジック変更なし。
- **右端**: 最新バー（`to: len-1`）。既存 rightOffset はそのまま。
- gap-fetch のマージは同一キーの `q.data` 更新であり `lastKeyRef` は変わらないため、
  ビューリセットは走らない（ユーザーのパン位置を飛ばさない）。既存挙動を維持。

## テスト

`len > n` / `len <= n` の分岐を確認する最小のアサートベース自己チェックを1本。
本数マップの網羅は型チェックで担保するため別途テスト不要。
