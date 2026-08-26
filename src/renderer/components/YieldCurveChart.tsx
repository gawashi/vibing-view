// src/renderer/components/YieldCurveChart.tsx
import React from 'react'
import { MATURITIES } from '@shared/treasury'
import { curveSegments, formatRate } from '@/lib/treasuryCurve'
import type { TreasuryCurvePoint } from '@shared/types'

// 断面は自前 SVG。横軸が満期（等間隔、YC-07）なので lightweight-charts の時間軸に乗らない。
// 点は 12 個 × 最大 4 本なので DOM に直接置いても軽い。
// ponytail: viewBox 固定 + preserveAspectRatio 既定（meet）。コンテナを実測して座標を作らないので
// 極端に横長な窓では上下に余白が出る。気になったら ResizeObserver で幅を取る。
const W = 720
const H = 260
const PAD = { top: 14, right: 16, bottom: 26, left: 40 }

// 新しい順に実線 → 破線 → 点線 → 一点鎖線。色は --primary 1 色で不透明度を落とす（YC-06:
// 比較日は「最新 vs より古い」の順序尺度なので、カテゴリカルな色分けより順序が読める。
// テーマトークンを増やさずに済む）。
const DASHES = ['', '6 4', '2 3', '9 3 2 3']
const OPACITIES = [1, 0.75, 0.55, 0.4]

const TICKS = 4

export function YieldCurveChart({ curves }: { curves: TreasuryCurvePoint[] }): React.JSX.Element {
  const values = curves.flatMap((c) =>
    MATURITIES.map((m) => c.rates[m.key]).filter((v): v is number => v != null)
  )
  // 上下 0.1pt の余白。1 点しか無い（lo === hi）ときも高さが 0 にならない。
  const min = (values.length > 0 ? Math.min(...values) : 0) - 0.1
  const max = (values.length > 0 ? Math.max(...values) : 1) + 0.1

  const x = (i: number): number => PAD.left + (i * (W - PAD.left - PAD.right)) / (MATURITIES.length - 1)
  const y = (v: number): number => PAD.top + ((max - v) * (H - PAD.top - PAD.bottom)) / (max - min)
  const ticks = Array.from({ length: TICKS }, (_, i) => min + ((max - min) * i) / (TICKS - 1))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Treasury yield curve">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.left - 5} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {formatRate(t)}
          </text>
        </g>
      ))}
      {MATURITIES.map((m, i) => (
        <text key={m.key} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[9px]">
          {m.label}
        </text>
      ))}
      {curves.map((c, ci) => {
        const segments = curveSegments(c)
        const opacity = OPACITIES[ci] ?? 0.3
        return (
          <g key={c.date}>
            {segments.map((seg, si) => (
              <polyline
                key={si}
                points={seg.map((d) => `${x(d.index)},${y(d.value)}`).join(' ')}
                className="stroke-primary"
                fill="none"
                strokeWidth={2}
                strokeOpacity={opacity}
                strokeDasharray={DASHES[ci] ?? ''}
                strokeLinecap="round"
              />
            ))}
            {/* 点ごとの <title> = ブラウザネイティブのツールチップ。クロスヘアや hover 状態は
                入れない — 点が 12 個しかなく、正確な値は下の表で読める。 */}
            {segments.flat().map((d) => (
              <circle key={d.key} cx={x(d.index)} cy={y(d.value)} r={2.5} className="fill-primary" fillOpacity={opacity}>
                <title>{`${c.date} ${d.label} ${formatRate(d.value)}%`}</title>
              </circle>
            ))}
          </g>
        )
      })}
    </svg>
  )
}
