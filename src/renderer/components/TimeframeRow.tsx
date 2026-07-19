import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock, Clock } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, qk } from '@/api'
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
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => { if (v) onChange(v as Timeframe) }}
      className="justify-start gap-1 rounded-md bg-card p-2"
    >
      {TIMEFRAMES.map((tf) => {
        const status = statusFor(tf, caps.data)
        // Narrow to the gated union so GATED_TOOLTIP/icon are type-safe; null = selectable.
        const gated = status === 'requires-plan' || status === 'rate-limited' ? status : null
        const Icon = gated === 'requires-plan' ? Lock : Clock
        const item = (
          <ToggleGroupItem
            value={tf}
            size="sm"
            disabled={!!gated}
            className={gated ? 'text-[#8B92A0]' : undefined}
          >
            {TF_LABELS[tf]}
            {gated && <Icon className="ml-1 h-3 w-3" />}
          </ToggleGroupItem>
        )
        // A disabled <button> emits no hover events, so the tooltip trigger must live on a
        // non-disabled <span> wrapping the item (standard shadcn "tooltip on disabled" pattern).
        return gated
          ? (
            <Tooltip key={tf}>
              <TooltipTrigger asChild>
                <span className="inline-flex">{item}</span>
              </TooltipTrigger>
              <TooltipContent>{GATED_TOOLTIP[gated]}</TooltipContent>
            </Tooltip>
            )
          : <React.Fragment key={tf}>{item}</React.Fragment>
      })}
    </ToggleGroup>
  )
}
