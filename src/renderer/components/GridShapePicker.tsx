import React, { useRef, useState } from 'react'
import { Grid2x2 } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'

const DIMS = [1, 2, 3] // グリッド上限 3x3

export function GridShapePicker(): React.JSX.Element {
  const shape = useAppStore((s) => s.shape)
  const setShape = useAppStore((s) => s.setShape)
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // ホバー中はホバー先、非ホバー時は現在のシェイプをハイライト＆ラベル表示。
  const preview = hover ?? shape

  return (
    <Popover onOpenChange={(open) => !open && setHover(null)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Grid layout">
              <Grid2x2 className="h-4 w-4" />
              <span className="text-xs tabular-nums">{shape.cols}×{shape.rows}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Grid layout</TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-auto"
        onMouseLeave={() => setHover(null)}
        // Radix は既定で最初のセル(1×1)へ自動フォーカスし、その onFocus が preview を
        // 1×1 に上書きしてしまう。開いた瞬間は現在のシェイプに合わせてフォーカスさせる
        // ことで誤プレビューを防ぎつつ、フォーカスをポップオーバー内に留めキーボード操作を維持する。
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          gridRef.current
            ?.querySelector<HTMLButtonElement>(`[data-cell="${shape.rows}-${shape.cols}"]`)
            ?.focus()
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div ref={gridRef} className="grid grid-cols-3 gap-1">
            {DIMS.flatMap((r) =>
              DIMS.map((c) => {
                const on = r <= preview.rows && c <= preview.cols
                return (
                  <PopoverClose asChild key={`${r}-${c}`}>
                    <button
                      type="button"
                      data-cell={`${r}-${c}`}
                      aria-label={`${c} columns by ${r} rows`}
                      onMouseEnter={() => setHover({ rows: r, cols: c })}
                      onFocus={() => setHover({ rows: r, cols: c })}
                      onClick={() => setShape({ rows: r, cols: c })}
                      className={cn(
                        'h-6 w-6 rounded-sm border transition-colors',
                        on ? 'border-primary bg-primary/30' : 'border-border bg-muted'
                      )}
                    />
                  </PopoverClose>
                )
              })
            )}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {preview.cols} × {preview.rows}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
