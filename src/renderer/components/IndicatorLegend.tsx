import React, { useState } from 'react'
import { Eye, EyeOff, Settings2, X } from 'lucide-react'
import { registry } from '../indicators/registry'
import { useAppStore, type CrosshairValues } from '../store'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { IndicatorEditForm } from './IndicatorEditForm'

// Stable empty-crosshair fallback — a fresh `{}` in the selector would return a new reference every
// render, tripping useSyncExternalStore's getSnapshot cache and looping forever (zustand v5).
const EMPTY_CROSSHAIR: CrosshairValues = {}

// Fallback readout for modules without a formatReadout hook (ma/bb/rsi): first output, 2 decimals.
function defaultReadout(v: Record<string, number>): string {
  const n = Object.values(v)[0]
  return typeof n === 'number' ? n.toFixed(2) : ''
}

// One legend per pane (UI-SPEC E2, D-37/38): absolutely positioned at its pane's top-left by
// Chart.tsx (via `style`), bg-card/80, capped at ~50% height with internal scroll. Renders the
// instances of that pane plus its crosshair readout — the price pane also shows the OHLC row.
// E2 overflow: never fully covers the chart no matter how many instances stack.
export function IndicatorLegend({
  cellId,
  instanceIds,
  isPricePane,
  style
}: {
  cellId: string
  instanceIds: string[]
  isPricePane: boolean
  style: React.CSSProperties
}): React.JSX.Element | null {
  // Select the stable `cells` reference and flatten in render — a selector returning
  // `flatMap(...)` yields a fresh array every call and loops useSyncExternalStore forever.
  const cells = useAppStore((s) => s.cells)
  const indicators = cells.flatMap((c) => c.indicators)
  const crosshair = useAppStore((s) => s.crosshairByCell[cellId] ?? EMPTY_CROSSHAIR)
  const toggleVisible = useAppStore((s) => s.toggleVisible)
  const removeIndicator = useAppStore((s) => s.removeIndicator)
  const [editingId, setEditingId] = useState<string | null>(null)

  const rows = indicators.filter((i) => instanceIds.includes(i.id))
  const price = crosshair.price
  const showPrice = isPricePane && price !== undefined && 'open' in price
  if (rows.length === 0 && !showPrice) return null

  return (
    <>
      <div className="absolute z-10 max-h-[50%] overflow-y-auto rounded bg-card/80 p-2 text-xs" style={style}>
        {showPrice && (
          // D-39/DD-3: OHLC four values only, no percent-change.
          <div className="flex items-center gap-2 whitespace-nowrap py-0.5 text-muted-foreground">
            <span>O {price.open.toFixed(2)}</span>
            <span>H {price.high.toFixed(2)}</span>
            <span>L {price.low.toFixed(2)}</span>
            <span>C {price.close.toFixed(2)}</span>
          </div>
        )}
        {rows.map((inst) => {
          const module = registry[inst.type]
          if (!module) return null
          const color = Object.values(inst.colors)[0]
          // Instance ids map to a per-output readout record ('open' in v ⇒ it's the price OHLC, skip).
          const v = crosshair[inst.id]
          const readout = v && !('open' in v) ? v : {}
          const text = module.formatReadout
            ? module.formatReadout(readout, inst.params)
            : defaultReadout(readout)
          return (
            <div key={inst.id} className="flex items-center gap-1 whitespace-nowrap py-0.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className={inst.visible ? 'text-foreground' : 'text-muted-foreground'}>
                {module.label(inst.params)}
              </span>
              {text && <span className="text-muted-foreground">{text}</span>}
              {!inst.fixed && (
              <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={inst.visible ? 'Hide' : 'Show'}
                    onClick={() => toggleVisible(inst.id)}
                  >
                    {inst.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{inst.visible ? 'Hide' : 'Show'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label="Edit parameters"
                    onClick={() => setEditingId(inst.id)}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit parameters</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:text-[#E5484D] focus-visible:text-[#E5484D]"
                    aria-label="Remove"
                    // Deliberate exception (UI-SPEC Copywriting Contract): single-click delete, no
                    // confirmation dialog — removal is trivially reversible via re-add.
                    onClick={() => removeIndicator(inst.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
              </Tooltip>
              </>
              )}
            </div>
          )
        })}
      </div>
      {editingId !== null && (
        <IndicatorEditForm
          instanceId={editingId}
          open={editingId !== null}
          onOpenChange={(o) => { if (!o) setEditingId(null) }}
        />
      )}
    </>
  )
}
