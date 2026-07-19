import React, { useState } from 'react'
import { Eye, EyeOff, Settings2, X } from 'lucide-react'
import { registry } from '../indicators/registry'
import { useAppStore } from '../store'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { IndicatorEditForm } from './IndicatorEditForm'

// Absolute top-left overlay (UI-SPEC E2): top:8px left:8px, bg-card/80. Renders nothing at zero
// instances — the "+ Indicator" button is the sole always-visible entry point (Copywriting Contract).
// E2 overflow (user decision): capped at ~50% of the chart canvas, scrolls internally so the
// chart is never fully covered no matter how many instances stack.
export function IndicatorLegend(): React.JSX.Element | null {
  const indicators = useAppStore((s) => s.indicators)
  const toggleVisible = useAppStore((s) => s.toggleVisible)
  const removeIndicator = useAppStore((s) => s.removeIndicator)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (indicators.length === 0) return null

  return (
    <>
      <div className="absolute left-2 top-2 z-10 max-h-[50%] overflow-y-auto rounded bg-card/80 p-2 text-xs">
        {indicators.map((inst) => {
          const module = registry[inst.type]
          if (!module) return null
          const color = Object.values(inst.colors)[0]
          return (
            <div key={inst.id} className="flex items-center gap-1 whitespace-nowrap py-0.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className={inst.visible ? 'text-[#E4E7EB]' : 'text-muted-foreground'}>
                {module.label(inst.params)}
              </span>
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
