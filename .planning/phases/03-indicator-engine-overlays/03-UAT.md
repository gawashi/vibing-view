---
status: complete
phase: 03-indicator-engine-overlays
source: [03-01-PLAN.md, 03-02-PLAN.md, 03-03-PLAN.md]
started: 2026-07-19T12:43:29Z
updated: 2026-07-19T12:47:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Add MA overlay
expected: "+指標" → MA draws one SMA line (period 20) on the price pane + a "MA 20" legend row with a color swatch. No network request fires.
result: issue
reported: "なんで+指標だけ日本語にしたの？ 他は問題なし"
severity: cosmetic
note: Functionality confirmed (SMA line + legend row draw correctly). Only the label language is inconsistent — the "+指標" CTA is Japanese while all other phase-3 copy (field labels Period/Type/Source/Std Dev ×/Color, tooltips Show/Hide/Edit parameters/Remove, menu items MA/BB) is English. Origin: 03-UI-SPEC.md Copywriting Contract specified "+ 指標".

### 2. Multiple independent MA instances
expected: Click +指標 → MA a second time → a second SMA line and a second "MA 20" legend row appear, in a different palette color. The two instances are independent (not merged), rows in add order.
result: pass

### 3. Indicators persist + recompute on symbol/timeframe switch
expected: With MA instances on the chart, switch symbol and switch timeframe → the indicator lines persist and recompute from the new bars. DevTools Network shows zero new requests on add and on switch.
result: pass

### 4. Live parameter editing (schema-driven form)
expected: Click the gear on a legend row → an edit form opens pre-filled with Period / Type (SMA/EMA) / Source / Color. Change Period → line rebuilds instantly; switch SMA→EMA → line shape changes; change Source (e.g. close→hl2) → recomputes; change Color → line + legend swatch update. Zero network requests throughout.
result: pass

### 5. Legend row controls (eye / delete)
expected: Eye toggles the instance's line visibility and dims/undims the row label (instance NOT removed). The × button removes the instance immediately with no confirmation dialog. Each icon has a tooltip.
result: pass

### 6. Legend overflow scroll
expected: Add ~10 MA instances → the legend caps its height (~50% of canvas) and scrolls internally; every row stays reachable and the chart underneath is never fully covered. Long labels stay on one line (no wrap).
result: pass

### 7. Add Bollinger Bands
expected: +指標 → BB draws three lines (upper/middle/lower) at defaults 20/2σ in one palette hue, with a single "BB 20,2" legend row. Opening its gear shows auto-generated Period / Std Dev × / Source / Color fields. Editing period or σ recomputes instantly with zero network.
result: pass

### 8. BB translucent band fill
expected: BB shows a translucent fill (~15% opacity of the instance hue) between the upper and lower bands, beneath the three lines. Panning/zooming keeps the fill aligned; hiding the instance hides the fill; deleting removes it cleanly with no leftover artifact or console error. (A documented 3-line-only fallback also passes per DESIGN §5.)
result: pass

## Summary

total: 8
passed: 7
issues: 1
pending: 0
skipped: 0

## Gaps

- gap_id: G-03-1
  truth: "Add-indicator CTA label is consistent with the rest of the phase-3 UI copy"
  status: resolved
  reason: "User reported: なんで+指標だけ日本語にしたの？ 他は問題なし — the '+指標' button is Japanese while all other phase-3 copy is English (inconsistent copywriting)."
  severity: cosmetic
  test: 1
  resolution: "User chose English. Changed AddIndicatorMenu label 指標 → Indicator; updated stale IndicatorLegend comment. typecheck passes."
  resolved_at: 2026-07-19
  artifacts:
    - path: src/renderer/components/AddIndicatorMenu.tsx
      issue: "CTA text was '指標' (Japanese) — now 'Indicator'"
  missing: []
