import React from 'react'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { registry } from '@shared/indicators/registry'
import { SOURCES } from '@shared/indicators/validate'
import type { FieldDesc } from '@shared/indicators/types'
import type { Params } from '@shared/types'

// Renders the number/select/source fields for registry[type].params as a fragment of rows.
// Color is intentionally NOT rendered here — it lives in instance.colors and is written via a
// separate path (setColor); callers that edit color render it themselves (see IndicatorEditForm).
// onCommit fires on Enter inside a number field so a caller can close a dialog or apply.
export function ParamFields({
  type,
  params,
  onChange,
  onCommit
}: {
  type: string
  params: Params
  onChange: (patch: Params) => void
  onCommit?: () => void
}): React.JSX.Element | null {
  const module = registry[type]
  if (!module) return null

  const renderField = (field: FieldDesc): React.JSX.Element | null => {
    switch (field.kind) {
      case 'number': {
        const value = Number(params[field.key])
        return (
          <Input
            type="number"
            min={field.min}
            step={field.step}
            value={Number.isNaN(value) ? '' : value}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onCommit?.()
              }
            }}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') return
              const parsed = Number(raw)
              if (Number.isNaN(parsed)) return
              const clamped = field.min !== undefined ? Math.max(field.min, parsed) : parsed
              onChange({ [field.key]: clamped })
            }}
          />
        )
      }
      case 'select':
        return (
          <ToggleGroup
            type="single"
            value={String(params[field.key])}
            onValueChange={(v) => { if (v) onChange({ [field.key]: v }) }}
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
            value={String(params[field.key])}
            onValueChange={(v) => { if (v) onChange({ [field.key]: v }) }}
          >
            {SOURCES.map((src) => (
              <ToggleGroupItem key={src} value={src} size="sm">{src}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        )
      case 'color':
        return null // handled by the caller
    }
  }

  return (
    <>
      {module.params.map((field) => {
        const control = renderField(field)
        if (!control) return null
        return (
          <div key={field.key} className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{field.label}</span>
            {control}
          </div>
        )
      })}
    </>
  )
}
