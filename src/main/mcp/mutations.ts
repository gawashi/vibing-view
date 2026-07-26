import { z } from 'zod'
import { TIMEFRAMES, type Params } from '@shared/types'
import { defaultParams, indicatorCatalog, validateParams } from '@shared/indicators/validate'
import { ADDABLE } from '@shared/indicators/registry'
import type { ToolCore, ToolDef, ToolHandler } from './tools'
import { ok, fail } from './format'
import {
  addIndicator, removeIndicator, setChart, setGridLayout, updateIndicator, pickWorkspace
} from './edits'
import { formatCells, formatGrid, formatInstanceDetail } from './formatEdits'

export const workspaceArg = z.string().min(1).optional()
  .describe('Exact workspace name, as listed by get_workspaces. Omit for the one the user has open.')
const cellArg = z.string().min(1)
  .describe('A cell id from get_workspace, or "all" for every VISIBLE cell (rows x cols).')

const HEX = /^#[0-9a-fA-F]{6}$/

const setChartArgs = z.object({
  workspace: workspaceArg,
  cell: cellArg,
  symbol: z.string().min(1).nullable().optional()
    .describe('Ticker to place in the cell. Pass null to empty it (user indicators go, Volume stays).'),
  timeframe: z.enum(TIMEFRAMES).optional().describe('Bar size for the cell.')
})

const setGridArgs = z.object({
  workspace: workspaceArg,
  rows: z.number().int().min(1).max(3).describe('Visible grid rows, 1-3.'),
  cols: z.number().int().min(1).max(3).describe('Visible grid columns, 1-3.')
})

const paramsArg = z.record(z.union([z.number(), z.string()])).optional()

const addIndicatorArgs = z.object({
  workspace: workspaceArg,
  cell: cellArg,
  type: z.string().min(1).describe(`Indicator type. Available: ${indicatorCatalog()}`),
  params: paramsArg.describe('Only the parameters you want to override; the rest use the defaults.')
})

const updateIndicatorArgs = z.object({
  workspace: workspaceArg,
  indicator: z.string().min(1).describe('Indicator instance id, as printed by get_workspace.'),
  params: paramsArg.describe('Merged over the current params; omitted keys keep their value.'),
  visible: z.boolean().optional().describe('Show or hide the indicator without removing it.'),
  color: z.string().optional().describe('Hex colour like #1e90ff. Applied to every output of the indicator.')
})

const removeIndicatorArgs = z.object({
  workspace: workspaceArg,
  indicator: z.string().min(1).optional().describe('Remove exactly this instance.'),
  cell: z.string().min(1).optional()
    .describe('Remove every non-fixed indicator from this cell, or from every visible cell with "all".')
})

// The tool layer resolves symbols BEFORE calling mutate, because mutate is synchronous (MW-04).
async function resolveSymbol(core: ToolCore, symbol: string): Promise<string | null> {
  const profile = await core.symbols.profile(symbol)
  // ProfileService collapses "no match" and "request failed" into exchange: '' (MW-07).
  return profile.exchange === '' ? null : profile.symbol.toUpperCase()
}

export const UNRESOLVED = (symbol: string): string =>
  `Could not resolve "${symbol}" — check the ticker with search_symbols, or confirm the FMP API key is set.`

export function buildMutationTools(core: ToolCore): ToolDef[] {
  const setChartHandler: ToolHandler = async (raw) => {
    const parsed = setChartArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { workspace, cell, timeframe } = parsed.data
    const symbol = parsed.data.symbol
    if (symbol === undefined && timeframe === undefined) return fail('Pass symbol, timeframe, or both.')
    if (cell === 'all' && typeof symbol === 'string') {
      return fail('cell: "all" cannot set a symbol — pass a cell id, or symbol: null to clear every chart.')
    }

    let resolved: string | null | undefined = symbol === undefined ? undefined : null
    if (typeof symbol === 'string') {
      resolved = await resolveSymbol(core, symbol)
      if (resolved === null) return fail(UNRESOLVED(symbol))
    }

    const result = core.workspaces.mutate((c) =>
      setChart(c, { workspace, cell, symbol: resolved, timeframe })
    )
    if (!result.ok) return fail(result.message)
    const body = formatCells(result.value.workspaceName, result.value.cells)
    return ok(result.value.hidden
      ? `${body}\nnote: this cell is hidden at the current grid size — call set_grid_layout to show it.`
      : body)
  }

  const setGridHandler: ToolHandler = async (raw) => {
    const parsed = setGridArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const result = core.workspaces.mutate((c) => setGridLayout(c, parsed.data))
    if (!result.ok) return fail(result.message)
    return ok(formatGrid(result.value.workspaceName, result.value.shape, result.value.visible))
  }

  const addIndicatorHandler: ToolHandler = async (raw) => {
    const parsed = addIndicatorArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { workspace, cell, type } = parsed.data
    const check = validateParams(type, parsed.data.params ?? {})
    if (!check.ok) return fail(check.message)
    // A fixed indicator is already in every cell; adding a second (removable) copy would contradict
    // both the renderer's menus and remove_indicator's "cannot be removed" contract (D-34).
    if (!ADDABLE.some((m) => m.type === type)) {
      return fail(`${type} is always on and cannot be added — every cell already has it.`)
    }
    const params: Params = { ...defaultParams(type), ...check.params }

    const result = core.workspaces.mutate((c) => addIndicator(c, { workspace, cell, type, params }))
    if (!result.ok) return fail(result.message)
    const { added, skipped, workspaceName } = result.value
    if (added.length === 0) return ok(`Nothing added — every target cell already has that ${type}.`)
    const lines = added.map((a) => `- cell [${a.cellId}]: [${a.instance.id}] ${type}`)
    const tail = skipped > 0 ? [`(${skipped} cell(s) already had it)`] : []
    return ok([`Added to workspace "${workspaceName}":`, ...lines, ...tail].join('\n'))
  }

  const updateIndicatorHandler: ToolHandler = async (raw) => {
    const parsed = updateIndicatorArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { workspace, indicator, visible, color } = parsed.data
    if (parsed.data.params === undefined && visible === undefined && color === undefined) {
      return fail('Pass params, visible, or color.')
    }
    if (color !== undefined && !HEX.test(color)) return fail('color must be a hex value like #1e90ff.')

    // The type is only known after the instance is found, so params are validated inside mutate's
    // editor call — do it in two steps: locate first, then validate, then write.
    const found = pickWorkspace(core.workspaces.get().collection, workspace)
      ?.layout.cells.flatMap((cell) => cell.indicators).find((i) => i.id === indicator)
    if (found && parsed.data.params) {
      const check = validateParams(found.type, parsed.data.params)
      if (!check.ok) return fail(check.message)
    }

    const result = core.workspaces.mutate((c) =>
      updateIndicator(c, { workspace, indicator, params: parsed.data.params, visible, color })
    )
    if (!result.ok) return fail(result.message)
    return ok(formatInstanceDetail(result.value.cellId, result.value.instance))
  }

  const removeIndicatorHandler: ToolHandler = async (raw) => {
    const parsed = removeIndicatorArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { workspace, indicator, cell } = parsed.data
    if (indicator !== undefined && cell !== undefined) return fail('Pass either indicator or cell, not both.')
    if (indicator === undefined && cell === undefined) return fail('Pass either indicator or cell.')

    const result = core.workspaces.mutate((c) => removeIndicator(c, { workspace, indicator, cell }))
    if (!result.ok) return fail(result.message)
    const { removed, keptFixed, workspaceName } = result.value
    const fixedNote = keptFixed > 0 ? `, kept ${keptFixed} fixed (Volume cannot be removed)` : ''
    return ok(`Removed ${removed} indicator(s) from workspace "${workspaceName}"${fixedNote}.`)
  }

  return [
    {
      name: 'set_chart',
      description: 'Put a symbol into a grid cell, change its timeframe, or empty it. A cell is one chart. Costs one API request only when the symbol has never been resolved before. Use get_workspace first to read the cell ids.',
      schema: setChartArgs,
      handler: setChartHandler
    },
    {
      name: 'set_grid_layout',
      description: 'Set how many chart slots are visible (rows x cols, up to 3x3). Cells beyond the visible count are kept but hidden, so shrinking never loses a chart. No API request.',
      schema: setGridArgs,
      handler: setGridHandler
    },
    {
      name: 'add_indicator',
      description: `Add an indicator to a cell. Omitted parameters use the module defaults. Available: ${indicatorCatalog()}. Colour is assigned from the palette; change it with update_indicator. No API request.`,
      schema: addIndicatorArgs,
      handler: addIndicatorHandler
    },
    {
      name: 'update_indicator',
      description: 'Change an indicator instance: merge parameters, show/hide it, or set its colour. Takes the instance id printed by get_workspace. No API request.',
      schema: updateIndicatorArgs,
      handler: updateIndicatorHandler
    },
    {
      name: 'remove_indicator',
      description: 'Remove one indicator instance, or every non-fixed indicator from a cell. The always-on Volume indicator cannot be removed. No API request.',
      schema: removeIndicatorArgs,
      handler: removeIndicatorHandler
    }
  ]
}
