import { registry } from './registry'
import type { IndicatorInstance, Params } from '@shared/types'

// D-30: fixed 6-hue dark-theme palette, round-robin assigned by add order. Disjoint from candle
// colors, the app accent, and destructive — see 03-UI-SPEC.md Color section.
export const PALETTE = ['#F5A623', '#A78BFA', '#2DD4BF', '#F472B6', '#FACC15', '#38BDF8']

// Build one IndicatorInstance with palette-assigned colors. `base` = the target cell's current
// indicator count (palette is round-robin by add order). `id` is minted by the caller: the store
// owns a module-level counter, MCP derives one from the persisted collection (MW-05).
// Returns null for an unknown type.
export function makeIndicatorInstance(
  type: string, params: Params, base: number, id: string
): IndicatorInstance | null {
  const module = registry[type]
  if (!module) return null
  const colors: Record<string, string> = {}
  const lineCount = module.outputs.filter((o) => o.kind === 'line').length
  const hasBand = module.outputs.some((o) => o.kind === 'band')
  if (lineCount > 1 && !hasBand) {
    let n = 0
    for (const output of module.outputs) {
      colors[output.key] =
        output.kind === 'line' ? PALETTE[(base + n++) % PALETTE.length] : PALETTE[base % PALETTE.length]
    }
  } else {
    const color = PALETTE[base % PALETTE.length]
    for (const output of module.outputs) colors[output.key] = color
  }
  return { id, type, params: { ...params }, colors, visible: true }
}

// Shallow params equality — same type ⇒ same key set, so key-count + per-key value compare suffices.
export function sameParams(a: Params, b: Params): boolean {
  const ak = Object.keys(a)
  return ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k])
}
