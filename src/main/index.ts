import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { configureProxy } from './net/httpClient'
import { CH } from '@shared/ipc'
import { buildCompanyHash } from '@shared/companyWindow'
import { buildChartHash } from '@shared/chartWindow'

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
  win.on('ready-to-show', () => win.show())
  // Closing the main window tears down company windows so window-all-closed fires → app quits.
  win.on('closed', () => {
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
  map.set(key, win)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => map.delete(key))
  loadRenderer(win, hash)
}

app.whenReady().then(async () => {
  // Route provider HTTP through the OS/system proxy (or HTTP(S)_PROXY) before any fetch runs —
  // corporate networks block direct egress, so an unconfigured client times out (see net/httpClient).
  await configureProxy()
  registerIpc()
  ipcMain.handle(CH.companyOpenWindow, (_e, symbol: string) => openHashWindow(companyWindows, symbol, 480, 680, buildCompanyHash(symbol)))
  ipcMain.handle(CH.chartOpenWindow, (_e, cellId: string) => openHashWindow(chartWindows, cellId, 1100, 760, buildChartHash(cellId)))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
