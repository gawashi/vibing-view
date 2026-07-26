import { cellCount, newCellSeed } from '@shared/workspace'
import type { Cell, GridShape, Timeframe, Workspace, WorkspaceCollection } from '@shared/types'

// Every editor is a pure collection -> collection function so core.workspaces.mutate can run the
// whole read-modify-write inside one synchronous call (MW-04). `value` carries whatever the tool
// layer needs to format its response, so nothing has to diff the collection afterwards.
export type EditResult<T> =
  | { ok: true; collection: WorkspaceCollection; value: T }
  | { ok: false; message: string }

export const editFail = <T>(message: string): EditResult<T> => ({ ok: false, message })
export const editOk = <T>(collection: WorkspaceCollection, value: T): EditResult<T> =>
  ({ ok: true, collection, value })

const numericId = (id: string): number => {
  const n = parseInt(id, 10)
  return Number.isFinite(n) ? n : 0
}

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
  const targets = a.cell === 'all' ? visibleCells(w) : w.layout.cells.filter((x) => x.id === a.cell)
  if (targets.length === 0) {
    return editFail(
      `No cell "${a.cell}" in workspace "${w.name}". Cells: ${w.layout.cells.map((x) => x.id).join(', ')}.`
    )
  }
  const ids = new Set(targets.map((t) => t.id))
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
