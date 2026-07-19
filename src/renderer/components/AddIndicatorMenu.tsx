import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from './ui/button'
import { registry } from '../indicators/registry'
import { useAppStore } from '../store'

// Plain button + inline menu (DESIGN §6 — no dropdown-menu/popover dependency for 2 items).
// Menu items are derived from `registry` so a newly-registered module needs zero edits here (IND-01).
export function AddIndicatorMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const addIndicator = useAppStore((s) => s.addIndicator)

  return (
    <div className="relative">
      <Button onClick={() => setOpen((v) => !v)}>
        <Plus />
        Indicator
      </Button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-md border border-border bg-card p-2 shadow-md">
          {Object.values(registry).map((module) => (
            <button
              key={module.type}
              className="rounded px-2 py-1 text-left text-sm hover:bg-accent"
              onClick={() => {
                addIndicator(module.type)
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
