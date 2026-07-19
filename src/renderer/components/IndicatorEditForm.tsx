import React from 'react'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { registry } from '@/indicators/registry'
import type { FieldDesc, Source } from '@/indicators/types'

const SOURCES: Source[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3']

// D-25: this form renders purely from registry[type].params (FieldDesc[]) — no per-indicator
// branching. Adding a new indicator module (e.g. BB) requires zero changes here.
export function IndicatorEditForm({
  instanceId,
  open,
  onOpenChange
}: {
  instanceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element | null {
  const instance = useAppStore((s) => s.indicators.find((i) => i.id === instanceId))
  const updateParams = useAppStore((s) => s.updateParams)
  const setColor = useAppStore((s) => s.setColor)

  if (!instance) return null
  const module = registry[instance.type]
  if (!module) return null

  const renderField = (field: FieldDesc): React.JSX.Element => {
    switch (field.kind) {
      case 'number': {
        const value = Number(instance.params[field.key])
        return (
          <Input
            type="number"
            min={field.min}
            step={field.step}
            value={Number.isNaN(value) ? '' : value}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') return
              const parsed = Number(raw)
              if (Number.isNaN(parsed)) return
              const clamped = field.min !== undefined ? Math.max(field.min, parsed) : parsed
              updateParams(instance.id, { [field.key]: clamped })
            }}
          />
        )
      }
      case 'select':
        return (
          <ToggleGroup
            type="single"
            value={String(instance.params[field.key])}
            onValueChange={(v) => { if (v) updateParams(instance.id, { [field.key]: v }) }}
          >
            {field.options.map((opt) => (
              <ToggleGroupItem key={opt} value={opt} size="sm">{opt}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        )
      case 'source':
        return (
          <ToggleGroup
            type="single"
            value={String(instance.params[field.key])}
            onValueChange={(v) => { if (v) updateParams(instance.id, { [field.key]: v }) }}
          >
            {SOURCES.map((src) => (
              <ToggleGroupItem key={src} value={src} size="sm">{src}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        )
      case 'color': {
        // AMBIGUITY RESOLUTION: one shared hue per instance (D-30), not per output key. Read/write
        // via the module's first output key; onChange fans out to every output so all lines + any
        // band recolor together in one interaction.
        const firstOutputKey = module.outputs[0]?.key
        const value = firstOutputKey ? instance.colors[firstOutputKey] ?? '#ffffff' : '#ffffff'
        return (
          <input
            type="color"
            value={value}
            onChange={(e) => {
              for (const output of module.outputs) {
                setColor(instance.id, output.key, e.target.value)
              }
            }}
          />
        )
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-6">
        <DialogHeader>
          <DialogTitle>{module.label(instance.params)}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
          {module.params.map((field) => (
            <div key={field.key} className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{field.label}</span>
              {renderField(field)}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
