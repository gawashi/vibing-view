import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { registry } from '@shared/indicators/registry'
import { makeIndicatorInstance, sameParams } from '@shared/indicators/instance'
import { defaultLayout, newCellSeed, SCHEMA_VERSION, cellCount } from '@shared/workspace'
import type { Cell, GridShape, IndicatorInstance, Params, Timeframe, Layout, WatchlistItem, Workspace, WorkspaceCollection, ClipboardCell } from '@shared/types'

// Crosshair readout injected into each pane's legend (D-38/39/40). Keyed by instance id for
// per-output indicator values (keyed by draw-output key), plus a reserved `price` key holding the
// price-pane OHLC. Multi-value by design so MACD-style 3-value readouts are a drop-in (IND-01).
export type OhlcValues = { open: number; high: number; low: number; close: number }
export type InstReadout = Record<string, number>
export type CrosshairValues = Record<string, OhlcValues | InstReadout>

export type WatchlistActionResult = { ok: true } | { ok: false; error: string }

let nextId = 1 // module-level counter (no Date/random) — JSON-stable ids for P5 persistence

// Ids are minted as String(n); parse defensively and return the next-safe counter value (id+1),
// or the current nextId (no-op) for anything non-numeric/NaN.
const bumpId = (id: string): number => {
  const n = parseInt(id, 10)
  return Number.isFinite(n) ? n + 1 : nextId
}

export type AppState = {
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
  // ドラッグ&ドロップ用の純粋ミューテーション。swap は cells 配列内で 2 セルを id ごと入替える
  // (activeCellId は id 参照なのでリングは中身に追従)。
  swapCells: (idA: string, idB: string) => void
  // 対象セルの symbol のみ差し替え(timeframe/indicators 維持)。空セルを埋める用途も兼ねる。
  // 不明 id・同値 symbol は state 不変(不要な永続化を避ける)。
  setCellSymbol: (cellId: string, symbol: string) => void
  // Bulk (apply-to-all) variants — act on the visible slice cells[0..cellCount(shape)-1].
  setAllTimeframes: (tf: Timeframe) => void
  addIndicatorToAll: (type: string, params: Params) => void
  // チャート削除: 対象セルを空(symbol=null)に戻す。ユーザー追加の指標は消すが、常時表示の
  // 固定指標(Volume, fixed:true)は残す — 再検索で銘柄を入れ直したとき出来高が消えないように。
  // そのセルの crosshair も破棄。
  clearCell: (cellId: string) => void
  // Bulk delete — mirror of setAllTimeframes/addIndicatorToAll, but act on ALL cells of the active
  // workspace (visible + hidden): "clear all" means all. Fixed Volume is kept (see clearCell).
  clearAllCells: () => void
  removeAllIndicators: () => void
  addIndicator: (type: string, cellId?: string) => void
  removeIndicator: (id: string) => void
  toggleVisible: (id: string) => void
  updateParams: (id: string, patch: Params) => void
  setColor: (id: string, outputKey: string, color: string) => void
  hydrate: (ws: Layout) => void
  // Keyed by cellId so each grid cell's crosshair readout is isolated (05-02 grid).
  crosshairByCell: Record<string, CrosshairValues>
  setCrosshair: (cellId: string, values: CrosshairValues) => void

  // Chart config clipboard (copy/cut/paste). In-memory only, synced across windows by
  // useClipboardSync — never persisted. Pure actions (no IPC) so they stay unit-testable.
  chartClipboard: ClipboardCell | null
  copyCell: (cellId: string) => void
  cutCell: (cellId: string) => void
  pasteCell: (cellId: string) => void
  setClipboard: (clip: ClipboardCell | null) => void

  // Unified Workspace model (= watchlist items + grid layout under one name). All actions act on
  // the ACTIVE workspace; App wires load-on-startup and persist-on-change. Pure state mutations
  // (no IPC) so they're unit-testable. Switch/create/duplicate/delete snapshot the hot grid into
  // the active workspace first so in-flight edits aren't lost.
  currentLayout: () => Layout
  // Whole persisted collection with the hot grid folded into the active workspace's layout. App's
  // debounced auto-save serializes this verbatim — the fold lives here, not in the effect.
  collectionSnapshot: () => WorkspaceCollection
  workspaces: Workspace[]
  activeWorkspace: string
  addToWatchlist: (item: WatchlistItem) => void
  removeFromWatchlist: (symbol: string) => void
  reorderWatchlist: (from: number, to: number) => void
  reorderWorkspaces: (from: number, to: number) => WatchlistActionResult
  createWorkspace: (name: string) => WatchlistActionResult
  duplicateWorkspace: (newName: string, sourceName?: string) => WatchlistActionResult
  renameWorkspace: (from: string, to: string) => WatchlistActionResult
  deleteWorkspace: (name: string) => void
  switchWorkspace: (name: string) => void
  hydrateWorkspaces: (collection: WorkspaceCollection) => void
}

// アクティブ Workspace の items。見つからなければ空配列。found 時は items 参照が安定（再描画churn防止）。
export const selectActiveItems = (s: AppState): WatchlistItem[] =>
  s.workspaces.find((w) => w.name === s.activeWorkspace)?.items ?? []

const initialLayout = defaultLayout(String(nextId++), String(nextId++))

export const useAppStore = create<AppState>()(subscribeWithSelector((set, get) => {
  // アクティブ Workspace の layout を現在のホットなグリッドで差し替えた配列を返す（純粋）。
  // 切替/作成/削除の直前に呼び、編集中のグリッドを取りこぼさない。
  const snapshotActive = (): Workspace[] => {
    const { workspaces, activeWorkspace } = get()
    const layout = get().currentLayout()
    return workspaces.map((w) => (w.name === activeWorkspace ? { ...w, layout } : w))
  }
  // Fresh ids for every cell + indicator in a layout (used when duplicating a workspace so the copy
  // never shares an id with its source — collection-wide uniqueness, see workspace.ts dedupe).
  const remintLayout = (layout: Layout): Layout => {
    let activeCellId = layout.activeCellId
    const cells = layout.cells.map((c) => {
      const id = String(nextId++)
      if (c.id === layout.activeCellId) activeCellId = id
      return { ...c, id, indicators: c.indicators.map((i) => ({ ...i, id: String(nextId++) })) }
    })
    return { ...layout, cells, activeCellId }
  }
  // Make `name` the active workspace and hydrate its layout into the hot grid. Callers pass the
  // already-snapshotted array so the outgoing grid isn't lost. Single owner of the set-active +
  // hydrate pairing — create/duplicate/delete/switch all end here (keeps the nextId reseed in hydrate
  // on every activation path, see the collision note in hydrate below).
  const activate = (workspaces: Workspace[], name: string): void => {
    const layout = (workspaces.find((w) => w.name === name) ?? workspaces[0]).layout
    set({ workspaces, activeWorkspace: name })
    get().hydrate(layout)
  }
  // Palette/colors/params live in the shared builder so MCP writes identical instances (MW-06).
  // The store keeps id minting (module-level nextId); an unknown type must not burn an id.
  const makeInstance = (type: string, params: Params, base: number): IndicatorInstance | null =>
    registry[type] ? makeIndicatorInstance(type, params, base, String(nextId++)) : null
  return {
  cells: initialLayout.cells,
  activeCellId: initialLayout.activeCellId,
  shape: initialLayout.shape,

  crosshairByCell: {},
  chartClipboard: null,
  setCrosshair: (cellId, values) => set((state) => ({
    crosshairByCell: { ...state.crosshairByCell, [cellId]: values }
  })),

  setActiveCell: (id) => set({ activeCellId: id }),
  setShape: (shape) => set((state) => {
    const target = cellCount(shape)
    let cells = state.cells
    if (target > cells.length) {
      const added: Cell[] = []
      for (let i = cells.length; i < target; i++) {
        added.push(newCellSeed(String(nextId++), String(nextId++)))
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
  swapCells: (idA, idB) => set((state) => {
    if (idA === idB) return state
    const ia = state.cells.findIndex((c) => c.id === idA)
    const ib = state.cells.findIndex((c) => c.id === idB)
    if (ia === -1 || ib === -1) return state
    const cells = state.cells.slice()
    ;[cells[ia], cells[ib]] = [cells[ib], cells[ia]]
    return { cells }
  }),
  setCellSymbol: (cellId, symbol) => set((state) => {
    const cell = state.cells.find((c) => c.id === cellId)
    if (!cell || cell.symbol === symbol) return state
    return { cells: state.cells.map((c) => (c.id === cellId ? { ...c, symbol } : c)) }
  }),
  setAllTimeframes: (tf) => set((state) => {
    const visible = cellCount(state.shape)
    return { cells: state.cells.map((c, i) => (i < visible ? { ...c, timeframe: tf } : c)) }
  }),
  addIndicatorToAll: (type, params) => {
    if (!registry[type]) return
    set((state) => {
      const visible = cellCount(state.shape)
      return {
        cells: state.cells.map((c, i) => {
          if (i >= visible) return c
          if (c.indicators.some((ind) => ind.type === type && sameParams(ind.params, params))) return c
          return { ...c, indicators: [...c.indicators, makeInstance(type, params, c.indicators.length)!] }
        })
      }
    })
  },
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
  copyCell: (cellId) => {
    const cell = get().cells.find((c) => c.id === cellId)
    if (!cell || !cell.symbol) return // nothing to copy from an empty cell
    set({
      chartClipboard: {
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        // deep clone so later edits to the source cell (or the clipboard) don't alias each other
        indicators: cell.indicators.map((i) => ({ ...i, params: { ...i.params }, colors: { ...i.colors } }))
      }
    })
  },
  cutCell: (cellId) => {
    const cell = get().cells.find((c) => c.id === cellId)
    if (!cell || !cell.symbol) return
    // ponytail: clipboard broadcasts immediately but the source clear rides useWorkspaceSync's 500ms
    // debounce, so cut-here-then-paste-there-within-500ms across windows can drop the paste. Accepted
    // (rare, non-destructive — worst case is an undone paste). Flush workspace on cut/paste if it bites.
    get().copyCell(cellId)
    get().clearCell(cellId)
  },
  pasteCell: (cellId) => {
    const src = get().chartClipboard
    if (!src) return
    if (!get().cells.some((c) => c.id === cellId)) return
    // Re-mint every indicator id (collection-wide uniqueness). The clipboard is only ever written
    // from copyCell/cutCell, so src already carries exactly one fixed Volume at index 0 — no
    // normalization needed.
    const indicators = src.indicators.map((i) => ({ ...i, id: String(nextId++), params: { ...i.params }, colors: { ...i.colors } }))
    set((state) => {
      const { [cellId]: _removed, ...crosshairByCell } = state.crosshairByCell
      return {
        cells: state.cells.map((c) =>
          c.id === cellId ? { ...c, symbol: src.symbol, timeframe: src.timeframe, indicators } : c
        ),
        crosshairByCell
      }
    })
  },
  setClipboard: (clip) => set({ chartClipboard: clip }),
  addIndicator: (type, cellId) => {
    const targetId = cellId ?? get().activeCellId
    const cell = get().cells.find((c) => c.id === targetId)
    if (!cell) return
    const module = registry[type]
    if (!module) return
    const instance = makeInstance(type, { ...module.defaults }, cell.indicators.length)!
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
  clearAllCells: () => set((state) => ({
    cells: state.cells.map((c) => ({ ...c, symbol: null, indicators: c.indicators.filter((i) => i.fixed) })),
    crosshairByCell: {}
  })),
  removeAllIndicators: () => set((state) => ({
    cells: state.cells.map((c) => ({ ...c, indicators: c.indicators.filter((i) => i.fixed) }))
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
    // minted post-hydrate (addIndicator/setShape) can collide with restored ids
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

  currentLayout: () => {
    const { cells, shape, activeCellId } = get()
    return { schemaVersion: SCHEMA_VERSION, cells, shape, activeCellId }
  },
  collectionSnapshot: () => ({ version: 3, active: get().activeWorkspace, workspaces: snapshotActive() }),

  workspaces: [{ name: 'Workspace 1', items: [], layout: initialLayout }],
  activeWorkspace: 'Workspace 1',

  addToWatchlist: (item) => set((state) => ({
    workspaces: state.workspaces.map((w) =>
      w.name === state.activeWorkspace
        ? (w.items.some((i) => i.symbol === item.symbol) ? w : { ...w, items: [...w.items, item] })
        : w
    )
  })),
  removeFromWatchlist: (symbol) => set((state) => ({
    workspaces: state.workspaces.map((w) =>
      w.name === state.activeWorkspace ? { ...w, items: w.items.filter((i) => i.symbol !== symbol) } : w
    )
  })),
  // ずれ修正: from を抜いた後の座標系に合わせ、下方向(from<to)は挿入位置を1つ詰める。
  // これでマーカー(行上端=その行の前)と実挿入位置が上下両方向で一致する。
  reorderWatchlist: (from, to) => set((state) => ({
    workspaces: state.workspaces.map((w) => {
      if (w.name !== state.activeWorkspace) return w
      const items = [...w.items]
      const [moved] = items.splice(from, 1)
      items.splice(from < to ? to - 1 : to, 0, moved)
      return { ...w, items }
    })
  })),
  reorderWorkspaces: (from, to) => {
    const n = get().workspaces.length
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return { ok: false, error: 'Invalid index.' }
    set((state) => {
      const list = [...state.workspaces]
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      return { workspaces: list }
    })
    return { ok: true }
  },
  createWorkspace: (name) => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (get().workspaces.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A workspace named "${trimmed}" already exists.` }
    }
    const layout = defaultLayout(String(nextId++), String(nextId++))
    activate([...snapshotActive(), { name: trimmed, items: [], layout }], trimmed)
    return { ok: true }
  },
  duplicateWorkspace: (newName, sourceName) => {
    const trimmed = newName.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (get().workspaces.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A workspace named "${trimmed}" already exists.` }
    }
    // snapshotActive() でアクティブのホットなグリッドを取り込んでから layout を読む。
    // これでコピー元がアクティブ自身でも編集中の内容を取りこぼさない。
    const snapshot = snapshotActive()
    const source = sourceName ?? get().activeWorkspace
    const src = snapshot.find((w) => w.name === source)
    if (!src) return { ok: false, error: `Workspace "${source}" not found.` }
    const layout = remintLayout(src.layout)
    const items = src.items.map((i) => ({ ...i }))
    const next = [...snapshot, { name: trimmed, items, layout }]
    // sourceName 省略 = 従来「現在の複製」: コピーへ切替。指定時 = 管理操作: アクティブ据え置き。
    if (sourceName === undefined) activate(next, trimmed)
    else set({ workspaces: next })
    return { ok: true }
  },
  renameWorkspace: (from, to) => {
    const trimmed = to.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (trimmed !== from && get().workspaces.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A workspace named "${trimmed}" already exists.` }
    }
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.name === from ? { ...w, name: trimmed } : w)),
      activeWorkspace: state.activeWorkspace === from ? trimmed : state.activeWorkspace
    }))
    return { ok: true }
  },
  deleteWorkspace: (name) => {
    const state = get()
    if (state.workspaces.length <= 1) return
    const remaining = snapshotActive().filter((w) => w.name !== name)
    if (state.activeWorkspace === name) {
      activate(remaining, remaining[0].name)
    } else {
      set({ workspaces: remaining })
    }
  },
  switchWorkspace: (name) => {
    const state = get()
    if (name === state.activeWorkspace) return
    const target = state.workspaces.find((w) => w.name === name)
    if (!target) return
    activate(snapshotActive(), name)
  },
  hydrateWorkspaces: (collection) => {
    // Reseed nextId past every id in EVERY workspace (not just the active one activate() hydrates),
    // so a runtime-minted id can't collide with a non-active workspace's cell/indicator id.
    for (const w of collection.workspaces) {
      for (const cell of w.layout.cells) {
        nextId = Math.max(nextId, bumpId(cell.id))
        for (const inst of cell.indicators) nextId = Math.max(nextId, bumpId(inst.id))
      }
    }
    activate(collection.workspaces, collection.active)
  }
  }
}))
