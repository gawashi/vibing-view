---
phase: 4
slug: pane-indicators-crosshair-correct-math
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-19
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `04-RESEARCH.md` §Validation Architecture. IND-09 (math correctness) is fully
> automatable; IND-04/05/06 render + CHART-04 crosshair sync have no e2e infra in this repo
> (no Playwright, confirmed) → compute-logic is unit-tested, visual behavior is manual UAT.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.0.x (installed; `tests/indicators/math.test.ts` already exists and passes) |
| **Config file** | `vitest.config.ts` — `test.include: ['tests/**/*.test.ts']`, `environment: 'node'` |
| **Quick run command** | `npx vitest run tests/indicators/` |
| **Full suite command** | `npm test` (= `vitest run`, all suites) |
| **Estimated runtime** | ~2–5 seconds (pure-function unit tests, no browser/Electron) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/indicators/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite green **and** manual UAT of sub-pane render, crosshair sync, pane resize/collapse
- **Max feedback latency:** ~5 seconds (unit); manual UAT at phase gate only

---

## Per-Task Verification Map

Task IDs assigned by the planner; rows below are requirement-anchored and map to the research test plan.
`math.ts` keeps its zero-imports contract so tests import it in isolation (mirrors existing `tests/indicators/math.test.ts`).

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| IND-09 | RSI/MACD/BB/SMA/EMA match TV golden values within `<0.01` (DD-2) | unit (Vitest) | `npx vitest run tests/indicators/math.golden.test.ts` | ❌ Wave 0 | ⬜ pending |
| IND-05 | RSI module registers; correct shape; overbought/oversold params editable | unit (Vitest) | `npx vitest run tests/indicators/rsi.test.ts` | ❌ Wave 0 | ⬜ pending |
| IND-06 | MACD module registers; 3 outputs (line/signal/hist); params editable | unit (Vitest) | `npx vitest run tests/indicators/macd.test.ts` | ❌ Wave 0 | ⬜ pending |
| IND-04 | Volume compute colors by candle direction (close≥open→green) | unit (Vitest) | `npx vitest run tests/indicators/volume.test.ts` | ❌ Wave 0 | ⬜ pending |
| IND-04 | Volume pane always present, rendered | manual UAT | (visual — no e2e infra) | — | ⬜ pending |
| CHART-04 | Crosshair reads all panes at one synchronized timestamp | manual UAT | (visual — no e2e infra) | — | ⬜ pending |
| CHART-04 | Per-series value extraction from `param.seriesData` (if factored standalone) | unit (Vitest, optional) | `npx vitest run tests/indicators/crosshairValues.test.ts` | ❌ optional | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/indicators/fixtures/golden.ts` — self-contained TV-sourced OHLC + expected values (DD-1); **placeholder** (`test.todo`/skip) until user supplies real TV numbers (D-49). Fixture window **≥ ~34 bars before any MACD checkpoint** (research Q7; recommend 50–60+ bars).
- [ ] `tests/indicators/math.golden.test.ts` — single cross-indicator correctness gate, all 5 indicators (DESIGN §6)
- [ ] `tests/indicators/rsi.test.ts` / `macd.test.ts` / `volume.test.ts` — module-shape unit tests (distinct from the golden gate), mirroring existing `tests/indicators/math.test.ts` style
- [ ] No framework/config install needed — Vitest already set up and proven against `tests/indicators/`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sub-pane render + fixed Volume pane + up/down bar color | IND-04 | No e2e/render harness in repo | Launch app, select symbol; confirm Volume pane below price, green/red bars match candle direction |
| RSI/MACD add via "+指標", one-instance-one-pane stacking, removal collapse (D-33/36) | IND-05/06 | Requires live chart interaction | Add RSI then MACD via menu; confirm each gets its own pane; remove → pane collapses, lower panes shift up |
| RSI 0-100 fixed scale + 70/30 guides/zone; MACD zero line + 4-color hist | IND-05/06 | Visual verification | Confirm RSI scale locked 0-100 with shaded 70/30 zone; MACD zero line + 4 histogram shades |
| Crosshair synchronized read across all panes; non-hover → latest bar | CHART-04 | Requires mouse simulation over rendered canvas | Move crosshair; confirm every pane legend updates at same timestamp; move cursor off chart → all legends show latest bar values |
| Pane drag-resize (D-32) + per-pane legend stays aligned | CHART-04/IND-04 | Native drag + ResizeObserver repositioning | Drag a pane separator; confirm legends reposition to each pane's top-left |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter (set by validate-phase once golden values filled + tests green)

**Approval:** pending
