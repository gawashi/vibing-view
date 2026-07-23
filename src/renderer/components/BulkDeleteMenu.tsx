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
import { BULK_DELETE, type BulkTarget } from './bulkDelete'

// Trash dropdown: the "clear all" counterpart to ApplyToAllToolbar's "apply to all". Two items →
// one reused confirm dialog → the store mutation chosen by BULK_DELETE[target].
export function BulkDeleteMenu(): React.JSX.Element {
  const [target, setTarget] = useState<BulkTarget | null>(null)
  const clearAllCells = useAppStore((s) => s.clearAllCells)
  const removeAllIndicators = useAppStore((s) => s.removeAllIndicators)

  const confirm = (): void => {
    if (target) BULK_DELETE[target].action({ clearAllCells, removeAllIndicators })()
    setTarget(null)
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
          <DropdownMenuItem onClick={() => setTarget('charts')}>Clear all charts</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTarget('indicators')}>Clear all indicators</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>{target ? BULK_DELETE[target].title : ''}</DialogTitle>
            <DialogDescription>{target ? BULK_DELETE[target].description : ''}</DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirm}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
