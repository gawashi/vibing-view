import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { configureProxy } from './net/httpClient'
import { CH } from '@shared/ipc'
import { buildHash, type WindowKind } from '@shared/windowHash'
import { DEFAULT_ECONOMIC_INDICATOR } from '@shared/economicIndicators'
import { createCore } from './core'
import * as barStore from './db/barStore'
import * as profileStore from './db/profileStore'
import * as companyProfileStore from './db/companyProfileStore'
import * as economicDayStore from './db/economicDayStore'
import * as economicIndicatorStore from './db/economicIndicatorStore'
import * as treasuryCurveStore from './db/treasuryCurveStore'
import * as workspaceStore from './workspaceStore'
import * as capabilityCache from './capabilityCache'
import { getApiKey, setApiKey, getKeyStatus, clearApiKey } from './keystore'
import { FmpProvider } from './providers/FmpProvider'
import { electronHttpGetJson } from './net/httpClient'
import * as mcp from './mcp'
import { getMcpConfig } from './settings'

// One satellite window per (kind, key): company-info per symbol, enlarge-chart per cellId, watchlist
// symbol window per symbol, economic calendar as a singleton (fixed value, so a second open always
// focuses — 週は renderer の state なので週ごとに窓を増やす意味がない、EC-09), economic indicator as
// a singleton (同じ理由、EI-06). Reopening a live key focuses it;
// a new key spawns another. Keyed `kind:value` by default, but a caller can pin the key so a
// singleton window stays one window while its hash carries a varying value (economic indicator).
// Cleared on 'closed'.
const satelliteWindows = new Map<string, BrowserWindow>()

// Load the shared renderer bundle, optionally with a hash (e.g. company=AAPL) that main.tsx reads
// to mount CompanyWindow instead of App. Dev serves from ELECTRON_RENDERER_URL; prod loads the file.
function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? '#' + hash : ''))
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

// Never let the renderer spawn a BrowserWindow (e.g. an <a target="_blank"> to an FMP company site):
// those would be untracked, load remote content inside Electron, and survive the main-window close.
// Deny the window, route validated http(s) to the system browser instead.
function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

// The refresh scheduler lives in the main window's renderer (App.reload), so force_reload has to
// be delegated to exactly that window — not broadcast to all of them.
let mainWindow: BrowserWindow | null = null

function requestRefresh(requestId: number): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  mainWindow.webContents.send(CH.refreshRequest, requestId)
  return true
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0B0E11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  hardenWindow(win)
  mainWindow = win
  win.setMenuBarVisibility(false) // hide the top menu bar; accelerators (zoom/fullscreen/close) still fire from the app menu
  win.on('ready-to-show', () => win.show())
  // Closing the main window tears down satellite windows so window-all-closed fires → app quits.
  win.on('closed', () => {
    mainWindow = null
    for (const w of satelliteWindows.values()) w.close()
  })
  loadRenderer(win)
}

// One hardened satellite window per (kind, value); backs every window kind.
function openHashWindow(
  kind: WindowKind, value: string, width: number, height: number, key = `${kind}:${value}`
): void {
  const existing = satelliteWindows.get(key)
  if (existing) {
    existing.focus()
    return
  }
  const win = new BrowserWindow({
    width,
    height,
    backgroundColor: '#0B0E11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  hardenWindow(win)
  win.setMenuBarVisibility(false)
  satelliteWindows.set(key, win)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => satelliteWindows.delete(key))
  loadRenderer(win, buildHash(kind, value))
}

// 統計指標ウィンドウは 1 枚だけなので窓のキーは固定。表示する指標は hash が運ぶので、renderer は
// マウント時点で最初から正しい指標を知っている（pull の往復も、その間の「未確定」状態も要らない）。
// 窓が既にある場合だけ push で差し替える。
// selectedIndicator は窓を閉じたあとも直前の選択を覚えるためのプロセス内 state（永続化しない、
// EI-03）。ヘッダーボタンは name 無しで呼ぶので、これが「前回の続き」を決める。
const INDICATOR_WINDOW_KEY = 'economicIndicator:1'
let selectedIndicator = DEFAULT_ECONOMIC_INDICATOR

// The default Electron menu binds Ctrl+R / Ctrl+Shift+R to page reload — accelerators the main
// process dispatches, which a renderer keydown.preventDefault() cannot cancel. We install a menu
// that keeps zoom, fullscreen, DevTools, and window controls but drops the reload roles, so Ctrl+R
// falls through to the renderer's targeted chart refresh.
// No Edit menu on purpose: its Copy/Cut/Paste accelerators (Ctrl+C/X/V) are also main-process
// accelerators that would fire alongside — and thus collide with — the grid's own cell
// copy/cut/paste shortcuts. Chromium handles copy/paste inside inputs/textareas natively without a
// menu, so omitting Edit loses nothing and keeps the cell shortcuts unambiguous.
function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Send to every window except the originator. core.ts stays free of `electron` imports by taking
// this as a dep (same reasoning as db/client.ts's lazy require).
function broadcast(channel: string, payload: unknown, exceptWebContentsId?: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.webContents.id !== exceptWebContentsId) w.webContents.send(channel, payload)
  }
}

function buildCore(): ReturnType<typeof createCore> {
  return createCore({
    broadcast,
    barStore,
    profileStore,
    companyProfileStore,
    economicDayStore,
    economicIndicatorStore,
    treasuryCurveStore,
    workspaceStore,
    capabilityCache,
    keystore: { getApiKey, setApiKey, getKeyStatus, clearApiKey },
    makeProvider: (apiKey) => new FmpProvider({ apiKey, httpGetJson: electronHttpGetJson }),
    requestRefresh
  })
}

app.whenReady().then(async () => {
  // Route provider HTTP through the OS/system proxy (or HTTP(S)_PROXY) before any fetch runs —
  // corporate networks block direct egress, so an unconfigured client times out (see net/httpClient).
  await configureProxy()
  installMenu()
  const core = buildCore()
  registerIpc(core)
  mcp.onStatusChanged((status) => broadcast(CH.mcpStatusChanged, status))
  void mcp.applyConfig(core, getMcpConfig()) // no-op unless the user enabled it (M-06)
  ipcMain.handle(CH.companyOpenWindow, (_e, symbol: string) => openHashWindow('company', symbol, 600, 800))
  ipcMain.handle(CH.chartOpenWindow, (_e, cellId: string) => openHashWindow('chart', cellId, 1100, 760))
  ipcMain.handle(CH.symbolChartOpenWindow, (_e, symbol: string) => openHashWindow('symbolChart', symbol, 1100, 760))
  ipcMain.handle(CH.economicOpenWindow, () => openHashWindow('economic', '1', 720, 900))
  ipcMain.handle(CH.economicIndicatorOpenWindow, (_e, name?: string) => {
    if (name) selectedIndicator = name
    const existing = satelliteWindows.get(INDICATOR_WINDOW_KEY)
    if (existing) {
      existing.focus()
      if (name) existing.webContents.send(CH.economicIndicatorSelect, name)
      return
    }
    openHashWindow('economicIndicator', selectedIndicator, 900, 760, INDICATOR_WINDOW_KEY)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// The MCP server lives in main, so it answers only while the app is running: no shutdown hook —
// exiting the process closes the listening socket, which is all releasing the port takes.
