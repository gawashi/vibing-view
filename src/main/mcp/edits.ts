import { cellCount, defaultLayout, newCellSeed } from '@shared/workspace'
import type { Cell, GridShape, IndicatorInstance, Layout, Params, Timeframe, Workspace, WatchlistItem, WorkspaceCollection } from '@shared/types'
import { registry } from '@shared/indicators/registry'
import { makeIndicatorInstance, sameParams } from '@shared/indicators/instance'
import { validateParams } from '@shared/indicators/validate'

// Every editor is a pure collection -> collection function so core.workspaces.mutate can run the
// whole read-modify-write inside one synchronous call (MW-04). `value` carries whatever the tool
// layer needs to format its response, so nothing has to diff the collection afterwards.
export type EditResult<T> =
  | { ok: true; collection: WorkspaceCollection; value: T }
  | { ok: false; message: string }

export const editFail = <T>(message: string): EditResult<T> => ({ ok: false, message })
export const editOk = <T>(collection: WorkspaceCollection, value: T): EditResult<T> =>
  ({ ok: true, collection, value })

const numericId = (id: string): number => parseInt(id, 10) || 0 // NaN (a non-numeric id) -> 0

// MW-05: mint from "highest numeric id + 1". The renderer's store reseeds its own counter past
// every loaded id on hydrate, so ids minted here can never collide with ids it mints later. A
// custom prefix (mcp-1) would be invisible to that reseed and eventually collide.
export function makeIdMinter(c: WorkspaceCollection): () => string {
  let next = 1
  for (const w of c.workspaces) {
    for (const cell of w.layout.cells) {
      next = Math.max(next, numericId(cell.id) + 1)
      for (const inst of cell.indicators) next = Math.max(next, numericId(inst.id) + 1)
    }
  }
  return () => String(next++)
}

export function pickWorkspace(c: WorkspaceCollection, name?: string): Workspace | undefined {
  return c.workspaces.find((w) => w.name === (name ?? c.active))
}

// Same wording as get_workspace's error so the model sees one consistent message (spec: エラー処理).
export function missingWorkspace(c: WorkspaceCollection, name?: string): string {
  const wanted = name ?? c.active
  return `No workspace named "${wanted}". Available: ${c.workspaces.map((w) => w.name).join(', ')}`
}

// Cells past rows*cols are kept in the array (a shrink never truncates) but are not on screen.
export const visibleCells = (w: Workspace): Cell[] => w.layout.cells.slice(0, cellCount(w.layout.shape))

// A cell id, or 'all' for every VISIBLE cell (MW-08). Returns the failure message when nothing hits.
function resolveTargets(w: Workspace, cell: string): { ids: Set<string> } | { message: string } {
  const targets = cell === 'all' ? visibleCells(w) : w.layout.cells.filter((x) => x.id === cell)
  if (targets.length === 0) {
    return { message: `No cell "${cell}" in workspace "${w.name}". Cells: ${w.layout.cells.map((x) => x.id).join(', ')}.` }
  }
  return { ids: new Set(targets.map((t) => t.id)) }
}

export function withWorkspace(
  c: WorkspaceCollection, name: string, next: Workspace
): WorkspaceCollection {
  return { ...c, workspaces: c.workspaces.map((w) => (w.name === name ? next : w)) }
}

export function withCells(w: Workspace, cells: Cell[]): Workspace {
  return { ...w, layout: { ...w.layout, cells } }
}

export type SetChartArgs = {
  workspace?: string
  cell: string // a cell id, or 'all' for every VISIBLE cell (MW-08)
  symbol?: string | null // already resolved by the tool layer; null empties the cell
  timeframe?: Timeframe
}
export type SetChartInfo = { workspaceName: string; cells: Cell[]; hidden: boolean }

export function setChart(c: WorkspaceCollection, a: SetChartArgs): EditResult<SetChartInfo> {
  const w = pickWorkspace(c, a.workspace)
  if (!w) return editFail(missingWorkspace(c, a.workspace))
  const t = resolveTargets(w, a.cell)
  if ('message' in t) return editFail(t.message)
  const ids = t.ids
  const cells = w.layout.cells.map((cell) => {
    if (!ids.has(cell.id)) return cell
    let next = cell
    if (a.symbol !== undefined) {
      // Parity with clearCell (D-34): emptying a cell drops user indicators, keeps fixed Volume.
      next = a.symbol === null
        ? { ...next, symbol: null, indicators: next.indicators.filter((i) => i.fixed) }
        : { ...next, symbol: a.symbol }
    }
    if (a.timeframe) next = { ...next, timeframe: a.timeframe }
    return next
  })
  const hidden = a.cell !== 'all' && !visibleCells(w).some((x) => x.id === a.cell)
  return editOk(withWorkspace(c, w.name, withCells(w, cells)), {
    workspaceName: w.name,
    cells: cells.filter((x) => ids.has(x.id)),
    hidden
  })
}

export type SetGridArgs = { workspace?: string; rows: number; cols: number }
export type SetGridInfo = { workspaceName: string; shape: GridShape; visible: Cell[] }

// Mirrors store.setShape: grow with seeds, never truncate on shrink, relocate a hidden active cell.
export function setGridLayout(c: WorkspaceCollection, a: SetGridArgs): EditResult<SetGridInfo> {
  const w = pickWorkspace(c, a.workspace)
  if (!w) return editFail(missingWorkspace(c, a.workspace))
  const shape: GridShape = { rows: a.rows, cols: a.cols }
  const target = cellCount(shape)
  const mint = makeIdMinter(c)
  let cells = w.layout.cells
  if (target > cells.length) {
    const added: Cell[] = []
    for (let i = cells.length; i < target; i++) added.push(newCellSeed(mint(), mint()))
    cells = [...cells, ...added]
  }
  const visible = cells.slice(0, target)
  const activeCellId = visible.some((x) => x.id === w.layout.activeCellId)
    ? w.layout.activeCellId
    : visible[0].id
  const next: Workspace = { ...w, layout: { ...w.layout, cells, shape, activeCellId } }
  return editOk(withWorkspace(c, w.name, next), { workspaceName: w.name, shape, visible })
}

const NO_INDICATOR = (id: string): string =>
  `No indicator "${id}". Use get_workspace to list indicator ids.`

export type AddIndicatorArgs = { workspace?: string; cell: string; type: string; params: Params }
export type AddIndicatorInfo = {
  workspaceName: string
  added: { cellId: string; instance: IndicatorInstance }[]
  skipped: number
}

export function addIndicator(
  c: WorkspaceCollection, a: AddIndicatorArgs
): EditResult<AddIndicatorInfo> {
  const w = pickWorkspace(c, a.workspace)
  if (!w) return editFail(missingWorkspace(c, a.workspace))
  const t = resolveTargets(w, a.cell)
  if ('message' in t) return editFail(t.message)
  const ids = t.ids
  const mint = makeIdMinter(c)
  const added: { cellId: string; instance: IndicatorInstance }[] = []
  let skipped = 0
  const cells = w.layout.cells.map((cell) => {
    if (!ids.has(cell.id)) return cell
    // Bulk parity with addIndicatorToAll; a single-cell add never dedupes (addIndicator).
    if (a.cell === 'all' && cell.indicators.some((i) => i.type === a.type && sameParams(i.params, a.params))) {
      skipped += 1
      return cell
    }
    const instance = makeIndicatorInstance(a.type, a.params, cell.indicators.length, mint())
    if (!instance) return cell // the tool layer validated the type; belt and braces
    added.push({ cellId: cell.id, instance })
    return { ...cell, indicators: [...cell.indicators, instance] }
  })
  return editOk(withWorkspace(c, w.name, withCells(w, cells)), { workspaceName: w.name, added, skipped })
}

export type UpdateIndicatorArgs = {
  workspace?: string
  indicator: string
  params?: Params
  visible?: boolean
  color?: string
}
export type UpdateIndicatorInfo = {
  workspaceName: string
  cellId: string
  instance: IndicatorInstance
}

export function updateIndicator(
  c: WorkspaceCollection, a: UpdateIndicatorArgs
): EditResult<UpdateIndicatorInfo> {
  const w = pickWorkspace(c, a.workspace)
  if (!w) return editFail(missingWorkspace(c, a.workspace))
  const host = w.layout.cells.find((cell) => cell.indicators.some((i) => i.id === a.indicator))
  const current = host?.indicators.find((i) => i.id === a.indicator)
  if (!host || !current) return editFail(NO_INDICATOR(a.indicator))

  let next: IndicatorInstance = { ...current }
  if (a.params) {
    // Validated here, not in the tool layer: the type is only known once the instance is found, so
    // checking outside would mean looking the instance up twice.
    const check = validateParams(current.type, a.params)
    if (!check.ok) return editFail(check.message)
    next.params = { ...next.params, ...a.params }
  }
  if (a.visible !== undefined) next.visible = a.visible
  if (a.color) {
    // MW-16: fan the colour across every output, exactly as IndicatorEditForm does.
    const colors = { ...next.colors }
    for (const output of registry[current.type]?.outputs ?? []) colors[output.key] = a.color
    next = { ...next, colors }
  }
  const cells = w.layout.cells.map((cell) =>
    cell.id === host.id
      ? { ...cell, indicators: cell.indicators.map((i) => (i.id === a.indicator ? next : i)) }
      : cell
  )
  return editOk(withWorkspace(c, w.name, withCells(w, cells)), {
    workspaceName: w.name, cellId: host.id, instance: next
  })
}

export type RemoveIndicatorArgs = { workspace?: string; indicator?: string; cell?: string }
export type RemoveIndicatorInfo = { workspaceName: string; removed: number; keptFixed: number }

export function removeIndicator(
  c: WorkspaceCollection, a: RemoveIndicatorArgs
): EditResult<RemoveIndicatorInfo> {
  const w = pickWorkspace(c, a.workspace)
  if (!w) return editFail(missingWorkspace(c, a.workspace))

  let removed = 0
  let keptFixed = 0
  let cells: Cell[]

  if (a.indicator !== undefined) {
    const target = w.layout.cells
      .flatMap((cell) => cell.indicators)
      .find((i) => i.id === a.indicator)
    if (!target) return editFail(NO_INDICATOR(a.indicator))
    if (target.fixed) {
      keptFixed = 1
      cells = w.layout.cells
    } else {
      removed = 1
      cells = w.layout.cells.map((cell) => ({
        ...cell, indicators: cell.indicators.filter((i) => i.id !== a.indicator)
      }))
    }
  } else {
    const t = resolveTargets(w, a.cell ?? '')
    if ('message' in t) return editFail(t.message)
    const ids = t.ids
    cells = w.layout.cells.map((cell) => {
      if (!ids.has(cell.id)) return cell
      const kept = cell.indicators.filter((i) => i.fixed)
      removed += cell.indicators.length - kept.length
      keptFixed += kept.length
      return { ...cell, indicators: kept }
    })
  }
  return editOk(withWorkspace(c, w.name, withCells(w, cells)), { workspaceName: w.name, removed, keptFixed })
}

export type EditWatchlistArgs = { workspace?: string; add: WatchlistItem[]; remove: string[] }
export type EditWatchlistInfo = {
  workspaceName: string; items: WatchlistItem[]; addedCount: number; removedCount: number
}

export function editWatchlist(
  c: WorkspaceCollection, a: EditWatchlistArgs
): EditResult<EditWatchlistInfo> {
  const w = pickWorkspace(c, a.workspace)
  if (!w) return editFail(missingWorkspace(c, a.workspace))
  const drop = new Set(a.remove.map((s) => s.toUpperCase()))
  const kept = w.items.filter((i) => !drop.has(i.symbol.toUpperCase()))
  const removedCount = w.items.length - kept.length
  // Parity with addToWatchlist — which adds one at a time, so `have` must grow as we go or one
  // batch containing ["AAPL", "aapl"] would insert the same ticker twice.
  const have = new Set(kept.map((i) => i.symbol.toUpperCase()))
  const fresh: WatchlistItem[] = []
  for (const item of a.add) {
    const key = item.symbol.toUpperCase()
    if (have.has(key)) continue
    have.add(key)
    fresh.push(item)
  }
  const items = [...kept, ...fresh]
  return editOk(withWorkspace(c, w.name, { ...w, items }), {
    workspaceName: w.name, items, addedCount: fresh.length, removedCount
  })
}

const duplicateName = (name: string): string => `A workspace named "${name}" already exists.`

function remintLayout(layout: Layout, mint: () => string): Layout {
  let activeCellId = layout.activeCellId
  const cells = layout.cells.map((cell) => {
    const id = mint()
    if (cell.id === layout.activeCellId) activeCellId = id
    return { ...cell, id, indicators: cell.indicators.map((i) => ({ ...i, id: mint() })) }
  })
  return { ...layout, cells, activeCellId }
}

export type CreateWorkspaceArgs = { name: string; copyFrom?: string; activate: boolean }

export function createWorkspace(
  c: WorkspaceCollection, a: CreateWorkspaceArgs
): EditResult<{ name: string }> {
  if (c.workspaces.some((w) => w.name === a.name)) return editFail(duplicateName(a.name))
  const mint = makeIdMinter(c)
  let items: WatchlistItem[] = []
  let layout: Layout
  if (a.copyFrom !== undefined) {
    const source = c.workspaces.find((w) => w.name === a.copyFrom)
    if (!source) return editFail(missingWorkspace(c, a.copyFrom))
    items = [...source.items]
    layout = remintLayout(source.layout, mint)
  } else {
    layout = defaultLayout(mint(), mint())
  }
  const next: WorkspaceCollection = {
    ...c,
    active: a.activate ? a.name : c.active,
    workspaces: [...c.workspaces, { name: a.name, items, layout }]
  }
  return editOk(next, { name: a.name })
}

export function renameWorkspace(
  c: WorkspaceCollection, a: { from: string; to: string }
): EditResult<{ name: string }> {
  if (!c.workspaces.some((w) => w.name === a.from)) return editFail(missingWorkspace(c, a.from))
  if (c.workspaces.some((w) => w.name === a.to)) return editFail(duplicateName(a.to))
  const next: WorkspaceCollection = {
    ...c,
    active: c.active === a.from ? a.to : c.active,
    workspaces: c.workspaces.map((w) => (w.name === a.from ? { ...w, name: a.to } : w))
  }
  return editOk(next, { name: a.to })
}

export type DeleteWorkspaceInfo = {
  name: string; cellCount: number; symbols: string[]; watchlistCount: number; activeNow: string
}

export function deleteWorkspace(
  c: WorkspaceCollection, a: { name: string }
): EditResult<DeleteWorkspaceInfo> {
  const target = c.workspaces.find((w) => w.name === a.name)
  if (!target) return editFail(missingWorkspace(c, a.name))
  if (c.workspaces.length === 1) return editFail('Cannot delete the only workspace.')
  const workspaces = c.workspaces.filter((w) => w.name !== a.name)
  const activeNow = c.active === a.name ? workspaces[0].name : c.active
  const symbols = target.layout.cells
    .map((cell) => cell.symbol)
    .filter((s): s is string => s !== null)
  return editOk({ ...c, active: activeNow, workspaces }, {
    name: a.name,
    cellCount: target.layout.cells.length,
    symbols,
    watchlistCount: target.items.length,
    activeNow
  })
}

export function activateWorkspace(
  c: WorkspaceCollection, a: { name: string }
): EditResult<{ name: string }> {
  if (!c.workspaces.some((w) => w.name === a.name)) return editFail(missingWorkspace(c, a.name))
  return editOk({ ...c, active: a.name }, { name: a.name })
}
