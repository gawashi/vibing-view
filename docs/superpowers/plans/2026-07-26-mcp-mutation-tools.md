# MCP 操作系ツール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude が MCP 経由で Vibing View のワークスペース・チャート配置・インジケータ・ウォッチリストを編集し、UI のリロードボタンと同じ強制更新を起こせるようにする。

**Architecture:** ツール層（`src/main/mcp/mutations.ts` / `workspaceTools.ts`）が引数検証と銘柄解決を行い、`core.workspaces.mutate(fn)` の同期 read-modify-write に純粋関数（`src/main/mcp/edits.ts`）を渡す。書き込みは既存の `workspaces.set` に乗るので、`rev` 採番と全ウィンドウ broadcast はそのまま再利用される。インジケータ定義は `src/shared/indicators/` へ移し、main と renderer が同一ロジックで type 検証・デフォルト補完・色割り当てを行う。`force_reload` だけは renderer にスケジューラがあるため IPC で委譲する。

**Tech Stack:** TypeScript / Electron 43 / React 19 / zod 3 / `@modelcontextprotocol/sdk` / Vitest 3

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-07-26-mcp-mutation-tools-design.md`。決定事項の ID（MW-01〜MW-16）はそこを参照。
- ツール説明・引数説明・エラーメッセージは**英語**。Settings ダイアログの文言とトーストは既存どおり日本語。
- MCP のツール失敗は `isError: true` の結果で返す。**プロトコルエラーを投げない**。
- 日時の入出力は ISO 文字列（既存 `format.ts` の規約）。
- Vite は `^7` に固定。新しい依存は追加しない（zod / vitest は既存）。
- テストは `tests/` 配下。**Electron をテストグラフに入れない**（`electron` を import するモジュールをテストから読まない）。
- `vitest.config.ts` のエイリアス: `@` → `src/renderer`、`@shared` → `src/shared`。
- テスト実行は `npm test`（単発）。型チェックは `npm run typecheck`。
- コミットは各タスク末尾で 1 回。メッセージは既存慣習（`feat:` / `refactor:` / `fix:` / `docs:`）。

---

### Task 1: インジケータモジュールを `src/shared/indicators/` へ移設

`bandPrimitive.ts` だけ renderer に残す（lightweight-charts 依存）。移設だけで振る舞いは一切変えない。

**Files:**
- Move: `src/renderer/indicators/{ma,bb,rsi,macd,volume,math,types,registry}.ts` → `src/shared/indicators/`
- Modify: `src/renderer/indicators/bandPrimitive.ts:12`
- Modify: `src/renderer/components/{AddIndicatorMenu,ApplyToAllToolbar,Chart,IndicatorEditForm,IndicatorLegend,ParamFields}.tsx`
- Modify: `src/renderer/store.ts:3`
- Modify: `tests/indicators/{macd,math.golden,math,rsi,volume}.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `@shared/indicators/registry` の `registry: Record<string, IndicatorModule>`、`@shared/indicators/types` の `IndicatorModule` / `FieldDesc` / `OutputMeta` / `Source` / `LineData` / `HistPoint` / `alignLine` / `sourceValues`

- [ ] **Step 1: 移設前に全テストが通ることを確認**

Run: `npm test`
Expected: PASS（移設の前後で結果が変わらないことを見るための基準値。失敗テストがあるならこのタスクを始めない）

- [ ] **Step 2: ファイルを git mv で移動**

```bash
mkdir -p src/shared/indicators
git mv src/renderer/indicators/ma.ts src/shared/indicators/ma.ts
git mv src/renderer/indicators/bb.ts src/shared/indicators/bb.ts
git mv src/renderer/indicators/rsi.ts src/shared/indicators/rsi.ts
git mv src/renderer/indicators/macd.ts src/shared/indicators/macd.ts
git mv src/renderer/indicators/volume.ts src/shared/indicators/volume.ts
git mv src/renderer/indicators/math.ts src/shared/indicators/math.ts
git mv src/renderer/indicators/types.ts src/shared/indicators/types.ts
git mv src/renderer/indicators/registry.ts src/shared/indicators/registry.ts
```

移動した 8 ファイルの相互 import は全て相対（`./math` / `./types`）なので修正不要。

- [ ] **Step 3: `bandPrimitive.ts` の import を書き換える**

`src/renderer/indicators/bandPrimitive.ts:12` を次のように変更:

```ts
import type { LineData } from '@shared/indicators/types'
```

- [ ] **Step 4: renderer 側の import を書き換える**

以下の 7 ファイルを機械的に置換する（`@/indicators/bandPrimitive` は**変更しない**）。

| ファイル | 変更前 | 変更後 |
|---|---|---|
| `src/renderer/components/AddIndicatorMenu.tsx` | `from '../indicators/registry'` | `from '@shared/indicators/registry'` |
| `src/renderer/components/ApplyToAllToolbar.tsx` | `from '../indicators/registry'` | `from '@shared/indicators/registry'` |
| `src/renderer/components/Chart.tsx` | `from '@/indicators/registry'` | `from '@shared/indicators/registry'` |
| `src/renderer/components/Chart.tsx` | `from '@/indicators/types'` | `from '@shared/indicators/types'` |
| `src/renderer/components/IndicatorEditForm.tsx` | `from '@/indicators/registry'` | `from '@shared/indicators/registry'` |
| `src/renderer/components/IndicatorLegend.tsx` | `from '../indicators/registry'` | `from '@shared/indicators/registry'` |
| `src/renderer/components/ParamFields.tsx` | `from '@/indicators/registry'` | `from '@shared/indicators/registry'` |
| `src/renderer/components/ParamFields.tsx` | `from '@/indicators/types'` | `from '@shared/indicators/types'` |
| `src/renderer/store.ts` | `from './indicators/registry'` | `from '@shared/indicators/registry'` |

- [ ] **Step 5: テストの import を書き換える**

`tests/indicators/` の 5 ファイルで `../../src/renderer/indicators/` を `../../src/shared/indicators/` に置換する。

```bash
grep -rl "src/renderer/indicators/" tests/
```

Expected: 置換後は 0 件

- [ ] **Step 6: 型チェックとテストを走らせる**

Run: `npm run typecheck && npm test`
Expected: PASS（Step 1 と同じ結果。テストの追加も削除もしていない）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move indicator modules to src/shared/indicators (MW-06)"
```

---

### Task 2: `makeIndicatorInstance` / `PALETTE` / `sameParams` を shared に切り出す

インスタンス生成（id 以外）を純粋関数にして、store と MCP が同じ色割り当てを使う。

**Files:**
- Create: `src/shared/indicators/instance.ts`
- Modify: `src/renderer/store.ts:16`（PALETTE 削除）, `:105-152`（makeInstance / sameParams を委譲）
- Test: `tests/indicators/instance.test.ts`

**Interfaces:**
- Consumes: Task 1 の `@shared/indicators/registry`
- Produces:
  - `PALETTE: string[]`
  - `makeIndicatorInstance(type: string, params: Params, base: number, id: string): IndicatorInstance | null`
  - `sameParams(a: Params, b: Params): boolean`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/indicators/instance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PALETTE, makeIndicatorInstance, sameParams } from '../../src/shared/indicators/instance'

describe('makeIndicatorInstance', () => {
  it('returns null for an unknown type', () => {
    expect(makeIndicatorInstance('nope', {}, 0, '1')).toBeNull()
  })

  it('gives a single-output indicator one palette color, picked by add order', () => {
    const inst = makeIndicatorInstance('ma', { kind: 'SMA', period: 20, source: 'close' }, 1, '7')!
    expect(inst.id).toBe('7')
    expect(inst.type).toBe('ma')
    expect(inst.visible).toBe(true)
    expect(inst.colors).toEqual({ line: PALETTE[1] })
  })

  // MACD has 3 outputs and no band: each LINE output walks the palette from `base`.
  it('walks the palette across every output of a multi-line indicator', () => {
    const inst = makeIndicatorInstance('macd', { fast: 12, slow: 26, signal: 9 }, 0, '9')!
    expect(inst.colors.macd).toBe(PALETTE[0])
    expect(inst.colors.signal).toBe(PALETTE[1])
    // The histogram is not a line: it takes the base color, not the next palette slot.
    expect(inst.colors.histogram).toBe(PALETTE[0])
  })

  // BB has a band output: every output shares one color (the band tint is derived from it).
  it('gives every output the same color when the module has a band', () => {
    const inst = makeIndicatorInstance('bb', { period: 20, mult: 2, source: 'close' }, 2, '3')!
    const values = new Set(Object.values(inst.colors))
    expect(values.size).toBe(1)
    expect(values.has(PALETTE[2])).toBe(true)
  })

  it('copies params instead of aliasing the caller object', () => {
    const params = { period: 20 }
    const inst = makeIndicatorInstance('ma', params, 0, '1')!
    params.period = 50
    expect(inst.params.period).toBe(20)
  })
})

describe('sameParams', () => {
  it('is true for identical key sets and values', () => {
    expect(sameParams({ period: 20, kind: 'SMA' }, { kind: 'SMA', period: 20 })).toBe(true)
  })

  it('is false when a value differs', () => {
    expect(sameParams({ period: 20 }, { period: 50 })).toBe(false)
  })

  it('is false when the key count differs', () => {
    expect(sameParams({ period: 20 }, { period: 20, kind: 'SMA' })).toBe(false)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/indicators/instance.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/shared/indicators/instance"`

- [ ] **Step 3: `src/shared/indicators/instance.ts` を作る**

`src/renderer/store.ts` の `PALETTE`（16 行目）、`makeInstance`（135-152 行目）、`sameParams`（154-158 行目）をそのまま移す。id 採番だけ引数に外出しする。

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/indicators/instance.test.ts`
Expected: PASS

- [ ] **Step 5: `store.ts` を委譲に書き換える**

`src/renderer/store.ts`:

1. 16 行目の `export const PALETTE = [...]` の 2 行（コメント含む）を削除する。他に import 元は無い（`grep -rn PALETTE src tests` が store.ts しか出さないことを Task 2 開始前に確認済み）。
2. import に追加:

```ts
import { makeIndicatorInstance, sameParams } from '@shared/indicators/instance'
```

3. クロージャ内の `makeInstance`（コメント含む 135-152 行目）を次に置き換える:

```ts
  // Palette/colors/params live in the shared builder so MCP writes identical instances (MW-06).
  // The store keeps id minting (module-level nextId); an unknown type must not burn an id.
  const makeInstance = (type: string, params: Params, base: number): IndicatorInstance | null =>
    registry[type] ? makeIndicatorInstance(type, params, base, String(nextId++)) : null
```

4. ローカルの `sameParams`（154-158 行目）を削除する（import 版が使われる）。

- [ ] **Step 6: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: PASS（`tests/renderer/store.test.ts` を含め既存が全て通ること。色割り当てが変わっていない証拠になる）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: share indicator instance construction between store and main"
```

---

### Task 3: params 検証ユーティリティ

`FieldDesc` を使って MCP から来た params を検証し、ツール説明用のカタログ文字列も作る。

**Files:**
- Create: `src/shared/indicators/validate.ts`
- Test: `tests/indicators/validate.test.ts`

**Interfaces:**
- Consumes: Task 1 の `registry`、`FieldDesc`
- Produces:
  - `paramFields(type: string): FieldDesc[]` — `kind !== 'color'` のみ（MW-15）
  - `validateParams(type: string, patch: Params): { ok: true; params: Params } | { ok: false; message: string }`
  - `defaultParams(type: string): Params`
  - `indicatorCatalog(): string` — `ma(period, kind, source), bb(period, mult, source), ...`
  - `INDICATOR_TYPES: string[]`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/indicators/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  INDICATOR_TYPES, defaultParams, indicatorCatalog, paramFields, validateParams
} from '../../src/shared/indicators/validate'

describe('paramFields', () => {
  // MW-15: `color` is a FieldDesc but NOT a param — it writes instance.colors via a separate path.
  it('drops the color field', () => {
    expect(paramFields('ma').map((f) => f.key)).toEqual(['period', 'kind', 'source'])
  })

  it('is empty for a module with no editable params', () => {
    expect(paramFields('volume')).toEqual([])
  })
})

describe('defaultParams', () => {
  it('returns a copy of the module defaults', () => {
    const a = defaultParams('ma')
    a.period = 999
    expect(defaultParams('ma').period).toBe(20)
  })
})

describe('validateParams', () => {
  it('accepts a valid patch', () => {
    expect(validateParams('ma', { period: 50 })).toEqual({ ok: true, params: { period: 50 } })
  })

  it('rejects an unknown key and lists the real ones', () => {
    expect(validateParams('ma', { length: 50 })).toEqual({
      ok: false,
      message: '"length" is not a parameter of ma. Parameters: period, kind, source.'
    })
  })

  // MW-15: silently storing a `color` param would write a key the renderer never reads.
  it('rejects color with a pointer to the right argument', () => {
    expect(validateParams('ma', { color: '#ffffff' })).toEqual({
      ok: false,
      message: 'color is not a parameter — use the color argument of update_indicator.'
    })
  })

  it('rejects a non-numeric number field', () => {
    expect(validateParams('ma', { period: 'abc' })).toEqual({
      ok: false, message: 'period must be a number >= 1.'
    })
  })

  it('rejects a number below min', () => {
    expect(validateParams('ma', { period: 0 })).toEqual({
      ok: false, message: 'period must be a number >= 1.'
    })
  })

  it('rejects a value outside a select field options', () => {
    expect(validateParams('ma', { kind: 'WMA' })).toEqual({
      ok: false, message: 'kind must be one of SMA, EMA.'
    })
  })

  it('rejects an unknown source', () => {
    expect(validateParams('ma', { source: 'vwap' })).toEqual({
      ok: false, message: 'source must be one of close, open, high, low, hl2, hlc3.'
    })
  })

  it('rejects an unknown indicator type', () => {
    expect(validateParams('sma', { period: 5 })).toEqual({
      ok: false,
      message: `Unknown indicator "sma". Available: ${INDICATOR_TYPES.join(', ')}.`
    })
  })
})

describe('indicatorCatalog', () => {
  it('lists every registered type with its parameter names', () => {
    const text = indicatorCatalog()
    expect(text).toContain('ma(period, kind, source)')
    expect(text).toContain('volume()')
    for (const type of INDICATOR_TYPES) expect(text).toContain(type)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/indicators/validate.test.ts`
Expected: FAIL — モジュールが解決できない

- [ ] **Step 3: `src/shared/indicators/validate.ts` を実装**

```ts
import { registry } from './registry'
import type { FieldDesc } from './types'
import type { Params } from '@shared/types'

export const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3'] as const

export const INDICATOR_TYPES = Object.keys(registry)

// MW-15: a `kind: 'color'` FieldDesc describes instance.colors, not params — ParamFields skips it
// and no module's `defaults` contains it. Treating it as a param would write a key nothing reads.
export function paramFields(type: string): FieldDesc[] {
  return (registry[type]?.params ?? []).filter((f) => f.kind !== 'color')
}

export function defaultParams(type: string): Params {
  return { ...(registry[type]?.defaults ?? {}) }
}

const unknownType = (type: string): string =>
  `Unknown indicator "${type}". Available: ${INDICATOR_TYPES.join(', ')}.`

export type ParamCheck = { ok: true; params: Params } | { ok: false; message: string }

// Validates a PARTIAL patch: only the keys present are checked, so update_indicator can merge.
// Values are rejected rather than coerced — `period: "abc"` would render as NaN and read to the
// model as a success.
export function validateParams(type: string, patch: Params): ParamCheck {
  if (!registry[type]) return { ok: false, message: unknownType(type) }
  const fields = paramFields(type)
  const names = fields.map((f) => f.key)
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'color') {
      return { ok: false, message: 'color is not a parameter — use the color argument of update_indicator.' }
    }
    const field = fields.find((f) => f.key === key)
    if (!field) {
      return { ok: false, message: `"${key}" is not a parameter of ${type}. Parameters: ${names.join(', ')}.` }
    }
    if (field.kind === 'number') {
      const min = field.min ?? Number.NEGATIVE_INFINITY
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
        const bound = field.min === undefined ? '' : ` >= ${field.min}`
        return { ok: false, message: `${key} must be a number${bound}.` }
      }
    }
    if (field.kind === 'select' && !field.options.includes(String(value))) {
      return { ok: false, message: `${key} must be one of ${field.options.join(', ')}.` }
    }
    if (field.kind === 'source' && !(SOURCES as readonly string[]).includes(String(value))) {
      return { ok: false, message: `${key} must be one of ${SOURCES.join(', ')}.` }
    }
  }
  return { ok: true, params: patch }
}

// Generated from the registry so the tool description never drifts from the modules (MW-06).
export function indicatorCatalog(): string {
  return INDICATOR_TYPES.map((type) => `${type}(${paramFields(type).map((f) => f.key).join(', ')})`).join(', ')
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/indicators/validate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/indicators/validate.ts tests/indicators/validate.test.ts
git commit -m "feat: validate indicator params from the registry FieldDesc (MW-15)"
```

---

### Task 4: `get_workspace` の出力にインジケータ id を出す

`update_indicator` / `remove_indicator` は id で対象を指すので、読み取り側に id が出ていないと操作系ツールが成立しない（MW-12）。

**Files:**
- Modify: `src/main/mcp/format.ts:115-138`
- Test: `tests/main/mcp/format.test.ts:142-151`

**Interfaces:**
- Consumes: なし
- Produces: `formatWorkspaceDetail(w: Workspace, isActive: boolean): string` — セル行が `- [c1] NVDA 1d — [i1] ma(period=20)` 形式

- [ ] **Step 1: 期待値を新形式に書き換える（失敗させる）**

`tests/main/mcp/format.test.ts` の `describe('formatWorkspaceDetail')` を差し替える。既存フィクスチャ `workspace('Main')` の `c1` のインジケータには id が必要なので、フィクスチャも合わせて確認し、`ma` インスタンスの id が `i1`、`visible` が省略（= true）になるようにする。

```ts
describe('formatWorkspaceDetail', () => {
  it('prints the watchlist and every cell with its indicators', () => {
    const text = formatWorkspaceDetail(workspace('Main'), true)
    expect(text).toContain('Workspace: Main (active)')
    expect(text).toContain('Grid: 2 rows x 2 cols, active cell: c1')
    expect(text).toContain('- NVDA — NVIDIA Corporation (NASDAQ)')
    expect(text).toContain('- [c1] NVDA 1d — [i1] ma(period=20)')
    expect(text).toContain('- [c2] (empty) 5m — no indicators')
  })

  // MW-12: the id is what update_indicator/remove_indicator take, so it must be readable here.
  it('marks a hidden indicator and leaves visible ones unmarked', () => {
    const w = workspace('Main')
    const cell = w.layout.cells[0]
    cell.indicators = [
      { id: 'i1', type: 'ma', params: { period: 20 }, colors: {}, visible: true },
      { id: 'i2', type: 'rsi', params: { period: 14 }, colors: {}, visible: false }
    ]
    const text = formatWorkspaceDetail(w, false)
    expect(text).toContain('[i1] ma(period=20), [i2] rsi(period=14, hidden)')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/mcp/format.test.ts`
Expected: FAIL — 現在の出力は `- [c1] NVDA 1d — ma(period=20)`（id なし）

- [ ] **Step 3: `formatIndicator` を書き換える**

`src/main/mcp/format.ts:115-118` を差し替える。

```ts
// MW-12: the instance id is printed because update_indicator / remove_indicator take it. `colors`
// and `fixed` stay out: colour is echoed by update_indicator's own response, and `fixed` is
// explained by remove_indicator's error when it refuses.
const formatIndicator = (i: {
  id: string; type: string; params: Record<string, number | string>; visible: boolean
}): string => {
  const parts = Object.entries(i.params).map(([k, v]) => `${k}=${v}`)
  if (!i.visible) parts.push('hidden')
  return parts.length > 0 ? `[${i.id}] ${i.type}(${parts.join(', ')})` : `[${i.id}] ${i.type}`
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/mcp/format.test.ts`
Expected: PASS

- [ ] **Step 5: 全テストと型チェック**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/format.ts tests/main/mcp/format.test.ts
git commit -m "feat(mcp): print indicator ids in get_workspace (MW-12)"
```

---

### Task 5: `ProfileService` が「一致なし」をキャッシュしないようにする

現状は一致しなかったフォールバックを永続キャッシュするため、一度弾かれた銘柄が以後ずっと 0 リクエストで弾かれ続ける（MW-13）。

**Files:**
- Modify: `src/main/profile/ProfileService.ts:25-28`
- Test: `tests/main/profile/ProfileService.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `getProfile(symbol)` は一致時のみ `upsertProfile` を呼ぶ。未解決時の戻り値は従来どおり `{ symbol, name: symbol, exchange: '' }`

- [ ] **Step 1: 失敗するテストを追記**

`tests/main/profile/ProfileService.test.ts` に追加:

```ts
  // MW-13: caching the miss would make a valid ticker permanently unresolvable for MCP's
  // set_chart / edit_watchlist, which reject `exchange === ''`.
  it('does not cache the fallback when the search returns no match', async () => {
    const upsertProfile = vi.fn()
    const service = createProfileService({
      store: { getProfile: () => null, upsertProfile },
      search: async () => [{ symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' }]
    })
    const result = await service.getProfile('XYZ')
    expect(result).toEqual({ symbol: 'XYZ', name: 'XYZ', exchange: '' })
    expect(upsertProfile).not.toHaveBeenCalled()
  })

  it('still caches a real match', async () => {
    const upsertProfile = vi.fn()
    const service = createProfileService({
      store: { getProfile: () => null, upsertProfile },
      search: async () => [{ symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' }]
    })
    await service.getProfile('NVDA')
    expect(upsertProfile).toHaveBeenCalledWith({ symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' })
  })
```

既存テストに「一致なしでも upsert する」ことを固定しているケースがあれば、それは MW-13 で意図的に変える挙動なので削除する。

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/profile/ProfileService.test.ts`
Expected: FAIL — `upsertProfile` が 1 回呼ばれている

- [ ] **Step 3: 一致時だけキャッシュする**

`src/main/profile/ProfileService.ts:25-28` を差し替える。

```ts
      const match = results.find((r) => r.symbol.toLowerCase() === symbol.toLowerCase())
      // MW-13: only a real match is cached. Persisting the "no match" fallback would answer every
      // later lookup from disk, so a ticker FMP's search missed once could never resolve again.
      if (match) store.upsertProfile(match)
      return match ?? { symbol, name: symbol, exchange: '' }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/profile/ProfileService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/profile/ProfileService.ts tests/main/profile/ProfileService.test.ts
git commit -m "fix: stop caching unresolved symbol lookups (MW-13)"
```

---

### Task 6: `edits.ts` の共通ヘルパと `setChart`

collection を受けて collection を返す純粋関数群。ここから Task 9 までが編集ロジックの本体。

**Files:**
- Create: `src/main/mcp/edits.ts`
- Test: `tests/main/mcp/edits.layout.test.ts`

**Interfaces:**
- Consumes: `@shared/workspace` の `cellCount` / `newCellSeed`、`@shared/types`
- Produces:
  - `type EditResult<T> = { ok: true; collection: WorkspaceCollection; value: T } | { ok: false; message: string }`
  - `makeIdMinter(c: WorkspaceCollection): () => string`
  - `pickWorkspace(c, name?): Workspace | undefined`
  - `missingWorkspace(c, name?): string`
  - `visibleCells(w: Workspace): Cell[]`
  - `setChart(c, a: SetChartArgs): EditResult<SetChartInfo>`
  - `type SetChartArgs = { workspace?: string; cell: string; symbol?: string | null; timeframe?: Timeframe }`
  - `type SetChartInfo = { workspaceName: string; cells: Cell[]; hidden: boolean }`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/main/mcp/edits.layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeIdMinter, pickWorkspace, setChart, visibleCells } from '../../../src/main/mcp/edits'
import type { Cell, IndicatorInstance, WorkspaceCollection } from '@shared/types'

const vol = (id: string): IndicatorInstance =>
  ({ id, type: 'volume', params: {}, colors: {}, visible: true, fixed: true })
const ma = (id: string): IndicatorInstance =>
  ({ id, type: 'ma', params: { period: 20 }, colors: { line: '#fff' }, visible: true })

const cell = (id: string, symbol: string | null, indicators: IndicatorInstance[] = [vol(`v${id}`)]): Cell =>
  ({ id, symbol, timeframe: '1d', indicators })

// 2 visible cells (1x2) plus one hidden cell kept in the array — the shape the grid uses when the
// user shrinks a 2x2 back down.
const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [
    {
      name: 'Main',
      items: [],
      layout: {
        schemaVersion: 1,
        shape: { rows: 1, cols: 2 },
        activeCellId: '1',
        cells: [cell('1', 'NVDA'), cell('2', null), cell('3', 'AMD')]
      }
    },
    {
      name: 'Other',
      items: [],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '10', cells: [cell('10', 'TSLA')]
      }
    }
  ]
})

describe('makeIdMinter', () => {
  it('starts past the highest numeric id anywhere in the collection', () => {
    const mint = makeIdMinter(collection())
    // ids present: cells 1,2,3,10 and volume ids v1,v2,v3,v10 (non-numeric, ignored)
    expect(mint()).toBe('11')
    expect(mint()).toBe('12')
  })

  it('ignores non-numeric ids instead of throwing', () => {
    const c = collection()
    c.workspaces[0].layout.cells[0].id = 'abc'
    expect(makeIdMinter(c)()).toBe('11')
  })
})

describe('pickWorkspace / visibleCells', () => {
  it('defaults to the active workspace', () => {
    expect(pickWorkspace(collection())?.name).toBe('Main')
  })

  it('returns undefined for an unknown name', () => {
    expect(pickWorkspace(collection(), 'Nope')).toBeUndefined()
  })

  // MW-08: cells past rows*cols are kept in the array but are not visible.
  it('slices the visible cells off the front', () => {
    const w = pickWorkspace(collection())!
    expect(visibleCells(w).map((x) => x.id)).toEqual(['1', '2'])
  })
})

describe('setChart', () => {
  it('sets the symbol of one cell and leaves the others alone', () => {
    const res = setChart(collection(), { cell: '2', symbol: 'AAPL' })
    if (!res.ok) throw new Error(res.message)
    const cells = res.collection.workspaces[0].layout.cells
    expect(cells.map((x) => x.symbol)).toEqual(['NVDA', 'AAPL', 'AMD'])
  })

  it('sets the timeframe without touching the symbol', () => {
    const res = setChart(collection(), { cell: '1', timeframe: '5m' })
    if (!res.ok) throw new Error(res.message)
    const target = res.collection.workspaces[0].layout.cells[0]
    expect(target).toMatchObject({ symbol: 'NVDA', timeframe: '5m' })
  })

  // Parity with the UI's clearCell: user indicators go, the always-on fixed Volume stays (D-34).
  it('clearing a cell drops user indicators but keeps the fixed volume', () => {
    const c = collection()
    c.workspaces[0].layout.cells[0].indicators = [vol('v1'), ma('m1')]
    const res = setChart(c, { cell: '1', symbol: null })
    if (!res.ok) throw new Error(res.message)
    const target = res.collection.workspaces[0].layout.cells[0]
    expect(target.symbol).toBeNull()
    expect(target.indicators.map((i) => i.id)).toEqual(['v1'])
  })

  // MW-08: "all" means the VISIBLE cells only — cell 3 is off-grid at 1x2.
  it('cell "all" only touches the visible cells', () => {
    const res = setChart(collection(), { cell: 'all', timeframe: '1h' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells.map((x) => x.timeframe)).toEqual(['1h', '1h', '1d'])
  })

  it('targets a named workspace instead of the active one', () => {
    const res = setChart(collection(), { workspace: 'Other', cell: '10', symbol: 'MSFT' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[1].layout.cells[0].symbol).toBe('MSFT')
    expect(res.collection.workspaces[0].layout.cells[0].symbol).toBe('NVDA')
  })

  it('reports an unknown cell with the ids that do exist', () => {
    const res = setChart(collection(), { cell: '9', symbol: 'AAPL' })
    expect(res).toEqual({ ok: false, message: 'No cell "9" in workspace "Main". Cells: 1, 2, 3.' })
  })

  it('reports an unknown workspace with the names that do exist', () => {
    const res = setChart(collection(), { workspace: 'Nope', cell: '1', symbol: 'AAPL' })
    expect(res).toEqual({ ok: false, message: 'No workspace named "Nope". Available: Main, Other' })
  })

  // MW-09: writing to an off-grid cell is allowed but must be reported, or the model leaves a
  // chart nobody can see and calls it done.
  it('flags a write to a cell outside the visible grid', () => {
    const res = setChart(collection(), { cell: '3', symbol: 'AAPL' })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.hidden).toBe(true)
  })

  it('does not flag a write to a visible cell', () => {
    const res = setChart(collection(), { cell: '1', symbol: 'AAPL' })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.hidden).toBe(false)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/mcp/edits.layout.test.ts`
Expected: FAIL — `src/main/mcp/edits` が存在しない

- [ ] **Step 3: `src/main/mcp/edits.ts` を作る**

```ts
import { cellCount } from '@shared/workspace'
import type { Cell, Timeframe, Workspace, WorkspaceCollection } from '@shared/types'

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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/mcp/edits.layout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/edits.ts tests/main/mcp/edits.layout.test.ts
git commit -m "feat(mcp): pure setChart editor over the workspace collection"
```

---

### Task 7: `edits.ts` に `setGridLayout` を足す

**Files:**
- Modify: `src/main/mcp/edits.ts`
- Test: `tests/main/mcp/edits.layout.test.ts`

**Interfaces:**
- Consumes: Task 6 の `EditResult` / `makeIdMinter` / `pickWorkspace` / `withWorkspace`
- Produces: `setGridLayout(c, a: { workspace?: string; rows: number; cols: number }): EditResult<{ workspaceName: string; shape: GridShape; visible: Cell[] }>`

- [ ] **Step 1: 失敗するテストを追記**

`tests/main/mcp/edits.layout.test.ts` の末尾に追加（先頭の import に `setGridLayout` を足す）:

```ts
describe('setGridLayout', () => {
  it('grows the cells array with fresh seeds when the grid gets bigger', () => {
    const res = setGridLayout(collection(), { rows: 2, cols: 2 })
    if (!res.ok) throw new Error(res.message)
    const cells = res.collection.workspaces[0].layout.cells
    expect(cells).toHaveLength(4)
    // The new cell is a seed: empty, 1d, one fixed Volume, minted past every existing id.
    expect(cells[3]).toMatchObject({ id: '11', symbol: null, timeframe: '1d' })
    expect(cells[3].indicators).toEqual([
      { id: '12', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }
    ])
  })

  // A shrink must not lose work: the off-grid cells stay in the array so growing back restores them.
  it('keeps off-grid cells when the grid gets smaller', () => {
    const res = setGridLayout(collection(), { rows: 1, cols: 1 })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells.map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(res.collection.workspaces[0].layout.shape).toEqual({ rows: 1, cols: 1 })
  })

  // Parity with store.setShape: an active cell pushed off-grid moves to the first visible one.
  it('moves the active cell when a shrink hides it', () => {
    const c = collection()
    c.workspaces[0].layout.activeCellId = '2'
    const res = setGridLayout(c, { rows: 1, cols: 1 })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.activeCellId).toBe('1')
  })

  it('leaves the active cell alone when it stays visible', () => {
    const c = collection()
    c.workspaces[0].layout.activeCellId = '2'
    const res = setGridLayout(c, { rows: 2, cols: 2 })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.activeCellId).toBe('2')
  })

  it('reports an unknown workspace', () => {
    expect(setGridLayout(collection(), { workspace: 'Nope', rows: 1, cols: 1 })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/mcp/edits.layout.test.ts`
Expected: FAIL — `setGridLayout is not a function`

- [ ] **Step 3: `setGridLayout` を実装**

`src/main/mcp/edits.ts` の import を差し替え、末尾に追加する。

```ts
import { cellCount, newCellSeed } from '@shared/workspace'
import type { Cell, GridShape, Timeframe, Workspace, WorkspaceCollection } from '@shared/types'
```

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/mcp/edits.layout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/edits.ts tests/main/mcp/edits.layout.test.ts
git commit -m "feat(mcp): pure setGridLayout editor"
```

---

### Task 8: `edits.ts` にインジケータ編集 3 種を足す

**Files:**
- Modify: `src/main/mcp/edits.ts`
- Test: `tests/main/mcp/edits.indicators.test.ts`

**Interfaces:**
- Consumes: Task 2 の `makeIndicatorInstance` / `sameParams`、Task 1 の `registry`、Task 6 のヘルパ
- Produces:
  - `addIndicator(c, a: { workspace?: string; cell: string; type: string; params: Params }): EditResult<{ workspaceName: string; added: { cellId: string; instance: IndicatorInstance }[]; skipped: number }>`
  - `updateIndicator(c, a: { workspace?: string; indicator: string; params?: Params; visible?: boolean; color?: string }): EditResult<{ workspaceName: string; cellId: string; instance: IndicatorInstance }>`
  - `removeIndicator(c, a: { workspace?: string; indicator?: string; cell?: string }): EditResult<{ workspaceName: string; removed: number; keptFixed: number }>`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/main/mcp/edits.indicators.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { addIndicator, removeIndicator, updateIndicator } from '../../../src/main/mcp/edits'
import { PALETTE } from '../../../src/shared/indicators/instance'
import type { Cell, IndicatorInstance, WorkspaceCollection } from '@shared/types'

const vol = (id: string): IndicatorInstance =>
  ({ id, type: 'volume', params: {}, colors: {}, visible: true, fixed: true })
const ma = (id: string): IndicatorInstance =>
  ({ id, type: 'ma', params: { kind: 'SMA', period: 20, source: 'close' }, colors: { line: PALETTE[0] }, visible: true })

const cell = (id: string, indicators: IndicatorInstance[]): Cell =>
  ({ id, symbol: 'NVDA', timeframe: '1d', indicators })

const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [{
    name: 'Main',
    items: [],
    layout: {
      schemaVersion: 1,
      shape: { rows: 1, cols: 2 },
      activeCellId: '1',
      cells: [cell('1', [vol('4'), ma('5')]), cell('2', [vol('6')]), cell('3', [vol('7')])]
    }
  }]
})

describe('addIndicator', () => {
  it('appends an instance with a minted id and palette color', () => {
    const res = addIndicator(collection(), { cell: '2', type: 'rsi', params: { period: 14 } })
    if (!res.ok) throw new Error(res.message)
    const added = res.collection.workspaces[0].layout.cells[1].indicators[1]
    expect(added).toMatchObject({ id: '8', type: 'rsi', params: { period: 14 }, visible: true })
    expect(res.value.added).toEqual([{ cellId: '2', instance: added }])
  })

  // Parity with addIndicatorToAll: bulk adds skip a cell that already has the same type+params.
  it('cell "all" skips cells that already have the identical indicator', () => {
    const res = addIndicator(collection(), {
      cell: 'all', type: 'ma', params: { kind: 'SMA', period: 20, source: 'close' }
    })
    if (!res.ok) throw new Error(res.message)
    const cells = res.collection.workspaces[0].layout.cells
    expect(cells[0].indicators).toHaveLength(2) // already had that exact ma
    expect(cells[1].indicators).toHaveLength(2) // added
    expect(cells[2].indicators).toHaveLength(1) // off-grid at 1x2, untouched (MW-08)
    expect(res.value.skipped).toBe(1)
  })

  // Parity with addIndicator: a single-cell add never dedupes — two identical MAs are legal.
  it('a single-cell add does not dedupe', () => {
    const res = addIndicator(collection(), {
      cell: '1', type: 'ma', params: { kind: 'SMA', period: 20, source: 'close' }
    })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells[0].indicators).toHaveLength(3)
  })

  it('reports an unknown cell', () => {
    expect(addIndicator(collection(), { cell: '9', type: 'rsi', params: {} })).toEqual({
      ok: false, message: 'No cell "9" in workspace "Main". Cells: 1, 2, 3.'
    })
  })
})

describe('updateIndicator', () => {
  it('merges params, leaving untouched keys alone', () => {
    const res = updateIndicator(collection(), { indicator: '5', params: { period: 50 } })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.instance.params).toEqual({ kind: 'SMA', period: 50, source: 'close' })
  })

  it('toggles visibility', () => {
    const res = updateIndicator(collection(), { indicator: '5', visible: false })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.instance.visible).toBe(false)
  })

  // MW-16: the UI fans one colour across every output; writing only the first key would leave
  // MACD's lines mismatched against what the edit dialog produces.
  it('writes the color to every output key', () => {
    const c = collection()
    c.workspaces[0].layout.cells[0].indicators.push({
      id: '9', type: 'macd', params: { fast: 12, slow: 26, signal: 9 },
      colors: { macd: PALETTE[0], signal: PALETTE[1], histogram: PALETTE[0] }, visible: true
    })
    const res = updateIndicator(c, { indicator: '9', color: '#123456' })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.instance.colors).toEqual({
      macd: '#123456', signal: '#123456', histogram: '#123456'
    })
  })

  it('finds an indicator in any cell of the workspace', () => {
    const res = updateIndicator(collection(), { indicator: '6', visible: false })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.cellId).toBe('2')
  })

  it('reports an unknown indicator id', () => {
    expect(updateIndicator(collection(), { indicator: '99', visible: false })).toEqual({
      ok: false, message: 'No indicator "99". Use get_workspace to list indicator ids.'
    })
  })
})

describe('removeIndicator', () => {
  it('removes one instance by id', () => {
    const res = removeIndicator(collection(), { indicator: '5' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells[0].indicators.map((i) => i.id)).toEqual(['4'])
    expect(res.value.removed).toBe(1)
  })

  // Volume is fixed (D-34): the UI's removeIndicator ignores it, so MCP must too.
  it('refuses to remove a fixed indicator', () => {
    const res = removeIndicator(collection(), { indicator: '4' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells[0].indicators).toHaveLength(2)
    expect(res.value).toMatchObject({ removed: 0, keptFixed: 1 })
  })

  it('clears every user indicator in one cell', () => {
    const res = removeIndicator(collection(), { cell: '1' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells[0].indicators.map((i) => i.id)).toEqual(['4'])
    expect(res.value).toMatchObject({ removed: 1, keptFixed: 1 })
  })

  it('cell "all" only clears the visible cells', () => {
    const c = collection()
    c.workspaces[0].layout.cells[2].indicators.push(ma('8'))
    const res = removeIndicator(c, { cell: 'all' })
    if (!res.ok) throw new Error(res.message)
    const cells = res.collection.workspaces[0].layout.cells
    expect(cells[0].indicators.map((i) => i.id)).toEqual(['4'])
    expect(cells[2].indicators.map((i) => i.id)).toEqual(['7', '8']) // off-grid, untouched
  })

  it('reports an unknown indicator id', () => {
    expect(removeIndicator(collection(), { indicator: '99' })).toEqual({
      ok: false, message: 'No indicator "99". Use get_workspace to list indicator ids.'
    })
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/mcp/edits.indicators.test.ts`
Expected: FAIL — `addIndicator is not a function`

- [ ] **Step 3: 3 関数を実装**

`src/main/mcp/edits.ts` に import と実装を足す。

```ts
import { registry } from '@shared/indicators/registry'
import { makeIndicatorInstance, sameParams } from '@shared/indicators/instance'
import type { IndicatorInstance, Params } from '@shared/types'
```

```ts
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
  const targets = a.cell === 'all' ? visibleCells(w) : w.layout.cells.filter((x) => x.id === a.cell)
  if (targets.length === 0) {
    return editFail(
      `No cell "${a.cell}" in workspace "${w.name}". Cells: ${w.layout.cells.map((x) => x.id).join(', ')}.`
    )
  }
  const ids = new Set(targets.map((t) => t.id))
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
  if (a.params) next.params = { ...next.params, ...a.params }
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
    const targets = a.cell === 'all' ? visibleCells(w) : w.layout.cells.filter((x) => x.id === a.cell)
    if (targets.length === 0) {
      return editFail(
        `No cell "${a.cell}" in workspace "${w.name}". Cells: ${w.layout.cells.map((x) => x.id).join(', ')}.`
      )
    }
    const ids = new Set(targets.map((t) => t.id))
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/mcp/edits.indicators.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/edits.ts tests/main/mcp/edits.indicators.test.ts
git commit -m "feat(mcp): pure indicator editors (add/update/remove)"
```

---

### Task 9: `edits.ts` にウォッチリストとワークスペース操作を足す

**Files:**
- Modify: `src/main/mcp/edits.ts`
- Test: `tests/main/mcp/edits.workspaces.test.ts`

**Interfaces:**
- Consumes: Task 6/7 のヘルパ、`@shared/workspace` の `defaultLayout`
- Produces:
  - `editWatchlist(c, a: { workspace?: string; add: WatchlistItem[]; remove: string[] }): EditResult<{ workspaceName: string; items: WatchlistItem[]; addedCount: number; removedCount: number }>`
  - `createWorkspace(c, a: { name: string; copyFrom?: string; activate: boolean }): EditResult<{ name: string }>`
  - `renameWorkspace(c, a: { from: string; to: string }): EditResult<{ name: string }>`
  - `deleteWorkspace(c, a: { name: string }): EditResult<{ name: string; cellCount: number; symbols: string[]; watchlistCount: number; activeNow: string }>`
  - `activateWorkspace(c, a: { name: string }): EditResult<{ name: string }>`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/main/mcp/edits.workspaces.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  activateWorkspace, createWorkspace, deleteWorkspace, editWatchlist, renameWorkspace
} from '../../../src/main/mcp/edits'
import type { WatchlistItem, WorkspaceCollection } from '@shared/types'

const item = (symbol: string): WatchlistItem => ({ symbol, name: `${symbol} Inc.`, exchange: 'NASDAQ' })

const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [
    {
      name: 'Main',
      items: [item('NVDA')],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '1',
        cells: [{
          id: '1', symbol: 'NVDA', timeframe: '1d',
          indicators: [{ id: '2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }]
        }]
      }
    },
    {
      name: 'Other',
      items: [],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '3',
        cells: [{ id: '3', symbol: null, timeframe: '1d', indicators: [] }]
      }
    }
  ]
})

describe('editWatchlist', () => {
  it('adds and removes in one pass', () => {
    const res = editWatchlist(collection(), { add: [item('AMD')], remove: ['NVDA'] })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.items.map((i) => i.symbol)).toEqual(['AMD'])
    expect(res.value).toMatchObject({ addedCount: 1, removedCount: 1 })
  })

  // Parity with addToWatchlist: adding a symbol that is already there is a no-op, not an error.
  it('ignores a duplicate add', () => {
    const res = editWatchlist(collection(), { add: [item('NVDA')], remove: [] })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.items.map((i) => i.symbol)).toEqual(['NVDA'])
    expect(res.value.addedCount).toBe(0)
  })

  it('ignores a remove for a symbol that is not on the list', () => {
    const res = editWatchlist(collection(), { add: [], remove: ['TSLA'] })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.removedCount).toBe(0)
  })
})

describe('createWorkspace', () => {
  it('creates an empty workspace and activates it by default', () => {
    const res = createWorkspace(collection(), { name: 'Fresh', activate: true })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces.map((w) => w.name)).toEqual(['Main', 'Other', 'Fresh'])
    expect(res.collection.active).toBe('Fresh')
    const created = res.collection.workspaces[2]
    expect(created.items).toEqual([])
    expect(created.layout.cells).toHaveLength(1)
  })

  it('can create without switching to it', () => {
    const res = createWorkspace(collection(), { name: 'Fresh', activate: false })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.active).toBe('Main')
  })

  // Ids must be collection-wide unique, so a copy re-mints every cell and indicator id.
  it('copies a workspace with fresh ids', () => {
    const res = createWorkspace(collection(), { name: 'Copy', copyFrom: 'Main', activate: false })
    if (!res.ok) throw new Error(res.message)
    const copy = res.collection.workspaces.find((w) => w.name === 'Copy')!
    expect(copy.items.map((i) => i.symbol)).toEqual(['NVDA'])
    expect(copy.layout.cells[0].id).toBe('4')
    expect(copy.layout.cells[0].indicators[0].id).toBe('5')
    expect(copy.layout.activeCellId).toBe('4')
    expect(copy.layout.cells[0].symbol).toBe('NVDA')
  })

  it('rejects a duplicate name', () => {
    expect(createWorkspace(collection(), { name: 'Other', activate: true })).toEqual({
      ok: false, message: 'A workspace named "Other" already exists.'
    })
  })

  it('rejects an unknown copyFrom', () => {
    expect(createWorkspace(collection(), { name: 'Copy', copyFrom: 'Nope', activate: true })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})

describe('renameWorkspace', () => {
  it('renames and follows the active pointer', () => {
    const res = renameWorkspace(collection(), { from: 'Main', to: 'Primary' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces.map((w) => w.name)).toEqual(['Primary', 'Other'])
    expect(res.collection.active).toBe('Primary')
  })

  it('rejects a duplicate target name', () => {
    expect(renameWorkspace(collection(), { from: 'Main', to: 'Other' })).toEqual({
      ok: false, message: 'A workspace named "Other" already exists.'
    })
  })

  it('rejects an unknown source name', () => {
    expect(renameWorkspace(collection(), { from: 'Nope', to: 'X' })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})

describe('deleteWorkspace', () => {
  it('deletes and reports what was lost', () => {
    const res = deleteWorkspace(collection(), { name: 'Main' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces.map((w) => w.name)).toEqual(['Other'])
    expect(res.value).toEqual({
      name: 'Main', cellCount: 1, symbols: ['NVDA'], watchlistCount: 1, activeNow: 'Other'
    })
  })

  it('moves active to the first survivor when the active one goes', () => {
    const res = deleteWorkspace(collection(), { name: 'Main' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.active).toBe('Other')
  })

  it('leaves active alone when another workspace goes', () => {
    const res = deleteWorkspace(collection(), { name: 'Other' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.active).toBe('Main')
  })

  it('refuses to delete the only workspace', () => {
    const c = collection()
    c.workspaces = [c.workspaces[0]]
    expect(deleteWorkspace(c, { name: 'Main' })).toEqual({
      ok: false, message: 'Cannot delete the only workspace.'
    })
  })

  it('rejects an unknown name', () => {
    expect(deleteWorkspace(collection(), { name: 'Nope' })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})

describe('activateWorkspace', () => {
  it('switches the active pointer', () => {
    const res = activateWorkspace(collection(), { name: 'Other' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.active).toBe('Other')
  })

  it('rejects an unknown name', () => {
    expect(activateWorkspace(collection(), { name: 'Nope' })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/mcp/edits.workspaces.test.ts`
Expected: FAIL — `editWatchlist is not a function`

- [ ] **Step 3: 5 関数を実装**

`src/main/mcp/edits.ts` に import と実装を足す。

```ts
import { cellCount, defaultLayout, newCellSeed } from '@shared/workspace'
import type { Layout, WatchlistItem } from '@shared/types'
```

```ts
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
  const have = new Set(kept.map((i) => i.symbol.toUpperCase()))
  const fresh = a.add.filter((i) => !have.has(i.symbol.toUpperCase())) // parity with addToWatchlist
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/mcp/edits.workspaces.test.ts`
Expected: PASS

- [ ] **Step 5: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/edits.ts tests/main/mcp/edits.workspaces.test.ts
git commit -m "feat(mcp): pure watchlist and workspace editors"
```

---

### Task 10: `core.workspaces.mutate`

同期の read-modify-write（MW-04）。書き込み・`rev` 更新・broadcast は既存の `workspaces.set` に委譲する。

**Files:**
- Modify: `src/main/core.ts:228-240`
- Test: `tests/main/core/mutate.test.ts`

**Interfaces:**
- Consumes: Task 6 の `EditResult<T>`
- Produces: `core.workspaces.mutate<T>(fn: (c: WorkspaceCollection) => EditResult<T>): MutateResult<T>` where
  `type MutateResult<T> = { ok: true; collection: WorkspaceCollection; value: T } | { ok: false; message: string }`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/main/core/mutate.test.ts`。既存の `tests/main/core/surfaces.test.ts` のフェイク注入パターンに合わせる（`createCore` に必要な dep だけ渡し、残りは未使用のスタブ）。

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import type { WorkspaceCollection } from '@shared/types'

const collection = (active = 'Main'): WorkspaceCollection => ({
  version: 3,
  active,
  workspaces: [{
    name: 'Main', items: [],
    layout: {
      schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '1',
      cells: [{ id: '1', symbol: null, timeframe: '1d', indicators: [] }]
    }
  }]
})

function build(initial = collection()) {
  let stored = initial
  const broadcast = vi.fn()
  const setWorkspaces = vi.fn((c: WorkspaceCollection) => { stored = c })
  const deps = {
    broadcast,
    barStore: {} as CoreDeps['barStore'],
    profileStore: {} as CoreDeps['profileStore'],
    companyProfileStore: {} as CoreDeps['companyProfileStore'],
    workspaceStore: { getWorkspaces: () => stored, setWorkspaces },
    capabilityCache: {} as CoreDeps['capabilityCache'],
    keystore: {} as CoreDeps['keystore'],
    makeProvider: () => ({}) as ReturnType<CoreDeps['makeProvider']>
  } as CoreDeps
  return { core: createCore(deps), broadcast, setWorkspaces, read: () => stored }
}

describe('core.workspaces.mutate', () => {
  it('writes, bumps rev by one, and broadcasts to every window', () => {
    const { core, broadcast, setWorkspaces } = build()
    const before = core.workspaces.get().rev
    const res = core.workspaces.mutate((c) => ({
      ok: true, collection: { ...c, active: 'Main' }, value: 'done'
    }))
    expect(res).toMatchObject({ ok: true, value: 'done' })
    expect(setWorkspaces).toHaveBeenCalledTimes(1)
    expect(core.workspaces.get().rev).toBe(before + 1)
    // No fromWebContentsId: MCP is not a window, so every window must re-hydrate.
    expect(broadcast).toHaveBeenCalledWith('workspaces:changed', expect.anything(), undefined)
  })

  it('passes the CURRENT persisted collection to the editor', () => {
    const { core } = build()
    core.workspaces.mutate((c) => ({ ok: true, collection: { ...c, active: 'Main' }, value: null }))
    const seen: string[] = []
    core.workspaces.mutate((c) => {
      seen.push(c.workspaces[0].name)
      return { ok: true, collection: c, value: null }
    })
    expect(seen).toEqual(['Main'])
  })

  it('writes nothing when the editor fails', () => {
    const { core, broadcast, setWorkspaces } = build()
    const before = core.workspaces.get().rev
    const res = core.workspaces.mutate(() => ({ ok: false as const, message: 'nope' }))
    expect(res).toEqual({ ok: false, message: 'nope' })
    expect(setWorkspaces).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    expect(core.workspaces.get().rev).toBe(before)
  })

  it('returns the written collection so callers can format the new state', () => {
    const { core } = build()
    const res = core.workspaces.mutate((c) => ({
      ok: true, collection: { ...c, workspaces: [{ ...c.workspaces[0], name: 'Renamed' }], active: 'Renamed' }, value: 1
    }))
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].name).toBe('Renamed')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/core/mutate.test.ts`
Expected: FAIL — `core.workspaces.mutate is not a function`

- [ ] **Step 3: `core.ts` に `mutate` を足す**

`src/main/core.ts` の import に追加:

```ts
import type { EditResult } from './mcp/edits'
```

`workspaces` ブロック（228-240 行目）を差し替える:

```ts
    workspaces: {
      get: (): { collection: WorkspaceCollection; rev: number } => ({
        collection: deps.workspaceStore.getWorkspaces(),
        rev: workspacesRev
      }),
      set(c: WorkspaceCollection, fromWebContentsId?: number): void {
        deps.workspaceStore.setWorkspaces(c)
        workspacesRev += 1
        // Every OTHER window re-hydrates; the sender skips itself (its store is already current
        // and re-applying would fight its debounce).
        broadcast(CH.workspacesChanged, { collection: c, rev: workspacesRev }, fromWebContentsId)
      },
      // MW-04: read -> edit -> write in ONE synchronous call. main is single-threaded, so nothing
      // can interleave a write between the read and the set. Async work (symbol resolution) must
      // finish before calling this. MCP is not a window, so the broadcast excludes nobody.
      mutate<T>(fn: (c: WorkspaceCollection) => EditResult<T>): MutateResult<T> {
        const result = fn(deps.workspaceStore.getWorkspaces())
        if (!result.ok) return result
        this.set(result.collection)
        return result
      }
    },
```

`OhlcvOutcome` の隣に型を公開する:

```ts
export type MutateResult<T> =
  | { ok: true; collection: WorkspaceCollection; value: T }
  | { ok: false; message: string }
```

> `mutate` が `this.set` を呼ぶので、`workspaces` オブジェクトは分割代入せずに使うこと（`const { mutate } = core.workspaces` は禁止）。ツール層は常に `core.workspaces.mutate(...)` の形で呼ぶ。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/core/mutate.test.ts`
Expected: PASS

- [ ] **Step 5: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/core.ts tests/main/core/mutate.test.ts
git commit -m "feat: synchronous workspaces.mutate for MCP writes (MW-04)"
```

---

### Task 11: レイアウト / インジケータ系ツール 5 本

`set_chart` / `set_grid_layout` / `add_indicator` / `update_indicator` / `remove_indicator` を MCP に生やす。

**Files:**
- Create: `src/main/mcp/formatEdits.ts`
- Create: `src/main/mcp/mutations.ts`
- Modify: `src/main/mcp/tools.ts:12-14`（`ToolCore`）, `:164`（`buildTools` の返り値）
- Test: `tests/main/mcp/mutations.test.ts`

**Interfaces:**
- Consumes: Task 3 の `validateParams` / `defaultParams` / `indicatorCatalog` / `INDICATOR_TYPES`、Task 8/9 の editors、Task 10 の `core.workspaces.mutate`、既存の `ToolDef` / `ToolResult`
- Produces:
  - `formatCellLine(cell: Cell): string` — `[3] NVDA 1d — [7] volume`
  - `buildMutationTools(core: ToolCore): ToolDef[]`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/main/mcp/mutations.test.ts`。`tests/main/mcp/tools.test.ts` の `fakeCore` を拡張した形にする。

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildTools, type ToolCore } from '../../../src/main/mcp/tools'
import type { WorkspaceCollection } from '@shared/types'

const NOW = Date.parse('2026-07-26T00:00:00Z')

const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [{
    name: 'Main',
    items: [],
    layout: {
      schemaVersion: 1,
      shape: { rows: 1, cols: 1 },
      activeCellId: '1',
      cells: [
        { id: '1', symbol: 'NVDA', timeframe: '1d', indicators: [{ id: '2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }] },
        { id: '3', symbol: null, timeframe: '1d', indicators: [] }
      ]
    }
  }]
})

// A core whose mutate really runs the editor against an in-memory collection, so the tests cover
// the tool + editor pair end to end (only the store and the network are faked).
function fakeCore(over: Partial<ToolCore> = {}): ToolCore & { current: () => WorkspaceCollection } {
  let stored = collection()
  const core = {
    ohlcv: { get: vi.fn(), refresh: vi.fn() },
    symbols: {
      search: vi.fn(async () => []),
      profile: vi.fn(async (symbol: string) =>
        symbol.toUpperCase() === 'XYZ'
          ? { symbol, name: symbol, exchange: '' }
          : { symbol: symbol.toUpperCase(), name: `${symbol} Inc.`, exchange: 'NASDAQ' })
    },
    quote: { get: vi.fn() },
    company: { info: vi.fn() },
    workspaces: {
      get: vi.fn(() => ({ collection: stored, rev: 1 })),
      set: vi.fn(),
      mutate: vi.fn((fn) => {
        const res = fn(stored)
        if (res.ok) stored = res.collection
        return res
      })
    },
    capabilities: { get: vi.fn() },
    cacheStatus: { summarize: vi.fn(() => []) },
    ...over
  } as unknown as ToolCore
  return Object.assign(core, { current: () => stored })
}

const tool = (core: ToolCore, name: string) => {
  const def = buildTools(core, () => NOW).find((t) => t.name === name)
  if (!def) throw new Error(`no tool named ${name}`)
  return def
}

describe('set_chart', () => {
  it('resolves the symbol and writes it into the cell', async () => {
    const core = fakeCore()
    const res = await tool(core, 'set_chart').handler({ cell: '1', symbol: 'amd' })
    expect(res.isError).toBeUndefined()
    expect(core.symbols.profile).toHaveBeenCalledTimes(1)
    expect(core.current().workspaces[0].layout.cells[0].symbol).toBe('AMD')
    expect(res.content[0].text).toContain('[1] AMD 1d')
  })

  it('rejects a symbol the profile lookup could not resolve', async () => {
    const core = fakeCore()
    const res = await tool(core, 'set_chart').handler({ cell: '1', symbol: 'XYZ' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe(
      'Could not resolve "XYZ" — check the ticker with search_symbols, or confirm the FMP API key is set.'
    )
    expect(core.workspaces.mutate).not.toHaveBeenCalled()
  })

  it('clears a cell without any profile lookup', async () => {
    const core = fakeCore()
    await tool(core, 'set_chart').handler({ cell: '1', symbol: null })
    expect(core.symbols.profile).not.toHaveBeenCalled()
    expect(core.current().workspaces[0].layout.cells[0].symbol).toBeNull()
  })

  it('needs at least one of symbol / timeframe', async () => {
    const res = await tool(fakeCore(), 'set_chart').handler({ cell: '1' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Pass symbol, timeframe, or both.')
  })

  // MW-08/MW-09
  it('refuses a non-null symbol for cell "all"', async () => {
    const res = await tool(fakeCore(), 'set_chart').handler({ cell: 'all', symbol: 'AMD' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe(
      'cell: "all" cannot set a symbol — pass a cell id, or symbol: null to clear every chart.'
    )
  })

  it('warns when the target cell is off the visible grid', async () => {
    const core = fakeCore()
    const res = await tool(core, 'set_chart').handler({ cell: '3', symbol: 'AMD' })
    expect(res.content[0].text).toContain('call set_grid_layout to show it')
  })
})

describe('set_grid_layout', () => {
  it('resizes and lists the visible cells', async () => {
    const core = fakeCore()
    const res = await tool(core, 'set_grid_layout').handler({ rows: 1, cols: 2 })
    expect(core.current().workspaces[0].layout.shape).toEqual({ rows: 1, cols: 2 })
    expect(res.content[0].text).toContain('1 rows x 2 cols')
    expect(res.content[0].text).toContain('[1] NVDA 1d')
  })

  it('rejects an out-of-range grid', async () => {
    const res = await tool(fakeCore(), 'set_grid_layout').handler({ rows: 4, cols: 1 })
    expect(res.isError).toBe(true)
  })
})

describe('add_indicator', () => {
  it('fills the registry defaults when params are omitted', async () => {
    const core = fakeCore()
    const res = await tool(core, 'add_indicator').handler({ cell: '1', type: 'ma' })
    const added = core.current().workspaces[0].layout.cells[0].indicators[1]
    expect(added.params).toEqual({ kind: 'SMA', period: 20, source: 'close' })
    expect(res.content[0].text).toContain(`[${added.id}]`)
  })

  it('merges partial params over the defaults', async () => {
    const core = fakeCore()
    await tool(core, 'add_indicator').handler({ cell: '1', type: 'ma', params: { period: 50 } })
    const added = core.current().workspaces[0].layout.cells[0].indicators[1]
    expect(added.params).toEqual({ kind: 'SMA', period: 50, source: 'close' })
  })

  it('rejects an unknown type with the available list', async () => {
    const res = await tool(fakeCore(), 'add_indicator').handler({ cell: '1', type: 'sma' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Unknown indicator "sma". Available:')
  })

  it('rejects a param value the FieldDesc forbids', async () => {
    const res = await tool(fakeCore(), 'add_indicator').handler({ cell: '1', type: 'ma', params: { kind: 'WMA' } })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('kind must be one of SMA, EMA.')
  })

  // MW-15
  it('rejects color inside params', async () => {
    const res = await tool(fakeCore(), 'add_indicator').handler({ cell: '1', type: 'ma', params: { color: '#fff' } })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('color is not a parameter — use the color argument of update_indicator.')
  })
})

describe('update_indicator', () => {
  it('writes the color to every output of the instance', async () => {
    const core = fakeCore()
    await tool(core, 'add_indicator').handler({ cell: '1', type: 'macd' })
    const id = core.current().workspaces[0].layout.cells[0].indicators[1].id
    await tool(core, 'update_indicator').handler({ indicator: id, color: '#123456' })
    const inst = core.current().workspaces[0].layout.cells[0].indicators[1]
    expect(inst.colors).toEqual({ macd: '#123456', signal: '#123456', histogram: '#123456' })
  })

  it('rejects a malformed color', async () => {
    const res = await tool(fakeCore(), 'update_indicator').handler({ indicator: '2', color: 'red' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('color must be a hex value like #1e90ff.')
  })

  it('needs at least one field to change', async () => {
    const res = await tool(fakeCore(), 'update_indicator').handler({ indicator: '2' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Pass params, visible, or color.')
  })

  it('reports an unknown indicator id', async () => {
    const res = await tool(fakeCore(), 'update_indicator').handler({ indicator: '99', visible: false })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('No indicator "99". Use get_workspace to list indicator ids.')
  })
})

describe('remove_indicator', () => {
  it('says so when the only match was a fixed indicator', async () => {
    const core = fakeCore()
    const res = await tool(core, 'remove_indicator').handler({ indicator: '2' })
    expect(res.content[0].text).toContain('kept 1 fixed')
    expect(core.current().workspaces[0].layout.cells[0].indicators).toHaveLength(1)
  })

  it('requires exactly one of indicator / cell', async () => {
    const both = await tool(fakeCore(), 'remove_indicator').handler({ indicator: '2', cell: '1' })
    expect(both.isError).toBe(true)
    expect(both.content[0].text).toBe('Pass either indicator or cell, not both.')
    const neither = await tool(fakeCore(), 'remove_indicator').handler({})
    expect(neither.isError).toBe(true)
    expect(neither.content[0].text).toBe('Pass either indicator or cell.')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/mcp/mutations.test.ts`
Expected: FAIL — `no tool named set_chart`

- [ ] **Step 3: `src/main/mcp/formatEdits.ts` を作る**

```ts
import type { Cell, GridShape, IndicatorInstance, WatchlistItem } from '@shared/types'

// Same shape as formatWorkspaceDetail's cell line so a mutation response reads like the slice of
// get_workspace it just changed.
export function formatIndicatorInline(i: IndicatorInstance): string {
  const parts = Object.entries(i.params).map(([k, v]) => `${k}=${v}`)
  if (!i.visible) parts.push('hidden')
  return parts.length > 0 ? `[${i.id}] ${i.type}(${parts.join(', ')})` : `[${i.id}] ${i.type}`
}

export function formatCellLine(cell: Cell): string {
  const indicators = cell.indicators.length === 0
    ? 'no indicators'
    : cell.indicators.map(formatIndicatorInline).join(', ')
  return `[${cell.id}] ${cell.symbol ?? '(empty)'} ${cell.timeframe} — ${indicators}`
}

export function formatCells(workspaceName: string, cells: Cell[]): string {
  return [`Workspace "${workspaceName}":`, ...cells.map((c) => `- ${formatCellLine(c)}`)].join('\n')
}

export function formatGrid(workspaceName: string, shape: GridShape, visible: Cell[]): string {
  return [
    `Workspace "${workspaceName}" grid is now ${shape.rows} rows x ${shape.cols} cols.`,
    ...visible.map((c) => `- ${formatCellLine(c)}`)
  ].join('\n')
}

export function formatInstanceDetail(cellId: string, i: IndicatorInstance): string {
  const colors = Object.entries(i.colors).map(([k, v]) => `${k}=${v}`).join(', ')
  return [
    `[${i.id}] ${i.type} on cell [${cellId}]`,
    `params: ${Object.entries(i.params).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`,
    `visible: ${i.visible}`,
    `colors: ${colors || '(none)'}`
  ].join('\n')
}

export function formatWatchlist(workspaceName: string, items: WatchlistItem[]): string {
  if (items.length === 0) return `Workspace "${workspaceName}" watchlist is empty.`
  return [
    `Workspace "${workspaceName}" watchlist (${items.length}):`,
    ...items.map((i) => `- ${i.symbol} — ${i.name} (${i.exchange})`)
  ].join('\n')
}
```

- [ ] **Step 4: `src/main/mcp/mutations.ts` を作る**

```ts
import { z } from 'zod'
import { TIMEFRAMES, type Timeframe, type Params } from '@shared/types'
import { defaultParams, indicatorCatalog, validateParams } from '@shared/indicators/validate'
import type { ToolCore, ToolDef, ToolHandler, ToolResult } from './tools'
import {
  addIndicator, removeIndicator, setChart, setGridLayout, updateIndicator, visibleCells, pickWorkspace
} from './edits'
import { formatCells, formatGrid, formatInstanceDetail } from './formatEdits'

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

const workspaceArg = z.string().min(1).optional()
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

const UNRESOLVED = (symbol: string): string =>
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
```

- [ ] **Step 5: `tools.ts` を合流させる**

`src/main/mcp/tools.ts`:

1. `ToolCore` に `workspaces.mutate` が含まれるようになるので変更不要（`Pick<Core, 'workspaces'>` が丸ごと拾う）。念のため型が通ることを Step 7 で確認する。
2. import を追加:

```ts
import { buildMutationTools } from './mutations'
```

3. `buildTools` の `return [` で始まる配列の**末尾**（`get_cache_status` の後、閉じ括弧の前）に展開を足す:

```ts
    },
    ...buildMutationTools(core)
  ]
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run tests/main/mcp/mutations.test.ts`
Expected: PASS

- [ ] **Step 7: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/mcp/mutations.ts src/main/mcp/formatEdits.ts src/main/mcp/tools.ts tests/main/mcp/mutations.test.ts
git commit -m "feat(mcp): set_chart, set_grid_layout and indicator tools"
```

---

### Task 12: ウォッチリスト / ワークスペース系ツール 5 本

**Files:**
- Create: `src/main/mcp/workspaceTools.ts`
- Modify: `src/main/mcp/tools.ts`（`buildWorkspaceTools` を合流）
- Test: `tests/main/mcp/workspaceTools.test.ts`

**Interfaces:**
- Consumes: Task 9 の editors、Task 11 の `formatWatchlist` / `resolveSymbol` 相当
- Produces: `buildWorkspaceTools(core: ToolCore): ToolDef[]`（`edit_watchlist` / `create_workspace` / `rename_workspace` / `delete_workspace` / `activate_workspace`）

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/main/mcp/workspaceTools.test.ts`。`tests/main/mcp/mutations.test.ts` の `fakeCore` / `tool` ヘルパをそのままコピーして使う（テスト間で共有ヘルパを作らない — 各ファイルが単独で読めるほうが後の変更に強い）。

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildTools, type ToolCore } from '../../../src/main/mcp/tools'
import type { WorkspaceCollection } from '@shared/types'

const NOW = Date.parse('2026-07-26T00:00:00Z')

const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [
    {
      name: 'Main',
      items: [{ symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' }],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '1',
        cells: [{ id: '1', symbol: 'NVDA', timeframe: '1d', indicators: [] }]
      }
    },
    {
      name: 'Other',
      items: [],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '2',
        cells: [{ id: '2', symbol: null, timeframe: '1d', indicators: [] }]
      }
    }
  ]
})

function fakeCore(): ToolCore & { current: () => WorkspaceCollection } {
  let stored = collection()
  const core = {
    ohlcv: { get: vi.fn(), refresh: vi.fn() },
    symbols: {
      search: vi.fn(async () => []),
      profile: vi.fn(async (symbol: string) =>
        symbol.toUpperCase() === 'XYZ'
          ? { symbol, name: symbol, exchange: '' }
          : { symbol: symbol.toUpperCase(), name: `${symbol} Inc.`, exchange: 'NASDAQ' })
    },
    quote: { get: vi.fn() },
    company: { info: vi.fn() },
    workspaces: {
      get: vi.fn(() => ({ collection: stored, rev: 1 })),
      set: vi.fn(),
      mutate: vi.fn((fn) => {
        const res = fn(stored)
        if (res.ok) stored = res.collection
        return res
      })
    },
    capabilities: { get: vi.fn() },
    cacheStatus: { summarize: vi.fn(() => []) }
  } as unknown as ToolCore
  return Object.assign(core, { current: () => stored })
}

const tool = (core: ToolCore, name: string) => {
  const def = buildTools(core, () => NOW).find((t) => t.name === name)
  if (!def) throw new Error(`no tool named ${name}`)
  return def
}

describe('edit_watchlist', () => {
  it('resolves and adds, then prints the new list', async () => {
    const core = fakeCore()
    const res = await tool(core, 'edit_watchlist').handler({ add: ['amd'] })
    expect(core.current().workspaces[0].items.map((i) => i.symbol)).toEqual(['NVDA', 'AMD'])
    expect(res.content[0].text).toContain('- AMD —')
  })

  it('removes by symbol, case-insensitively', async () => {
    const core = fakeCore()
    await tool(core, 'edit_watchlist').handler({ remove: ['nvda'] })
    expect(core.current().workspaces[0].items).toEqual([])
  })

  // MW-13: all-or-nothing, so a typo never half-applies.
  it('changes nothing when one added symbol cannot be resolved', async () => {
    const core = fakeCore()
    const res = await tool(core, 'edit_watchlist').handler({ add: ['AMD', 'XYZ'] })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Could not resolve "XYZ"')
    expect(core.workspaces.mutate).not.toHaveBeenCalled()
    expect(core.current().workspaces[0].items.map((i) => i.symbol)).toEqual(['NVDA'])
  })

  it('needs at least one of add / remove', async () => {
    const res = await tool(fakeCore(), 'edit_watchlist').handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Pass add, remove, or both.')
  })
})

describe('create_workspace', () => {
  it('creates and activates by default', async () => {
    const core = fakeCore()
    await tool(core, 'create_workspace').handler({ name: 'Fresh' })
    expect(core.current().active).toBe('Fresh')
  })

  it('copies an existing workspace', async () => {
    const core = fakeCore()
    await tool(core, 'create_workspace').handler({ name: 'Copy', copyFrom: 'Main', activate: false })
    const copy = core.current().workspaces.find((w) => w.name === 'Copy')!
    expect(copy.layout.cells[0].symbol).toBe('NVDA')
    expect(copy.layout.cells[0].id).not.toBe('1')
  })

  it('rejects a duplicate name', async () => {
    const res = await tool(fakeCore(), 'create_workspace').handler({ name: 'Other' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('A workspace named "Other" already exists.')
  })
})

describe('rename_workspace', () => {
  it('renames', async () => {
    const core = fakeCore()
    await tool(core, 'rename_workspace').handler({ from: 'Other', to: 'Scratch' })
    expect(core.current().workspaces.map((w) => w.name)).toEqual(['Main', 'Scratch'])
  })
})

describe('delete_workspace', () => {
  it('reports what was deleted', async () => {
    const core = fakeCore()
    const res = await tool(core, 'delete_workspace').handler({ name: 'Main' })
    const text = res.content[0].text
    expect(text).toContain('Deleted workspace "Main"')
    expect(text).toContain('1 cell')
    expect(text).toContain('NVDA')
    expect(text).toContain('1 watchlist symbol')
    expect(text).toContain('cannot be undone')
    expect(core.current().active).toBe('Other')
  })

  it('refuses to delete the last one', async () => {
    const core = fakeCore()
    await tool(core, 'delete_workspace').handler({ name: 'Other' })
    const res = await tool(core, 'delete_workspace').handler({ name: 'Main' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Cannot delete the only workspace.')
  })
})

describe('activate_workspace', () => {
  it('switches the active workspace', async () => {
    const core = fakeCore()
    await tool(core, 'activate_workspace').handler({ name: 'Other' })
    expect(core.current().active).toBe('Other')
  })

  it('reports an unknown name with the available ones', async () => {
    const res = await tool(fakeCore(), 'activate_workspace').handler({ name: 'Nope' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('No workspace named "Nope". Available: Main, Other')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/mcp/workspaceTools.test.ts`
Expected: FAIL — `no tool named edit_watchlist`

- [ ] **Step 3: `src/main/mcp/workspaceTools.ts` を作る**

```ts
import { z } from 'zod'
import type { WatchlistItem } from '@shared/types'
import type { ToolCore, ToolDef, ToolHandler, ToolResult } from './tools'
import {
  activateWorkspace, createWorkspace, deleteWorkspace, editWatchlist, renameWorkspace
} from './edits'
import { formatWatchlist } from './formatEdits'

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

const workspaceArg = z.string().min(1).optional()
  .describe('Exact workspace name, as listed by get_workspaces. Omit for the one the user has open.')

const watchlistArgs = z.object({
  workspace: workspaceArg,
  add: z.array(z.string().min(1)).optional().describe('Tickers to add. Unknown tickers reject the whole call.'),
  remove: z.array(z.string().min(1)).optional().describe('Tickers to remove. Unknown tickers are ignored.')
})

const createArgs = z.object({
  name: z.string().min(1).describe('Name for the new workspace. Must not already exist.'),
  copyFrom: z.string().min(1).optional().describe('Copy this workspace instead of starting empty.'),
  activate: z.boolean().optional().describe('Switch to it after creating. Defaults to true.')
})

const renameArgs = z.object({
  from: z.string().min(1).describe('Current workspace name.'),
  to: z.string().min(1).describe('New name. Must not already exist.')
})

const nameArgs = z.object({ name: z.string().min(1).describe('Exact workspace name.') })

const UNRESOLVED = (symbol: string): string =>
  `Could not resolve "${symbol}" — check the ticker with search_symbols, or confirm the FMP API key is set.`

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function buildWorkspaceTools(core: ToolCore): ToolDef[] {
  const watchlistHandler: ToolHandler = async (raw) => {
    const parsed = watchlistArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { workspace } = parsed.data
    const addSymbols = parsed.data.add ?? []
    const remove = parsed.data.remove ?? []
    if (addSymbols.length === 0 && remove.length === 0) return fail('Pass add, remove, or both.')

    // Resolve everything BEFORE mutating: one unresolved ticker rejects the whole call (MW-13),
    // and mutate is synchronous so no await may happen inside it (MW-04).
    const add: WatchlistItem[] = []
    for (const symbol of addSymbols) {
      const profile = await core.symbols.profile(symbol)
      if (profile.exchange === '') return fail(UNRESOLVED(symbol))
      add.push({ ...profile, symbol: profile.symbol.toUpperCase() })
    }

    const result = core.workspaces.mutate((c) => editWatchlist(c, { workspace, add, remove }))
    if (!result.ok) return fail(result.message)
    const { workspaceName, items, addedCount, removedCount } = result.value
    return ok([
      `Added ${addedCount}, removed ${removedCount}.`,
      formatWatchlist(workspaceName, items)
    ].join('\n'))
  }

  const createHandler: ToolHandler = async (raw) => {
    const parsed = createArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { name, copyFrom } = parsed.data
    const activate = parsed.data.activate ?? true
    const result = core.workspaces.mutate((c) => createWorkspace(c, { name, copyFrom, activate }))
    if (!result.ok) return fail(result.message)
    const source = copyFrom ? ` (copied from "${copyFrom}")` : ''
    const active = activate ? ' It is now the active workspace.' : ''
    return ok(`Created workspace "${name}"${source}.${active}`)
  }

  const renameHandler: ToolHandler = async (raw) => {
    const parsed = renameArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const result = core.workspaces.mutate((c) => renameWorkspace(c, parsed.data))
    if (!result.ok) return fail(result.message)
    return ok(`Renamed workspace "${parsed.data.from}" to "${parsed.data.to}".`)
  }

  const deleteHandler: ToolHandler = async (raw) => {
    const parsed = nameArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const result = core.workspaces.mutate((c) => deleteWorkspace(c, parsed.data))
    if (!result.ok) return fail(result.message)
    const { name, cellCount, symbols, watchlistCount, activeNow } = result.value
    const charts = symbols.length > 0 ? ` holding ${symbols.join(', ')}` : ''
    return ok([
      `Deleted workspace "${name}": ${plural(cellCount, 'cell')}${charts}, ${plural(watchlistCount, 'watchlist symbol')}.`,
      `Active workspace is now "${activeNow}". This cannot be undone.`
    ].join('\n'))
  }

  const activateHandler: ToolHandler = async (raw) => {
    const parsed = nameArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const result = core.workspaces.mutate((c) => activateWorkspace(c, parsed.data))
    if (!result.ok) return fail(result.message)
    return ok(`Active workspace is now "${parsed.data.name}".`)
  }

  return [
    {
      name: 'edit_watchlist',
      description: "Add or remove symbols on a workspace's watchlist. Adding costs one API request per ticker that has never been resolved before; if any ticker cannot be resolved, nothing changes.",
      schema: watchlistArgs,
      handler: watchlistHandler
    },
    {
      name: 'create_workspace',
      description: 'Create a workspace, optionally copying an existing one (charts, indicators and watchlist come along with fresh ids). Activates it unless activate:false. No API request.',
      schema: createArgs,
      handler: createHandler
    },
    {
      name: 'rename_workspace',
      description: 'Rename a workspace. No API request.',
      schema: renameArgs,
      handler: renameHandler
    },
    {
      name: 'delete_workspace',
      description: 'Delete a workspace and everything in it. The app has no undo — the response lists what was removed so you can tell the user. The last remaining workspace cannot be deleted. No API request.',
      schema: nameArgs,
      handler: deleteHandler
    },
    {
      name: 'activate_workspace',
      description: 'Switch the app to a different workspace. No API request.',
      schema: nameArgs,
      handler: activateHandler
    }
  ]
}
```

- [ ] **Step 4: `tools.ts` に合流させる**

```ts
import { buildWorkspaceTools } from './workspaceTools'
```

`buildTools` の返り値末尾を次にする:

```ts
    },
    ...buildMutationTools(core),
    ...buildWorkspaceTools(core)
  ]
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run tests/main/mcp/workspaceTools.test.ts`
Expected: PASS

- [ ] **Step 6: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/mcp/workspaceTools.ts src/main/mcp/tools.ts tests/main/mcp/workspaceTools.test.ts
git commit -m "feat(mcp): watchlist and workspace management tools"
```

---

### Task 13: `reload` に戻り値と `busy` を足す（renderer）

MCP から完了と件数を受け取れるようにする。フェッチ処理そのものは変えない（MW-14）。

**Files:**
- Modify: `src/renderer/App.tsx:78-157`
- Create: `src/renderer/lib/reloadResult.ts`
- Test: `tests/renderer/reloadResult.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `src/renderer/lib/reloadResult.ts` の `type ReloadResult = { refreshed: number; failed: number; busy: boolean }` と `countOhlcv(results: PromiseSettledResult<unknown>[]): { refreshed: number; failed: number }`
  - `App.tsx` の `reload(opts): Promise<ReloadResult>`

- [ ] **Step 1: 失敗するテストを書く**

`App.tsx` は Electron の `window.api` と lightweight-charts を引き込むのでユニットテストに載せない。数え方だけを純粋関数に切り出してテストする。

Create `tests/renderer/reloadResult.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BUSY_RESULT, countOhlcv } from '../../src/renderer/lib/reloadResult'

describe('countOhlcv', () => {
  it('counts fulfilled and rejected separately', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: new Error('x') },
      { status: 'fulfilled', value: 2 }
    ]
    expect(countOhlcv(results)).toEqual({ refreshed: 2, failed: 1 })
  })

  it('is all zeroes for an empty run', () => {
    expect(countOhlcv([])).toEqual({ refreshed: 0, failed: 0 })
  })
})

describe('BUSY_RESULT', () => {
  // MW-14: a request that arrives mid-refresh must still answer, or the MCP caller waits for the
  // 60s timeout instead of being told to retry.
  it('reports busy with no work done', () => {
    expect(BUSY_RESULT).toEqual({ refreshed: 0, failed: 0, busy: true })
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/renderer/reloadResult.test.ts`
Expected: FAIL — モジュールが解決できない

- [ ] **Step 3: `src/renderer/lib/reloadResult.ts` を作る**

```ts
// Result of one App.reload() run. `busy` means the call was refused because another refresh was
// already running — the caller should retry, not treat zero counts as "nothing to do" (MW-14).
export type ReloadResult = { refreshed: number; failed: number; busy: boolean }

export const BUSY_RESULT: ReloadResult = { refreshed: 0, failed: 0, busy: true }

export function countOhlcv(
  results: PromiseSettledResult<unknown>[]
): { refreshed: number; failed: number } {
  let refreshed = 0
  let failed = 0
  for (const r of results) {
    if (r.status === 'fulfilled') refreshed += 1
    else failed += 1
  }
  return { refreshed, failed }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/renderer/reloadResult.test.ts`
Expected: PASS

- [ ] **Step 5: `App.tsx` の `reload` を書き換える**

import を追加:

```ts
import { BUSY_RESULT, countOhlcv, type ReloadResult } from './lib/reloadResult'
```

`reload` のシグネチャと早期 return（78-79 行目）:

```ts
  const reload = async (opts: { source: ReloadSource }): Promise<ReloadResult> => {
    // 同期ガード: 手動と auto tick の二重実行を防ぐ（state のラグに依存しない）。
    // MW-14: 黙って捨てず busy を返す — MCP の force_reload はこの戻り値で「今は無理」を知る。
    if (inFlight.current) return BUSY_RESULT
```

閉場スキップの `return`（`setRefreshState(...)` の直後、114 行目付近）を次にする:

```ts
        return { refreshed: 0, failed: 0, busy: false }
```

`const failed = ohlcvResults.some((r) => r.status === 'rejected')` の行を次に置き換える:

```ts
      const counts = countOhlcv(ohlcvResults)
      const failed = counts.failed > 0
```

`setRefreshState` の呼び出し（149-153 行目）の直後、`} finally {` の前に返却を足す:

```ts
      return { ...counts, busy: false }
```

TypeScript が「すべての経路が値を返さない」と言う場合は、`try` の最後（`finally` の直前）に到達しない経路が無いか確認する。`try` 内は上の 3 つの return で尽きているはず。

- [ ] **Step 6: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: PASS（`void reload(...)` の呼び出し 3 箇所は戻り値を無視するので変更不要）

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx src/renderer/lib/reloadResult.ts tests/renderer/reloadResult.test.ts
git commit -m "feat: reload reports refreshed/failed counts and busy (MW-14)"
```

---

### Task 14: `force_reload` の配線

main → メインウィンドウへ委譲し、完了を待って件数を返す。

**Files:**
- Modify: `src/shared/ipc.ts:33`（CH）, `:55`（型）, `:117`（Api）
- Modify: `src/preload/index.ts:61-68`
- Modify: `src/main/core.ts`（`uiRefresh` 名前空間と `CoreDeps.requestRefresh`）
- Modify: `src/main/ipc.ts`（`refresh:done` ハンドラ）
- Modify: `src/main/index.ts:131-148`（`requestRefresh` 注入）
- Modify: `src/renderer/App.tsx`（`refresh:request` 購読）
- Modify: `src/main/mcp/workspaceTools.ts`（`force_reload` を追加）
- Modify: `src/main/mcp/tools.ts`（`ToolCore` に `uiRefresh` を追加）
- Test: `tests/main/core/uiRefresh.test.ts`, `tests/main/mcp/forceReload.test.ts`

**Interfaces:**
- Consumes: Task 13 の `ReloadResult`、Task 10 の core 構造
- Produces:
  - `CH.refreshRequest = 'refresh:request'` / `CH.refreshDone = 'refresh:done'`
  - `type RefreshDonePayload = { requestId: number; refreshed: number; failed: number; busy: boolean }`
  - `Api.refresh.onRequest(cb: (requestId: number) => void): () => void` / `Api.refresh.done(p: RefreshDonePayload): Promise<void>`
  - `CoreDeps.requestRefresh(requestId: number): boolean` — 送信できたら true、メインウィンドウが無ければ false
  - `core.uiRefresh.run(): Promise<{ ok: true; refreshed: number; failed: number; busy: boolean } | { ok: false; reason: 'no-window' | 'timeout' }>`
  - `core.uiRefresh.settle(p: RefreshDonePayload): void`

- [ ] **Step 1: 失敗するテストを書く（core 側）**

Create `tests/main/core/uiRefresh.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'

afterEach(() => { vi.useRealTimers() })

function build(requestRefresh: CoreDeps['requestRefresh']) {
  const deps = {
    broadcast: vi.fn(),
    barStore: {} as CoreDeps['barStore'],
    profileStore: {} as CoreDeps['profileStore'],
    companyProfileStore: {} as CoreDeps['companyProfileStore'],
    workspaceStore: {} as CoreDeps['workspaceStore'],
    capabilityCache: {} as CoreDeps['capabilityCache'],
    keystore: {} as CoreDeps['keystore'],
    makeProvider: () => ({}) as ReturnType<CoreDeps['makeProvider']>,
    requestRefresh
  } as CoreDeps
  return createCore(deps)
}

describe('core.uiRefresh', () => {
  it('resolves with the counts the window reported', async () => {
    let sentId = -1
    const core = build((id) => { sentId = id; return true })
    const pending = core.uiRefresh.run()
    core.uiRefresh.settle({ requestId: sentId, refreshed: 4, failed: 1, busy: false })
    await expect(pending).resolves.toEqual({ ok: true, refreshed: 4, failed: 1, busy: false })
  })

  it('reports no-window when the request could not be sent', async () => {
    const core = build(() => false)
    await expect(core.uiRefresh.run()).resolves.toEqual({ ok: false, reason: 'no-window' })
  })

  it('times out after 60 seconds', async () => {
    vi.useFakeTimers()
    const core = build(() => true)
    const pending = core.uiRefresh.run()
    vi.advanceTimersByTime(60_000)
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' })
  })

  // A late reply for a discarded request must not resolve or crash anything.
  it('ignores a settle for an unknown request id', async () => {
    const core = build(() => true)
    expect(() => core.uiRefresh.settle({ requestId: 999, refreshed: 1, failed: 0, busy: false })).not.toThrow()
  })

  it('gives each run a distinct request id', async () => {
    const ids: number[] = []
    const core = build((id) => { ids.push(id); return true })
    void core.uiRefresh.run()
    void core.uiRefresh.run()
    expect(new Set(ids).size).toBe(2)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/main/core/uiRefresh.test.ts`
Expected: FAIL — `core.uiRefresh` が無い

- [ ] **Step 3: `shared/ipc.ts` にチャネルと型を足す**

`CH` に追加（`refreshApplied` の下）:

```ts
  refreshRequest: 'refresh:request',
  refreshDone: 'refresh:done',
```

型を追加（`RefreshAppliedPayload` の下）:

```ts
// force_reload の委譲（MW-14）。main → メインウィンドウが requestId を送り、window が終わったら
// 同じ id で件数を返す。busy は「別のリフレッシュが走っていたので何もしなかった」。
export type RefreshDonePayload = {
  requestId: number
  refreshed: number
  failed: number
  busy: boolean
}
```

`Api.refresh` に追加:

```ts
  refresh: {
    broadcast(p: RefreshAppliedPayload): Promise<void>
    onApplied(cb: (p: RefreshAppliedPayload) => void): () => void
    // main（MCP の force_reload）からの実行依頼。メインウィンドウだけが購読する。
    onRequest(cb: (requestId: number) => void): () => void
    done(p: RefreshDonePayload): Promise<void>
  }
```

- [ ] **Step 4: `preload/index.ts` を更新**

import に `RefreshDonePayload` を足し、`refresh` を次にする:

```ts
  refresh: {
    broadcast: (p: RefreshAppliedPayload) => ipcRenderer.invoke(CH.refreshBroadcast, p),
    onApplied: (cb) => {
      const listener = (_e: unknown, p: RefreshAppliedPayload): void => cb(p)
      ipcRenderer.on(CH.refreshApplied, listener)
      return () => ipcRenderer.removeListener(CH.refreshApplied, listener)
    },
    onRequest: (cb) => {
      const listener = (_e: unknown, requestId: number): void => cb(requestId)
      ipcRenderer.on(CH.refreshRequest, listener)
      return () => ipcRenderer.removeListener(CH.refreshRequest, listener)
    },
    done: (p: RefreshDonePayload) => ipcRenderer.invoke(CH.refreshDone, p)
  },
```

- [ ] **Step 5: `core.ts` に `uiRefresh` を実装**

`CoreDeps` に追加:

```ts
  // main → メインウィンドウへ refresh:request を送る。送れたら true、窓が無ければ false。
  // core は electron を import しないので index.ts から注入する（broadcast と同じ）。
  requestRefresh?: (requestId: number) => boolean
```

import に型を足す:

```ts
import type { RefreshDonePayload } from '@shared/ipc'
```

`createCore` の状態にカウンタとマップを足す（`inFlight` の近く）:

```ts
  // force_reload の往復（MW-14）。renderer 側の inFlight が唯一の同時実行ガードなので、ここでは
  // 二重実行を弾かない — 走っていれば window が busy を返してくる。
  let refreshSeq = 0
  const pendingRefresh = new Map<number, (p: RefreshDonePayload) => void>()
  const REFRESH_TIMEOUT_MS = 60_000
```

返却オブジェクトに追加（`capabilities` の隣）:

```ts
    uiRefresh: {
      run(): Promise<
        | { ok: true; refreshed: number; failed: number; busy: boolean }
        | { ok: false; reason: 'no-window' | 'timeout' }
      > {
        const requestId = ++refreshSeq
        const sent = deps.requestRefresh?.(requestId) ?? false
        if (!sent) return Promise.resolve({ ok: false as const, reason: 'no-window' as const })
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            pendingRefresh.delete(requestId)
            resolve({ ok: false, reason: 'timeout' })
          }, REFRESH_TIMEOUT_MS)
          pendingRefresh.set(requestId, (p) => {
            clearTimeout(timer)
            resolve({ ok: true, refreshed: p.refreshed, failed: p.failed, busy: p.busy })
          })
        })
      },
      settle(p: RefreshDonePayload): void {
        const resolve = pendingRefresh.get(p.requestId)
        if (!resolve) return // a reply for a timed-out or unknown request
        pendingRefresh.delete(p.requestId)
        resolve(p)
      }
    },
```

- [ ] **Step 6: core テストが通ることを確認**

Run: `npx vitest run tests/main/core/uiRefresh.test.ts`
Expected: PASS

- [ ] **Step 7: main 側を配線する**

`src/main/ipc.ts` の import に `RefreshDonePayload` を足し、`refreshBroadcast` ハンドラの下に追加:

```ts
  // メインウィンドウからの完了通知を core の待ち receiver へ渡す（force_reload、MW-14）。
  ipcMain.handle(CH.refreshDone, (_e, p: RefreshDonePayload) => core.uiRefresh.settle(p))
```

`src/main/index.ts`: `createWindow` が作る窓を保持して `requestRefresh` を注入する。

```ts
// The refresh scheduler lives in the main window's renderer (App.reload), so force_reload has to
// be delegated to exactly that window — not broadcast to all of them.
let mainWindow: BrowserWindow | null = null

function requestRefresh(requestId: number): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  mainWindow.webContents.send(CH.refreshRequest, requestId)
  return true
}
```

`createWindow` 内で `hardenWindow(win)` の直後に `mainWindow = win`、`win.on('closed', ...)` の中で `mainWindow = null` を足す。

`buildCore()` の `createCore({...})` に `requestRefresh` を足す。

- [ ] **Step 8: renderer 側で購読する**

`src/renderer/App.tsx` に effect を足す（`useGridShortcuts(...)` の近く）。`reload` は毎レンダー新しい関数なので ref 経由で最新を読む。

```ts
  // MCP の force_reload はこの購読で UI のリロードボタンと同じ経路を通る（MW-14）。
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    return api.refresh.onRequest((requestId) => {
      void reloadRef.current({ source: 'manual' }).then((r) =>
        api.refresh.done({ requestId, refreshed: r.refreshed, failed: r.failed, busy: r.busy })
      )
    })
  }, [])
```

- [ ] **Step 9: `force_reload` ツールのテストを書く**

Create `tests/main/mcp/forceReload.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildTools, type ToolCore } from '../../../src/main/mcp/tools'

const NOW = Date.parse('2026-07-26T00:00:00Z')

function fakeCore(run: ToolCore['uiRefresh']['run']): ToolCore {
  return {
    ohlcv: { get: vi.fn(), refresh: vi.fn() },
    symbols: { search: vi.fn(), profile: vi.fn() },
    quote: { get: vi.fn() },
    company: { info: vi.fn() },
    workspaces: { get: vi.fn(), set: vi.fn(), mutate: vi.fn() },
    capabilities: { get: vi.fn() },
    cacheStatus: { summarize: vi.fn(() => []) },
    uiRefresh: { run, settle: vi.fn() }
  } as unknown as ToolCore
}

const tool = (core: ToolCore) => {
  const def = buildTools(core, () => NOW).find((t) => t.name === 'force_reload')
  if (!def) throw new Error('no tool named force_reload')
  return def
}

describe('force_reload', () => {
  it('reports the counts the window returned', async () => {
    const core = fakeCore(async () => ({ ok: true, refreshed: 4, failed: 1, busy: false }))
    const res = await tool(core).handler({})
    expect(res.isError).toBeUndefined()
    expect(res.content[0].text).toBe('Refreshed 4 charts, 1 failed.')
  })

  it('uses the singular for one chart and omits the failure clause at zero', async () => {
    const core = fakeCore(async () => ({ ok: true, refreshed: 1, failed: 0, busy: false }))
    const res = await tool(core).handler({})
    expect(res.content[0].text).toBe('Refreshed 1 chart.')
  })

  it('maps busy to a retryable message', async () => {
    const core = fakeCore(async () => ({ ok: true, refreshed: 0, failed: 0, busy: true }))
    const res = await tool(core).handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('A refresh is already in progress in the app.')
  })

  it('maps a missing window', async () => {
    const core = fakeCore(async () => ({ ok: false, reason: 'no-window' }))
    const res = await tool(core).handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('The app window is not available.')
  })

  it('maps a timeout', async () => {
    const core = fakeCore(async () => ({ ok: false, reason: 'timeout' }))
    const res = await tool(core).handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Refresh timed out — it may still be running in the app.')
  })
})
```

- [ ] **Step 10: テストが落ちることを確認**

Run: `npx vitest run tests/main/mcp/forceReload.test.ts`
Expected: FAIL — `no tool named force_reload`

- [ ] **Step 11: `force_reload` ツールを実装**

`src/main/mcp/tools.ts` の `ToolCore` に `uiRefresh` を追加:

```ts
export type ToolCore = Pick<
  Core, 'ohlcv' | 'symbols' | 'quote' | 'company' | 'workspaces' | 'capabilities' | 'cacheStatus' | 'uiRefresh'
>
```

`src/main/mcp/workspaceTools.ts` に追加する。

```ts
  const forceReloadHandler: ToolHandler = async () => {
    const result = await core.uiRefresh.run()
    if (!result.ok) {
      return fail(result.reason === 'no-window'
        ? 'The app window is not available.'
        : 'Refresh timed out — it may still be running in the app.')
    }
    if (result.busy) return fail('A refresh is already in progress in the app.')
    const failed = result.failed > 0 ? `, ${result.failed} failed` : ''
    return ok(`Refreshed ${plural(result.refreshed, 'chart')}${failed}.`)
  }
```

返り値の配列に足す:

```ts
    {
      name: 'force_reload',
      description: "Refetch every chart the user currently has on screen, exactly like the app's reload button: market status, the visible cells' bars, and quotes. Costs one API request per visible chart plus quotes, so use it only when the user asks for fresh data.",
      schema: z.object({}),
      handler: forceReloadHandler
    }
```

- [ ] **Step 12: テストが通ることを確認**

Run: `npx vitest run tests/main/mcp/forceReload.test.ts`
Expected: PASS

- [ ] **Step 13: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 14: 手動確認**

Run: `npm run dev`

1. Settings で MCP を有効化し、トークンを生成する
2. `claude mcp add --transport http vibing-view http://127.0.0.1:39100/mcp --header "Authorization: Bearer <token>"` で登録
3. Claude から順に叩き、アプリの画面が即座に変わることを確認する:
   - `get_workspace` → セル id とインジケータ id が出ている
   - `set_grid_layout(rows: 1, cols: 2)` → グリッドが 2 枠になる
   - `set_chart(cell: "<id>", symbol: "AMD")` → 2 枠目に AMD が出る
   - `add_indicator(cell: "<id>", type: "ma", params: {period: 50})` → 線が描かれる
   - `update_indicator(indicator: "<id>", color: "#ff0000")` → 線が赤くなる
   - `edit_watchlist(add: ["TSLA"])` → サイドバーに TSLA が増える
   - `force_reload()` → リロードボタンと同じ挙動（⏱ の表示・トースト含む）で `Refreshed N charts` が返る
4. enlarge 窓（チャートを拡大表示）を開いた状態で `set_chart` を打ち、そちらも追随することを確認する

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat(mcp): force_reload delegated to the app window (MW-14)"
```

---

## Self-Review

**1. Spec coverage**

| spec のセクション | 対応タスク |
|---|---|
| インジケータ定義の共有（MW-06） | Task 1, 2 |
| params の検証（MW-15） | Task 3, Task 11 Step 4 |
| `get_workspace` に indicator id（MW-12） | Task 4 |
| `ProfileService`（MW-13） | Task 5 |
| id の採番（MW-05） | Task 6（`makeIdMinter`） |
| UI 挙動のパリティ | Task 6（clearCell）, Task 7（setShape）, Task 8（fixed Volume）, Task 9（名前の一意性・最後の 1 件） |
| `core.workspaces.mutate`（MW-04） | Task 10 |
| `set_chart` / `set_grid_layout`（MW-08, MW-09） | Task 11 |
| インジケータ 3 ツール（MW-16） | Task 8, 11 |
| `edit_watchlist` / ワークスペース 4 ツール（MW-07） | Task 9, 12 |
| `force_reload` の委譲（MW-10, MW-14） | Task 13, 14 |
| エラー処理の文言表 | Task 6/8/9（editor 側）, Task 11/12/14（tool 側） |
| レースの受容（MW-11） | 実装なし。仕様どおり調停を入れない |

**2. Placeholder scan:** 全ステップにコマンドかコードブロックが入っていること、`TBD` / `後で` / `適切に` が無いことを確認済み。

**3. Type consistency:** `EditResult<T>`（edits.ts）と `MutateResult<T>`（core.ts）は同じ構造で、`mutate` は editor の返り値をそのまま返す。`ToolCore` は Task 11 で `workspaces.mutate` を、Task 14 で `uiRefresh` を得る。`ReloadResult` は Task 13 で定義し Task 14 の `RefreshDonePayload` に同じフィールド名で載る。`formatCellLine`（formatEdits.ts）と `formatWorkspaceDetail`（format.ts）は同じ `[id] type(params)` 表記を別実装で持つ — 意図的な重複（前者はセル 1 行、後者はワークスペース全体）で、両方に Task 4 / Task 11 のテストがある。
