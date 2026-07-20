import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { toast } from 'sonner'
import { registry } from './indicators/registry'
import { defaultWorkspace, duplicateCell, parseWorkspace, SCHEMA_VERSION, VISIBLE_COUNT } from './workspace'
import type { Cell, GridShape, IndicatorInstance, Params, Timeframe, Workspace, WatchlistItem, NamedWatchlist, WatchlistCollection } from '@shared/types'

// Crosshair readout injected into each pane's legend (D-38/39/40). Keyed by instance id for
// per-output indicator values (keyed by draw-output key), plus a reserved `price` key holding the
// price-pane OHLC. Multi-value by design so MACD-style 3-value readouts are a drop-in (IND-01).
export type OhlcValues = { open: number; high: number; low: number; close: number }
export type InstReadout = Record<string, number>
export type CrosshairValues = Record<string, OhlcValues | InstReadout>

// D-30: fixed 6-hue dark-theme palette, round-robin assigned by add order. Disjoint from candle
// colors, the app accent, and destructive — see 03-UI-SPEC.md Color section.
export const PALETTE = ['#F5A623', '#A78BFA', '#2DD4BF', '#F472B6', '#FACC15', '#38BDF8']

export type WatchlistActionResult = { ok: true } | { ok: false; error: string }

let nextId = 1 // module-level counter (no Date/random) — JSON-stable ids for P5 persistence

// Ids are minted as String(n); parse defensively and return the next-safe counter value (id+1),
// or the current nextId (no-op) for anything non-numeric/NaN.
const bumpId = (id: string): number => {
  const n = parseInt(id, 10)
  return Number.isFinite(n) ? n + 1 : nextId
}

type AppState = {
  cells: Cell[]
  activeCellId: string
  shape: GridShape
  setActiveCell: (id: string) => void
  setShape: (shape: GridShape) => void
  setActiveSymbol: (symbol: string) => void
  setTimeframe: (tf: Timeframe) => void
  // Per-cell timeframe setter (05-02 grid) — targets an explicit cell, not activeCellId, so a
  // non-active cell's own TimeframeRow (or an automatic gating effect) can set it directly without
  // depending on click-event ordering to focus the cell first.
  setCellTimeframe: (cellId: string, tf: Timeframe) => void
  // チャート削除: 対象セルを空(symbol=null)に戻す。ユーザー追加の指標は消すが、常時表示の
  // 固定指標(Volume, fixed:true)は残す — 再検索で銘柄を入れ直したとき出来高が消えないように。
  // そのセルの crosshair も破棄。
  clearCell: (cellId: string) => void
  addIndicator: (type: string, cellId?: string) => void
  removeIndicator: (id: string) => void
  toggleVisible: (id: string) => void
  updateParams: (id: string, patch: Params) => void
  setColor: (id: string, outputKey: string, color: string) => void
  hydrate: (ws: Workspace) => void
  // Keyed by cellId so each grid cell's crosshair readout is isolated (05-02 grid).
  crosshairByCell: Record<string, CrosshairValues>
  setCrosshair: (cellId: string, values: CrosshairValues) => void

  // Named-layout orchestration (05-03/D-56/D-58). `activeLayoutName` is null when the current
  // workspace has never been saved under a name (or was switched away from one) — Rename/overwrite
  // Save both key off this.
  activeLayoutName: string | null
  currentWorkspace: () => Workspace
  saveLayoutAs: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>
  saveActiveLayout: () => Promise<void>
  renameActiveLayout: (to: string) => Promise<{ ok: true } | { ok: false; error: string }>
  deleteLayout: (name: string) => Promise<void>
  switchToLayout: (name: string) => Promise<void>

  // Persistent multi-watchlist (D-62). All actions act on the ACTIVE list; App wires
  // load-on-startup and persist-on-change. Pure state mutations (no IPC) so they're unit-testable.
  watchlists: NamedWatchlist[]
  activeWatchlist: string
  addToWatchlist: (item: WatchlistItem) => void
  removeFromWatchlist: (symbol: string) => void
  reorderWatchlist: (from: number, to: number) => void
  createWatchlist: (name: string) => WatchlistActionResult
  renameWatchlist: (from: string, to: string) => WatchlistActionResult
  deleteWatchlist: (name: string) => void
  switchWatchlist: (name: string) => void
  hydrateWatchlists: (collection: WatchlistCollection) => void
}

// アクティブリストの items。見つからなければ空配列。found 時は items 参照が安定（再描画churn防止）。
export const selectActiveItems = (s: AppState): WatchlistItem[] =>
  s.watchlists.find((w) => w.name === s.activeWatchlist)?.items ?? []

const initialWorkspace = defaultWorkspace(String(nextId++), String(nextId++))

export const useAppStore = create<AppState>()(subscribeWithSelector((set, get) => ({
  cells: initialWorkspace.cells,
  activeCellId: initialWorkspace.activeCellId,
  shape: initialWorkspace.shape,

  crosshairByCell: {},
  setCrosshair: (cellId, values) => set((state) => ({
    crosshairByCell: { ...state.crosshairByCell, [cellId]: values }
  })),

  setActiveCell: (id) => set({ activeCellId: id }),
  setShape: (shape) => set((state) => {
    const target = VISIBLE_COUNT[shape]
    let cells = state.cells
    if (target > cells.length) {
      const activeCell = cells.find((c) => c.id === state.activeCellId) ?? cells[0]
      const added: Cell[] = []
      for (let i = cells.length; i < target; i++) {
        const newIndicatorIds = activeCell.indicators.map(() => String(nextId++))
        added.push(duplicateCell(activeCell, String(nextId++), newIndicatorIds))
      }
      cells = [...cells, ...added]
    }
    const visible = cells.slice(0, target)
    const activeCellId = visible.some((c) => c.id === state.activeCellId)
      ? state.activeCellId
      : visible[0].id
    return { shape, cells, activeCellId }
  }),

  setActiveSymbol: (symbol) => set((state) => ({
    cells: state.cells.map((c) => (c.id === state.activeCellId ? { ...c, symbol } : c))
  })),
  setTimeframe: (tf) => set((state) => ({
    cells: state.cells.map((c) => (c.id === state.activeCellId ? { ...c, timeframe: tf } : c))
  })),
  setCellTimeframe: (cellId, tf) => set((state) => ({
    cells: state.cells.map((c) => (c.id === cellId ? { ...c, timeframe: tf } : c))
  })),
  clearCell: (cellId) => set((state) => {
    const { [cellId]: _removed, ...crosshairByCell } = state.crosshairByCell
    return {
      cells: state.cells.map((c) =>
        // keep fixed (always-on Volume) instances, drop user-added ones — mirrors removeIndicator
        c.id === cellId ? { ...c, symbol: null, indicators: c.indicators.filter((i) => i.fixed) } : c
      ),
      crosshairByCell
    }
  }),
  addIndicator: (type, cellId) => {
    const module = registry[type]
    if (!module) return
    const targetId = cellId ?? get().activeCellId
    const activeCell = get().cells.find((c) => c.id === targetId)
    if (!activeCell) return
    const base = activeCell.indicators.length
    const colors: Record<string, string> = {}
    // Multi-line-no-band modules (MACD: macd+signal, no band) get CONSECUTIVE hues so the two lines
    // are distinguishable; derived from outputs structure, never inst.type. ma/rsi (single line) and
    // bb (has a band) keep the single-hue path. Non-line outputs (histogram) get a placeholder — its
    // real per-bar colors come from compute, so the palette value is unused.
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
    const instance: IndicatorInstance = {
      id: String(nextId++),
      type,
      params: { ...module.defaults },
      colors,
      visible: true
    }
    set((state) => ({
      cells: state.cells.map((c) =>
        c.id === targetId ? { ...c, indicators: [...c.indicators, instance] } : c
      )
    }))
  },
  removeIndicator: (id) => set((state) => ({
    cells: state.cells.map((c) => ({
      ...c,
      indicators: c.indicators.filter((i) => i.id !== id || i.fixed)
    }))
  })),
  toggleVisible: (id) => set((state) => ({
    cells: state.cells.map((c) => ({
      ...c,
      indicators: c.indicators.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i))
    }))
  })),
  updateParams: (id, patch) => set((state) => ({
    cells: state.cells.map((c) => ({
      ...c,
      indicators: c.indicators.map((i) => (i.id === id ? { ...i, params: { ...i.params, ...patch } } : i))
    }))
  })),
  setColor: (id, outputKey, color) => set((state) => ({
    cells: state.cells.map((c) => ({
      ...c,
      indicators: c.indicators.map((i) =>
        i.id === id ? { ...i, colors: { ...i.colors, [outputKey]: color } } : i
      )
    }))
  })),
  hydrate: (ws) => {
    // Reseed the module-level id counter past every id in the loaded workspace — otherwise ids
    // minted post-hydrate (addIndicator/setShape/duplicateCell) can collide with restored ids
    // from a prior session's counter (see Phase 5 review: nextId collision bug).
    for (const cell of ws.cells) {
      nextId = Math.max(nextId, bumpId(cell.id))
      for (const inst of cell.indicators) nextId = Math.max(nextId, bumpId(inst.id))
    }
    // Heal cells restored without their always-on fixed Volume (D-34) — e.g. saved by an older
    // build whose clearCell wiped ALL indicators. Volume is non-removable, so a volume-less cell is
    // always corrupt; re-seed it (fresh id, past the reseed above) so the chart shows volume again.
    const cells = ws.cells.map((c) =>
      c.indicators.some((i) => i.type === 'volume')
        ? c
        : {
            ...c,
            indicators: [
              { id: String(nextId++), type: 'volume', params: {}, colors: {}, visible: true, fixed: true },
              ...c.indicators
            ]
          }
    )
    set({ cells, shape: ws.shape, activeCellId: ws.activeCellId })
  },

  // Named-layout actions call `window.api.*` directly (NOT the `./api` wrapper) on purpose:
  // importing `./api` touches `window` at module-load time, which breaks the node-env vitest
  // run (store.test.ts imports store.ts with no DOM) and `tsc -p tsconfig.node.json` (api.ts
  // isn't in that project's include). Do not "clean this up" to use `./api`.
  activeLayoutName: null,
  currentWorkspace: () => {
    const { cells, shape, activeCellId } = get()
    return { schemaVersion: SCHEMA_VERSION, cells, shape, activeCellId }
  },
  saveLayoutAs: async (name) => {
    const existing = await window.api.layout.list()
    if (existing.includes(name)) {
      return { ok: false, error: `A layout named "${name}" already exists.` }
    }
    try {
      await window.api.layout.save(name, get().currentWorkspace())
      set({ activeLayoutName: name })
      return { ok: true }
    } catch {
      toast("Couldn't save layout. Try again.")
      return { ok: false, error: "Couldn't save layout. Try again." }
    }
  },
  saveActiveLayout: async () => {
    const name = get().activeLayoutName
    if (!name) return
    try {
      await window.api.layout.save(name, get().currentWorkspace())
    } catch {
      toast("Couldn't save layout. Try again.")
    }
  },
  renameActiveLayout: async (to) => {
    const from = get().activeLayoutName
    if (!from) return { ok: false, error: "No active layout to rename." }
    if (to !== from) {
      const existing = await window.api.layout.list()
      if (existing.includes(to)) {
        return { ok: false, error: `A layout named "${to}" already exists.` }
      }
    }
    try {
      await window.api.layout.rename(from, to)
      set({ activeLayoutName: to })
      return { ok: true }
    } catch {
      toast("Couldn't save layout. Try again.")
      return { ok: false, error: "Couldn't save layout. Try again." }
    }
  },
  deleteLayout: async (name) => {
    try {
      await window.api.layout.delete(name)
      if (get().activeLayoutName === name) set({ activeLayoutName: null })
    } catch {
      toast("Couldn't save layout. Try again.")
    }
  },
  switchToLayout: async (name) => {
    try {
      // D-58: auto-save current state before switching away, no confirmation.
      await window.api.layout.setCurrent(get().currentWorkspace())
      const raw = await window.api.layout.get(name)
      const ws = parseWorkspace(raw)
      // Corrupt/unparseable stored layout — abort the switch, keep current state (never wipe it).
      if (!ws) return
      get().hydrate(ws)
      set({ activeLayoutName: name })
    } catch {
      toast("Couldn't save layout. Try again.")
    }
  },

  watchlists: [{ name: 'Watchlist', items: [] }],
  activeWatchlist: 'Watchlist',
  addToWatchlist: (item) => set((state) => ({
    watchlists: state.watchlists.map((w) =>
      w.name === state.activeWatchlist
        ? (w.items.some((i) => i.symbol === item.symbol) ? w : { ...w, items: [...w.items, item] })
        : w
    )
  })),
  removeFromWatchlist: (symbol) => set((state) => ({
    watchlists: state.watchlists.map((w) =>
      w.name === state.activeWatchlist ? { ...w, items: w.items.filter((i) => i.symbol !== symbol) } : w
    )
  })),
  // ずれ修正: from を抜いた後の座標系に合わせ、下方向(from<to)は挿入位置を1つ詰める。
  // これでマーカー(行上端=その行の前)と実挿入位置が上下両方向で一致する。
  reorderWatchlist: (from, to) => set((state) => ({
    watchlists: state.watchlists.map((w) => {
      if (w.name !== state.activeWatchlist) return w
      const items = [...w.items]
      const [moved] = items.splice(from, 1)
      items.splice(from < to ? to - 1 : to, 0, moved)
      return { ...w, items }
    })
  })),
  createWatchlist: (name) => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (get().watchlists.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A watchlist named "${trimmed}" already exists.` }
    }
    set((state) => ({ watchlists: [...state.watchlists, { name: trimmed, items: [] }], activeWatchlist: trimmed }))
    return { ok: true }
  },
  renameWatchlist: (from, to) => {
    const trimmed = to.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (trimmed !== from && get().watchlists.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A watchlist named "${trimmed}" already exists.` }
    }
    set((state) => ({
      watchlists: state.watchlists.map((w) => (w.name === from ? { ...w, name: trimmed } : w)),
      activeWatchlist: state.activeWatchlist === from ? trimmed : state.activeWatchlist
    }))
    return { ok: true }
  },
  deleteWatchlist: (name) => set((state) => {
    if (state.watchlists.length <= 1) return state // 最後の1リストは削除不可
    const watchlists = state.watchlists.filter((w) => w.name !== name)
    const activeWatchlist = state.activeWatchlist === name ? watchlists[0].name : state.activeWatchlist
    return { watchlists, activeWatchlist }
  }),
  switchWatchlist: (name) => set((state) =>
    state.watchlists.some((w) => w.name === name) ? { activeWatchlist: name } : state
  ),
  hydrateWatchlists: (collection) => set({
    watchlists: collection.lists,
    activeWatchlist: collection.active
  })
})))
