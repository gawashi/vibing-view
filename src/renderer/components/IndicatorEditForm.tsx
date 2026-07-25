import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { registry } from '@/indicators/registry'
import { ParamFields } from './ParamFields'

// D-25: renders purely from registry[type].params. ParamFields covers number/select/source;
// color stays here because it writes to instance.colors via setColor (fanned across every output),
// not to params. Color is the last field in every module's params array, so appending its row after
// ParamFields preserves the original top-to-bottom field order.
export function IndicatorEditForm({
  instanceId,
  open,
  onOpenChange
}: {
  instanceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element | null {
  const instance = useAppStore((s) => s.cells.flatMap((c) => c.indicators).find((i) => i.id === instanceId))
  const updateParams = useAppStore((s) => s.updateParams)
  const setColor = useAppStore((s) => s.setColor)

  if (!instance) return null
  const module = registry[instance.type]
  if (!module) return null

  const colorField = module.params.find((f) => f.kind === 'color')
  const firstOutputKey = module.outputs[0]?.key
  const colorValue = firstOutputKey ? instance.colors[firstOutputKey] ?? '#ffffff' : '#ffffff'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-6">
        <DialogHeader>
          <DialogTitle>{module.label(instance.params)}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
          <ParamFields
            type={instance.type}
            params={instance.params}
            onChange={(patch) => updateParams(instance.id, patch)}
            onCommit={() => onOpenChange(false)}
          />
          {colorField && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{colorField.label}</span>
              <input
                type="color"
                value={colorValue}
                onChange={(e) => {
                  for (const output of module.outputs) setColor(instance.id, output.key, e.target.value)
                }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
