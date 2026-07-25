import React, { useState } from 'react'
import { Stamp, CopyPlus } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { TimeframeRow } from './TimeframeRow'
import { BulkDeleteMenu } from './BulkDeleteMenu'
import { ParamFields } from './ParamFields'
import { registry } from '../indicators/registry'
import { useAppStore } from '../store'
import type { Params } from '@shared/types'

// Volume is fixed/non-addable (D-34) — mirror AddIndicatorMenu's filter.
const ADDABLE = Object.values(registry).filter((m) => m.type !== 'volume')

// Header toolbar: apply one timeframe, or one pre-configured indicator, to every visible grid cell.
export function ApplyToAllToolbar(): React.JSX.Element {
  const setAllTimeframes = useAppStore((s) => s.setAllTimeframes)
  const addIndicatorToAll = useAppStore((s) => s.addIndicatorToAll)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState(ADDABLE[0].type)
  const [params, setParams] = useState<Params>({ ...ADDABLE[0].defaults })

  // Switching indicator type resets params to that module's defaults (fields differ per module).
  const selectType = (t: string): void => {
    setType(t)
    setParams({ ...registry[t].defaults })
  }
  const apply = (): void => {
    addIndicatorToAll(type, params)
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-2">
      <TimeframeRow
        label={
          <span className="flex items-center gap-1">
            <Stamp />
            TF
          </span>
        }
        tooltip="Apply timeframe to all charts"
        onChange={setAllTimeframes}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            className="h-6 gap-1 px-2 text-xs [&_svg]:size-3"
            onClick={() => setOpen(true)}
          >
            <CopyPlus />
            Indicator
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add an indicator to all charts</TooltipContent>
      </Tooltip>
      <BulkDeleteMenu />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Apply indicator to all charts</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-wrap gap-2">
            {ADDABLE.map((m) => (
              <Button
                key={m.type}
                variant={m.type === type ? 'default' : 'secondary'}
                size="sm"
                onClick={() => selectType(m.type)}
              >
                {m.type.toUpperCase()}
              </Button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <ParamFields
              type={type}
              params={params}
              onChange={(patch) => setParams((p) => ({ ...p, ...patch }))}
              onCommit={apply}
            />
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={apply}>Apply to all</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
