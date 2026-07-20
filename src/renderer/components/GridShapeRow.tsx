import React from 'react'
import { Square, Columns2, Grid2x2 } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { GridShape } from '@shared/types'

// Fixed literal order, icon-only (UI-SPEC Icon Usage, D-52) — never data-driven.
const SHAPES: { value: GridShape; label: string; Icon: typeof Square }[] = [
  { value: '1x1', label: '1x1', Icon: Square },
  { value: '2x1', label: '2x1', Icon: Columns2 },
  { value: '2x2', label: '2x2', Icon: Grid2x2 }
]

export function GridShapeRow(): React.JSX.Element {
  const shape = useAppStore((s) => s.shape)
  const setShape = useAppStore((s) => s.setShape)

  return (
    <ToggleGroup
      type="single"
      value={shape}
      onValueChange={(v) => { if (v) setShape(v as GridShape) }}
      className="gap-1 rounded-md bg-card p-1"
    >
      {SHAPES.map(({ value, label, Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={value} size="sm" aria-label={label}>
              <Icon className="h-4 w-4" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}
