# チャート自動更新（一定間隔リロード）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 表示中チャートを1分間隔で自動リロードする（既存の手動一括リロードをタイマーで叩き、結果を他ウィンドウへ配る）。

**Architecture:** メインウィンドウ（`App`）に唯一のタイマーを置く集中スケジューラ方式。既存の `handleReload` を `reload({ source })` に作り替え、market-status を先に取得してクローズ時は auto を打ち切る。取得結果は新 IPC `refresh:broadcast`→`refresh:applied` で他ウィンドウ（enlarge した `ChartWindow`）へ配信し、受信側は `setQueryData` するだけ（追加 FMP なし）。トグル状態は `settings.json` に永続化。

**Tech Stack:** TypeScript, React, Electron (main/preload/renderer 3層), TanStack Query, Vitest, lucide-react, sonner。

## Global Constraints

- Vite は `^7` にピン留め（既存）。新規依存は追加しない。
- SQLite = OHLCV キャッシュ / JSON(`settings.json`) = ユーザー設定。トグルは JSON 側。
- API 呼び出し節約が最優先。auto はクローズ中フェッチしない／非表示中フェッチしない／ウィンドウ間で重複フェッチしない。
- 新しい FMP フェッチ経路は作らない（既存 `reload` を再利用、結果配信のみ追加）。
- インジケータ（最終更新／失敗／一時停止）はメインウィンドウのみ。`ChartWindow` には出さない。
- 日足フェッチのコスト最適化はスコープ外（issue #17）。
- テスト環境は node 限定（jsdom/RTL/`.tsx` テストなし）。テストは node で動く純粋関数に限定し、タイマー・可視性・ブロードキャスト伝播は手動 UAT。
- 検証コマンド: `npm test`（Vitest）, `npm run typecheck`（tsc web+node）。

---

### Task 1: 自動更新トグルの永続化（settings + IPC 配線）

**Files:**
- Modify: `src/main/settings.ts`（`getAutoRefresh`/`setAutoRefresh` 追加）
- Modify: `src/shared/ipc.ts`（`CH` に 2 チャンネル、`Api.settings` に 2 メソッド）
- Modify: `src/main/ipc.ts`（2 ハンドラ登録）
- Modify: `src/preload/index.ts`（2 メソッド公開）
- Test: `tests/main/settings.test.ts`（autoRefresh の describe 追加）

**Interfaces:**
- Produces:
  - `settings.getAutoRefresh(): boolean`（既定 `false`）
  - `settings.setAutoRefresh(on: boolean): void`
  - `api.settings.getAutoRefresh(): Promise<boolean>`
  - `api.settings.setAutoRefresh(on: boolean): Promise<void>`
  - `CH.settingsGetAutoRefresh = 'settings:getAutoRefresh'`, `CH.settingsSetAutoRefresh = 'settings:setAutoRefresh'`

- [ ] **Step 1: 失敗するテストを書く**

`tests/main/settings.test.ts` の末尾（62行目 `})` の後）に追加:

```ts
describe('settings autoRefresh', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('defaults to false before anything is saved', () => {
    expect(settings.getAutoRefresh()).toBe(false)
  })

  it('round-trips through set → get', () => {
    settings.setAutoRefresh(true)
    expect(settings.getAutoRefresh()).toBe(true)
  })

  it('does not clobber theme when writing autoRefresh', () => {
    settings.setTheme('dark')
    settings.setAutoRefresh(true)
    expect(settings.getTheme()).toBe('dark')
    expect(settings.getAutoRefresh()).toBe(true)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- settings`
Expected: FAIL — `settings.getAutoRefresh is not a function`

- [ ] **Step 3: settings.ts に実装**

`src/main/settings.ts` の `getTheme`/`setTheme` の後（50行目付近）に追加:

```ts
// 自動更新トグル (UI chrome, JSON)。既定は false（明示的にONにするまで回さない）。
export function getAutoRefresh(): boolean {
  return read().autoRefresh === true
}

export function setAutoRefresh(on: boolean): void {
  writeJsonFile(settingsPath(), { ...read(), autoRefresh: on })
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- settings`
Expected: PASS（autoRefresh の 3 ケース含む）

- [ ] **Step 5: IPC チャンネルと Api 型を追加**

`src/shared/ipc.ts` の `CH` オブジェクト、`settingsSetTheme` の行（20行目）の直後に追加:

```ts
  settingsGetAutoRefresh: 'settings:getAutoRefresh',
  settingsSetAutoRefresh: 'settings:setAutoRefresh',
```

同ファイルの `Api.settings` の `setTheme` の行（67行目）の直後に追加:

```ts
    // 自動更新トグル（settings.json、既定 false）。sidebarOpen と同じ UI-chrome 永続化。
    getAutoRefresh(): Promise<boolean>
    setAutoRefresh(on: boolean): Promise<void>
```

- [ ] **Step 6: main のハンドラを登録**

`src/main/ipc.ts` の import 行（9行目）を修正して 2 関数を追加:

```ts
import { getLastSymbol, setLastSymbol, getSidebarOpen, setSidebarOpen, getSidebarWidth, setSidebarWidth, getTheme, setTheme, getAutoRefresh, setAutoRefresh } from './settings'
```

`settingsSetTheme` ハンドラ（152行目）の直後に追加:

```ts
  ipcMain.handle(CH.settingsGetAutoRefresh, () => getAutoRefresh())
  ipcMain.handle(CH.settingsSetAutoRefresh, (_e, on: boolean) => setAutoRefresh(on))
```

- [ ] **Step 7: preload に公開**

`src/preload/index.ts` の `settings` オブジェクト、`setTheme` の行（31行目）の直後に追加（30行目末尾の `,` を確認）:

```ts
    getAutoRefresh: () => ipcRenderer.invoke(CH.settingsGetAutoRefresh),
    setAutoRefresh: (on) => ipcRenderer.invoke(CH.settingsSetAutoRefresh, on)
```

（`setTheme` 行の末尾にカンマを付けること。）

- [ ] **Step 8: typecheck**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 9: コミット**

```bash
git add src/main/settings.ts src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts tests/main/settings.test.ts
git commit -m "feat(settings): persist auto-refresh toggle"
```

---

### Task 2: `reload({ source })` リファクタ（gating + in-flight ガード + インジケータ）

**Files:**
- Create: `src/renderer/lib/autoRefresh.ts`（純粋判定ヘルパー）
- Test: `tests/renderer/autoRefresh.test.ts`
- Modify: `src/renderer/App.tsx`（`handleReload` を `reload` に置換、`refreshState` 追加、ボタン配線）

**Interfaces:**
- Produces:
  - `type ReloadSource = 'manual' | 'auto'`
  - `shouldRefreshData(source: ReloadSource, isOpen: boolean): boolean` — auto かつ closed のみ false。
  - `App` 内 `reload(opts: { source: ReloadSource }): Promise<void>`（Task 3/4 が呼ぶ）
  - `App` 内 `refreshState: { status: 'idle'|'ok'|'failed'|'paused-closed'; lastRefreshedAt: number | null }`

- [ ] **Step 1: 純粋ヘルパーの失敗するテストを書く**

`tests/renderer/autoRefresh.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest'
import { shouldRefreshData } from '@/lib/autoRefresh'

describe('shouldRefreshData', () => {
  it('manual always proceeds (open)', () => {
    expect(shouldRefreshData('manual', true)).toBe(true)
  })
  it('manual always proceeds (closed) — 手動はクローズでも確定日足を取りに行く', () => {
    expect(shouldRefreshData('manual', false)).toBe(true)
  })
  it('auto proceeds when market open', () => {
    expect(shouldRefreshData('auto', true)).toBe(true)
  })
  it('auto stops when market closed — API 節約', () => {
    expect(shouldRefreshData('auto', false)).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- autoRefresh`
Expected: FAIL — `Cannot find module '@/lib/autoRefresh'`

- [ ] **Step 3: 純粋ヘルパーを実装**

`src/renderer/lib/autoRefresh.ts` を新規作成:

```ts
export type ReloadSource = 'manual' | 'auto'

// reload が market-status 取得後に OHLCV/quote へ進むかの判定。
// 手動は常に進む（クローズ後の確定日足を取りに行く）。auto はクローズ中は進まない（API 節約）。
export function shouldRefreshData(source: ReloadSource, isOpen: boolean): boolean {
  return source === 'manual' || isOpen
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- autoRefresh`
Expected: PASS（4 ケース）

- [ ] **Step 5: App.tsx の import と state を更新**

`src/renderer/App.tsx` の 1 行目を修正（`useRef` 追加）:

```tsx
import React, { useEffect, useRef, useState } from 'react'
```

2 行目のアイコン import はこのタスクでは据え置き（Task 3 でトグル用アイコンを追加）。

24 行目の型 import の直後に追加:

```tsx
import { shouldRefreshData, type ReloadSource } from './lib/autoRefresh'
```

61 行目 `const [reloading, setReloading] = useState(false)` の直後に追加:

```tsx
  const inFlight = useRef(false)
  const [refreshState, setRefreshState] = useState<{
    status: 'idle' | 'ok' | 'failed' | 'paused-closed'
    lastRefreshedAt: number | null
  }>({ status: 'idle', lastRefreshedAt: null })
```

- [ ] **Step 6: `handleReload` を `reload` に置換**

`src/renderer/App.tsx` の現行 `handleReload`（63〜107行目、`const handleReload = ...` から対応する閉じ `}` まで）を丸ごと以下で置換:

```tsx
  const reload = async (opts: { source: ReloadSource }): Promise<void> => {
    if (inFlight.current) return // 同期ガード: 手動と auto tick の二重実行を防ぐ（state のラグに依存しない）
    const state = useAppStore.getState()
    const { cells, shape } = state
    const caps = queryClient.getQueryData<Record<Timeframe, CapabilityStatus>>(qk.capabilities())
    const watchlistSymbols = sidebarOpen ? selectActiveItems(state).map((w) => w.symbol) : []
    const targets = refreshTargets(cells, shape, caps, watchlistSymbols)

    inFlight.current = true
    setReloading(true)
    try {
      // market status を先に取得。auto はクローズ中フェッチを打ち切る（API 節約）。
      let isOpen = false
      try {
        const status = await api.market.status()
        queryClient.setQueryData(qk.marketStatus(), status)
        isOpen = status.isOpen
      } catch {
        // status 不明 → 手動は続行、auto は closed 扱いで下の判定によりスキップ。
      }
      if (!shouldRefreshData(opts.source, isOpen)) {
        setRefreshState((s) => ({ status: 'paused-closed', lastRefreshedAt: s.lastRefreshedAt }))
        return
      }
      const results = await Promise.allSettled(
        targets.map(async (t) => {
          const bars = await api.ohlcv.refresh(t.symbol, t.timeframe)
          queryClient.setQueryData(qk.ohlcv(t.symbol, t.timeframe), bars)
        })
      )
      // Capability verdicts may have changed (a refresh re-probes the fetched tf); re-gate the row.
      void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
      if (isOpen) {
        const syms = quoteSymbols(cells, shape, watchlistSymbols)
        await Promise.allSettled(
          syms.map(async (s) => {
            const quote = await api.quote.get(s)
            queryClient.setQueryData(qk.quote(s), quote)
          })
        )
      }
      const failed = results.some((r) => r.status === 'rejected')
      if (failed) toast('Some charts couldn’t be refreshed. Check your connection or FMP plan.')
      setRefreshState({ status: failed ? 'failed' : 'ok', lastRefreshedAt: Date.now() })
    } finally {
      inFlight.current = false
      setReloading(false)
    }
  }
```

- [ ] **Step 7: リロードボタンの onClick を差し替え**

`src/renderer/App.tsx` の `onClick={handleReload}`（139行目付近）を修正:

```tsx
                  onClick={() => void reload({ source: 'manual' })}
```

- [ ] **Step 8: インジケータを表示**

`src/renderer/App.tsx` のリロードボタンの `</Tooltip>`（147行目付近）の直後、`<SearchBar />`（148行目）の直前に追加:

```tsx
            {refreshState.status === 'paused-closed' && (
              <span className="text-xs text-muted-foreground" title="Market closed — auto-refresh paused">
                Paused
              </span>
            )}
            {refreshState.status === 'failed' && (
              <span className="text-xs text-red-500" title="Some charts couldn’t be refreshed">
                Update failed
              </span>
            )}
            {refreshState.status === 'ok' && refreshState.lastRefreshedAt && (
              <span className="text-xs text-muted-foreground">
                Updated {new Date(refreshState.lastRefreshedAt).toLocaleTimeString()}
              </span>
            )}
```

- [ ] **Step 9: typecheck とテスト**

Run: `npm run typecheck && npm test`
Expected: 型エラーなし、全テスト PASS（既存 + autoRefresh）

- [ ] **Step 10: 手動 UAT**

`npm run dev` で起動 → リロードボタンをクリック。従来どおりチャートが更新され、右上に "Updated HH:MM:SS" が出ることを確認。連打しても多重リクエストが走らない（inFlight ガード）ことを DevTools Network で確認。

- [ ] **Step 11: コミット**

```bash
git add src/renderer/lib/autoRefresh.ts tests/renderer/autoRefresh.test.ts src/renderer/App.tsx
git commit -m "refactor(reload): reload({source}) with in-flight guard, closed-gating, indicator"
```

---

### Task 3: 自動更新トグル UI + タイマー + 非表示時一時停止

**Files:**
- Modify: `src/renderer/App.tsx`（トグル state/ボタン、タイマー useEffect、visibilitychange）

**Interfaces:**
- Consumes: `reload({ source: 'auto' })`, `refreshState`（Task 2）、`api.settings.getAutoRefresh/setAutoRefresh`（Task 1）
- Produces: なし（UI 完結）

- [ ] **Step 1: トグルアイコンを import**

`src/renderer/App.tsx` の 2 行目を修正:

```tsx
import { PanelLeftClose, PanelLeftOpen, RefreshCw, Timer, TimerOff } from 'lucide-react'
```

- [ ] **Step 2: トグル state と起動時復元を追加**

`src/renderer/App.tsx` の `refreshState` の `useState`（Task 2 Step 5 で追加した箇所）直後に追加:

```tsx
  const [autoRefresh, setAutoRefresh] = useState(false)
```

35〜43 行目の起動時 `useEffect` 内、`getSidebarWidth` の `.then` ブロックの直後に追加:

```tsx
    void api.settings.getAutoRefresh().then(setAutoRefresh)
```

- [ ] **Step 3: トグルハンドラを追加**

`src/renderer/App.tsx` の `reload` 関数（Task 2）の直後に追加:

```tsx
  const toggleAutoRefresh = (): void => {
    setAutoRefresh((prev) => {
      const next = !prev
      void api.settings.setAutoRefresh(next)
      return next
    })
  }
```

- [ ] **Step 4: タイマーと可視性の useEffect を追加**

`src/renderer/App.tsx` の `toggleAutoRefresh` の直後に追加:

```tsx
  // 集中スケジューラ: タイマーはメインウィンドウ（App）にのみ存在する。ON で即 1 回 + 毎分。
  // 非表示中(document.hidden)は tick をスキップし API を消費しない。再表示で 1 回更新。
  useEffect(() => {
    if (!autoRefresh) return
    const tick = (): void => {
      if (document.hidden) return
      void reload({ source: 'auto' })
    }
    tick() // ON にした瞬間に即 1 回
    const id = setInterval(tick, 60_000)
    const onVisible = (): void => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh])
```

（`reload` は毎レンダー再生成されるが依存に入れると tick 毎に interval が張り直される。`autoRefresh` のみを依存にし、`reload` は最新クロージャを参照する。`reload` は `useAppStore.getState()` で最新 state を読むため陳腐化しない。）

- [ ] **Step 5: トグルボタンを描画**

`src/renderer/App.tsx` のリロードボタンの `</Tooltip>`（Task 2 でインジケータを足した箇所の直前、147行目付近）の直後に、自動更新トグルの Tooltip を追加:

```tsx
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleAutoRefresh}
                  aria-label={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
                >
                  {autoRefresh ? <Timer className="size-4" /> : <TimerOff className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {autoRefresh ? 'Auto-refresh: every 1 min' : 'Auto-refresh: off'}
              </TooltipContent>
            </Tooltip>
```

- [ ] **Step 6: typecheck とテスト**

Run: `npm run typecheck && npm test`
Expected: 型エラーなし、全テスト PASS

- [ ] **Step 7: 手動 UAT**

`npm run dev`。トグル ON → 即リロード＋"Updated..." 表示。1 分待って再更新を確認（または開発時は 60_000 を一時的に 5_000 にして確認、確認後戻す）。市場クローズ時間帯なら OHLCV/quote が飛ばず "Paused" 表示になること、DevTools Network で market-status 以外が飛ばないことを確認。ウィンドウを最小化→復帰で 1 回更新されること。アプリ再起動でトグル状態が復元されることを確認。

- [ ] **Step 8: コミット**

```bash
git add src/renderer/App.tsx
git commit -m "feat(chart): auto-refresh toggle + 1-min scheduler with hidden-pause"
```

---

### Task 4: マルチウィンドウ配信（refresh:broadcast → refresh:applied）

**Files:**
- Modify: `src/shared/ipc.ts`（2 チャンネル、`RefreshAppliedPayload` 型、`Api.refresh`）
- Modify: `src/main/ipc.ts`（forward ハンドラ）
- Modify: `src/preload/index.ts`（`refresh` 名前空間）
- Create: `src/renderer/hooks/useRefreshSync.ts`
- Modify: `src/renderer/components/ChartWindow.tsx`（`useRefreshSync` を使用）
- Modify: `src/renderer/App.tsx`（`reload` 末尾で取得結果をブロードキャスト）

**Interfaces:**
- Consumes: `reload`（Task 2）
- Produces:
  - `type RefreshAppliedPayload = { ohlcv: { symbol: string; timeframe: Timeframe; bars: Bar[] }[]; quotes: { symbol: string; quote: Quote }[]; marketStatus: MarketStatus | null }`
  - `api.refresh.broadcast(p): Promise<void>`, `api.refresh.onApplied(cb): () => void`
  - `CH.refreshBroadcast = 'refresh:broadcast'`, `CH.refreshApplied = 'refresh:applied'`
  - `useRefreshSync(): void`

- [ ] **Step 1: IPC チャンネルと型を追加**

`src/shared/ipc.ts` の 1 行目の import に `Quote, MarketStatus` があることを確認（既にある）。`CH` の `clipboardChanged` の行（30行目）を末尾カンマ付きにし、直後に追加:

```ts
  clipboardChanged: 'clipboard:changed',
  refreshBroadcast: 'refresh:broadcast',
  refreshApplied: 'refresh:applied'
```

`ClipboardPayload` 型（38行目）の直後に追加:

```ts
export type RefreshAppliedPayload = {
  ohlcv: { symbol: string; timeframe: Timeframe; bars: Bar[] }[]
  quotes: { symbol: string; quote: Quote }[]
  marketStatus: MarketStatus | null
}
```

`Api` インターフェイスの `chart` ブロック（88〜90行目）の直後に追加:

```ts
  // スケジューラ（メインウィンドウ）が取得済みデータを他ウィンドウへ配信。受信側は setQueryData
  // するだけで FMP を叩かない。workspaces と同じく main が送信元以外へ転送する。
  refresh: {
    broadcast(p: RefreshAppliedPayload): Promise<void>
    onApplied(cb: (p: RefreshAppliedPayload) => void): () => void
  }
```

- [ ] **Step 2: main の forward ハンドラを追加**

`src/main/ipc.ts` の import（3行目）に `RefreshAppliedPayload` を追加:

```ts
import { CH, type CapabilityStatus, type RefreshAppliedPayload } from '@shared/ipc'
```

`clipboardSet` ハンドラのブロック（189行目 `})` ）の直後に追加:

```ts
  // refresh 配信: 送信元(メインウィンドウ)以外の全ウィンドウへ転送。workspaces/clipboard と同じ規約。
  ipcMain.handle(CH.refreshBroadcast, (e, p: RefreshAppliedPayload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.id !== e.sender.id) {
        w.webContents.send(CH.refreshApplied, p)
      }
    }
  })
```

- [ ] **Step 3: preload に公開**

`src/preload/index.ts` の import（3行目）に `RefreshAppliedPayload` を追加:

```ts
import { CH, type Api, type WorkspacesPayload, type ClipboardPayload, type RefreshAppliedPayload } from '@shared/ipc'
```

`chart` ブロック（56〜58行目）の直後（`}` の前にカンマ）に追加:

```ts
  ,
  refresh: {
    broadcast: (p: RefreshAppliedPayload) => ipcRenderer.invoke(CH.refreshBroadcast, p),
    onApplied: (cb) => {
      const listener = (_e: unknown, p: RefreshAppliedPayload): void => cb(p)
      ipcRenderer.on(CH.refreshApplied, listener)
      return () => ipcRenderer.removeListener(CH.refreshApplied, listener)
    }
  }
```

- [ ] **Step 4: useRefreshSync フックを作成**

`src/renderer/hooks/useRefreshSync.ts` を新規作成:

```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, qk } from '@/api'

// スケジューラ(メインウィンドウ)からの refresh:applied を、このウィンドウの query キャッシュへ適用。
// FMP は叩かない（データは配信済み）。ChartWindow(enlarge 窓)が唯一のスケジューラと同期するための薄い橋。
export function useRefreshSync(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    return api.refresh.onApplied((p) => {
      for (const { symbol, timeframe, bars } of p.ohlcv) {
        queryClient.setQueryData(qk.ohlcv(symbol, timeframe), bars)
      }
      for (const { symbol, quote } of p.quotes) {
        queryClient.setQueryData(qk.quote(symbol), quote)
      }
      if (p.marketStatus) queryClient.setQueryData(qk.marketStatus(), p.marketStatus)
    })
  }, [queryClient])
}
```

- [ ] **Step 5: ChartWindow で購読**

`src/renderer/components/ChartWindow.tsx` の import（5〜6行目付近）に追加:

```tsx
import { useRefreshSync } from '@/hooks/useRefreshSync'
```

`ChartWindow` 本体（17行目 `useWorkspaceSync()` の行）の直後に追加:

```tsx
  useRefreshSync()
```

- [ ] **Step 6: App.tsx の reload でブロードキャスト**

まず `src/renderer/App.tsx` の型 import を拡張。24 行目 `import type { Timeframe } from '@shared/types'` を修正:

```tsx
import type { Timeframe, Quote, MarketStatus } from '@shared/types'
```

次に `reload`（Task 2）の OHLCV 取得部を、取得値を集める形に変更。Task 2 Step 6 で書いた `const results = await Promise.allSettled(...)` ブロックを以下に置換:

```tsx
      let marketStatus: MarketStatus | null = queryClient.getQueryData<MarketStatus>(qk.marketStatus()) ?? null
      const ohlcvResults = await Promise.allSettled(
        targets.map(async (t) => {
          const bars = await api.ohlcv.refresh(t.symbol, t.timeframe)
          queryClient.setQueryData(qk.ohlcv(t.symbol, t.timeframe), bars)
          return { symbol: t.symbol, timeframe: t.timeframe, bars }
        })
      )
      const ohlcv = ohlcvResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      // Capability verdicts may have changed (a refresh re-probes the fetched tf); re-gate the row.
      void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
      const quotes: { symbol: string; quote: Quote }[] = []
      if (isOpen) {
        const syms = quoteSymbols(cells, shape, watchlistSymbols)
        const quoteResults = await Promise.allSettled(
          syms.map(async (s) => {
            const quote = await api.quote.get(s)
            queryClient.setQueryData(qk.quote(s), quote)
            return { symbol: s, quote }
          })
        )
        for (const r of quoteResults) if (r.status === 'fulfilled') quotes.push(r.value)
      }
      // 他ウィンドウ(enlarge 窓)へ配信。受信側は setQueryData のみ（追加 FMP なし）。
      void api.refresh.broadcast({ ohlcv, quotes, marketStatus })
      const failed = ohlcvResults.some((r) => r.status === 'rejected')
      if (failed) toast('Some charts couldn’t be refreshed. Check your connection or FMP plan.')
      setRefreshState({ status: failed ? 'failed' : 'ok', lastRefreshedAt: Date.now() })
```

（この置換により Task 2 Step 6 末尾の `const failed = results.some(...)`〜`setRefreshState(...)` の 3 行は上記に統合される。`isOpen` 判定で `marketStatus` は既に `setQueryData` 済みの値を読む。Task 2 Step 5 で入れた `Quote`/`MarketStatus` import がここで使われる。）

- [ ] **Step 7: typecheck とテスト**

Run: `npm run typecheck && npm test`
Expected: 型エラーなし、全テスト PASS

- [ ] **Step 8: 手動 UAT（マルチウィンドウ）**

`npm run dev`。グリッドのセルを enlarge して別ウィンドウを開く。メインウィンドウで手動リロード（または自動更新 ON）→ enlarge 窓のチャート/価格も更新されることを確認。DevTools（enlarge 窓）Network で FMP リクエストが飛んでいない（配信のみ）ことを確認。

- [ ] **Step 9: コミット**

```bash
git add src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts src/renderer/hooks/useRefreshSync.ts src/renderer/components/ChartWindow.tsx src/renderer/App.tsx
git commit -m "feat(chart): broadcast refresh results to enlarge windows"
```

---

## Self-Review

**Spec coverage:**
- 間隔1分固定 + ON/OFF トグル → Task 3。
- クローズ時 auto 停止（status 先取り）→ Task 2（`shouldRefreshData` + reload 順序）。
- 永続化（settings.json）→ Task 1。
- 非表示時 pause + 再表示で1回 → Task 3（`document.hidden` + `visibilitychange`）。
- マルチウィンドウ集中スケジューラ → Task 3（タイマーは App のみ）+ Task 4（配信）。
- 単一 in-flight ガード（useRef）→ Task 2。
- 状態表示（最終更新/失敗/一時停止）→ Task 2（state）+ 表示。
- 日足最適化 → スコープ外（issue #17）。網羅済み。

**Placeholder scan:** TBD/TODO なし。全コードブロックは実内容。

**Type consistency:** `ReloadSource`（Task 2 定義, Task 3 使用）、`RefreshAppliedPayload`（Task 4 で shared/preload/main/hook 一致）、`refreshState` の union（Task 2 定義, 表示で使用）、`api.settings.getAutoRefresh/setAutoRefresh`（Task 1 定義, Task 3 使用）、`api.refresh.broadcast/onApplied`（Task 4）一致確認済み。`reload({source})` のシグネチャは Task 2/3/4 全てで `{ source: ReloadSource }`。
