import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from './ui/button'
import { registry } from '../indicators/registry'
import { useAppStore } from '../store'

// Plain button + inline menu (DESIGN §6 — no dropdown-menu/popover dependency for 2 items).
// Menu items are derived from `registry` so a newly-registered module needs zero edits here (IND-01).
export function AddIndicatorMenu({ cellId }: { cellId?: string } = {}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const addIndicator = useAppStore((s) => s.addIndicator)

  return (
    <div className="relative">
      <Button
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="h-6 gap-1 px-2 text-xs [&_svg]:size-3"
      >
        <Plus />
        Indicator
      </Button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-md border border-border bg-card p-2 shadow-md">
          {Object.values(registry)
            .filter((module) => module.type !== 'volume') // D-34: Volume is fixed, not addable via menu
            .map((module) => (
            <button
              key={module.type}
              className="rounded px-2 py-1 text-left text-sm hover:bg-accent"
              onClick={() => {
                addIndicator(module.type, cellId)
                setOpen(false)
              }}
            >
              {module.type.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
