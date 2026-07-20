import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock, Clock, ChevronDown } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import type { Timeframe } from '@shared/types'
import type { CapabilityStatus } from '@shared/ipc'

// Fixed literal order, never data-driven (UI-SPEC: zero-one-many, fixed set of exactly 7).
export const TF_LABELS: Record<Timeframe, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '1d': 'D', '1w': 'W', '1M': 'M'
}
const TIMEFRAMES = Object.keys(TF_LABELS) as Timeframe[]

const GATED_TOOLTIP: Record<'requires-plan' | 'rate-limited', string> = {
  'requires-plan': "Requires a paid FMP plan. Your current key doesn't support this timeframe.",
  'rate-limited': 'Daily request limit reached for this timeframe. Resets tomorrow — cached data (if any) stays available.'
}

// '1w'/'1M' are derived from cached daily bars, never fetched — always available (DESIGN-ADDENDUM §2).
function statusFor(tf: Timeframe, caps: Partial<Record<Timeframe, CapabilityStatus>> | undefined): CapabilityStatus {
  if (tf === '1w' || tf === '1M') return 'available'
  return caps?.[tf] ?? 'available' // optimistic: undefined probe (in-flight or not-yet-run) = available
}

// Collapsed timeframe picker: the trigger shows only the current timeframe (all-7 buttons wasted
// horizontal space in a 2x2 cell). The menu lists every timeframe; gated ones stay disabled with a
// Lock/Clock icon and a native `title` hint (a radix Tooltip inside a DropdownMenu fights the menu's
// own hover/focus handling — the title attribute is the lazy, correct fit here).
export function TimeframeRow({
  value,
  onChange
}: {
  value: Timeframe
  onChange: (tf: Timeframe) => void
}): React.JSX.Element {
  // Last-known + revalidate (UI-SPEC): TanStack retains previous `data` across a failed/in-flight
  // refetch, so caps.isError never blanks the row — it just keeps the last successful map.
  const caps = useQuery({ queryKey: qk.capabilities(), queryFn: () => api.capabilities.get() })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="h-6 gap-1 px-2 text-xs [&_svg]:size-3">
          {TF_LABELS[value]}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[6rem]">
        {TIMEFRAMES.map((tf) => {
          const status = statusFor(tf, caps.data)
          const gated = status === 'requires-plan' || status === 'rate-limited' ? status : null
          const Icon = gated === 'requires-plan' ? Lock : Clock
          return (
            <DropdownMenuItem
              key={tf}
              disabled={!!gated}
              title={gated ? GATED_TOOLTIP[gated] : undefined}
              className={cn('text-sm', tf === value && 'font-semibold text-accent-foreground')}
              onClick={() => onChange(tf)}
            >
              {TF_LABELS[tf]}
              {gated && <Icon className="ml-auto h-3 w-3" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
