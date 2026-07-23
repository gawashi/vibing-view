import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { useAppStore } from '../store'

// Trash dropdown: the "clear all" counterpart to ApplyToAllToolbar's "apply to all". Each item pairs
// its confirm copy with the store mutation it runs, so charts↔indicators can't be swapped.
export function BulkDeleteMenu(): React.JSX.Element {
  const clearAllCells = useAppStore((s) => s.clearAllCells)
  const removeAllIndicators = useAppStore((s) => s.removeAllIndicators)

  const items = [
    {
      label: 'Clear all charts',
      title: 'Clear all charts?',
      description:
        "This removes the symbol and all user-added indicators from every cell in this workspace, including hidden cells. This can't be undone.",
      run: clearAllCells
    },
    {
      label: 'Clear all indicators',
      title: 'Clear all indicators?',
      description:
        "This removes all user-added indicators from every cell in this workspace, including hidden cells. Symbols and volume are kept. This can't be undone.",
      run: removeAllIndicators
    }
  ]
  type Item = (typeof items)[number]
  const [active, setActive] = useState<Item | null>(null)

  const confirm = (): void => {
    active?.run()
    setActive(null)
  }

  return (
    <>
      {/* modal={false}: avoid body pointer-events lock when a menu item opens the confirm Dialog. */}
      <DropdownMenu modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 [&_svg]:size-3.5"
                aria-label="Bulk delete"
              >
                <Trash2 />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Clear all charts or indicators</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          {items.map((item) => (
            <DropdownMenuItem key={item.label} onClick={() => setActive(item)}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={active !== null} onOpenChange={(o) => { if (!o) setActive(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>{active?.title ?? ''}</DialogTitle>
            <DialogDescription>{active?.description ?? ''}</DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setActive(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirm}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
