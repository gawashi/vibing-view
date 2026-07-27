import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { configureProxy } from './net/httpClient'
import { CH } from '@shared/ipc'
import { buildCompanyHash } from '@shared/companyWindow'
import { buildChartHash } from '@shared/chartWindow'
import { createCore } from './core'
import * as barStore from './db/barStore'
import * as profileStore from './db/profileStore'
import * as companyProfileStore from './db/companyProfileStore'
import * as economicDayStore from './db/economicDayStore'
import * as workspaceStore from './workspaceStore'
import * as capabilityCache from './capabilityCache'
import { getApiKey, setApiKey, getKeyStatus, clearApiKey } from './keystore'
import { FmpProvider } from './providers/FmpProvider'
import { electronHttpGetJson } from './net/httpClient'
import * as mcp from './mcp'
import { getMcpConfig } from './settings'

// One company-info window per symbol (spec: side-by-side compare). Reopening a live symbol focuses
// its window; a new symbol spawns another. Cleared on 'closed'.
const companyWindows = new Map<string, BrowserWindow>()

// One enlarge-chart window per cellId (spec: cellId keying; the same cell re-focuses, a different
// cell spawns another). Cleared on 'closed'. Twin of companyWindows.
const chartWindows = new Map<string, BrowserWindow>()

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
  // Closing the main window tears down company windows so window-all-closed fires → app quits.
  win.on('closed', () => {
    mainWindow = null
    for (const w of companyWindows.values()) w.close()
    for (const w of chartWindows.values()) w.close()
  })
  loadRenderer(win)
}

// One hardened, per-key satellite window keyed in `map`. Reopening a live key focuses it; a new key
// spawns another. Cleared on 'closed'. Backs both the company (per-symbol) and chart (per-cellId) windows.
function openHashWindow(map: Map<string, BrowserWindow>, key: string, width: number, height: number, hash: string): void {
  const existing = map.get(key)
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
  map.set(key, win)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => map.delete(key))
  loadRenderer(win, hash)
}

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
  ipcMain.handle(CH.companyOpenWindow, (_e, symbol: string) => openHashWindow(companyWindows, symbol, 600, 800, buildCompanyHash(symbol)))
  ipcMain.handle(CH.chartOpenWindow, (_e, cellId: string) => openHashWindow(chartWindows, cellId, 1100, 760, buildChartHash(cellId)))
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
