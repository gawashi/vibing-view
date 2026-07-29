// src/renderer/lib/chartTheme.ts
// ローソク足チャートと統計指標の折れ線が同じテーマ色を使うので、Chart.tsx から出した。

// Read a theme CSS var (e.g. "210 24% 6%") and return a usable CSS color string. Lets the chart
// track the light/dark palette instead of the old hardcoded dark hexes (#0B0E11 / #151920).
export function cssHsl(name: string, alpha?: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!v) return ''
  return alpha === undefined ? `hsl(${v})` : `hsl(${v} / ${alpha})`
}

// Chart layout/grid/border colors derived from the current theme. Re-read on theme change so a
// Light/Dark toggle recolors the canvas. Candle up/down colors stay fixed (readable on both).
export function chartThemeOptions(): {
  layout: { background: { color: string }; textColor: string; panes: { separatorColor: string; separatorHoverColor: string } }
  grid: { vertLines: { color: string }; horzLines: { color: string } }
  timeScale: { borderColor: string }
  rightPriceScale: { borderColor: string }
} {
  const grid = cssHsl('--border')
  return {
    layout: {
      background: { color: cssHsl('--background') },
      textColor: cssHsl('--muted-foreground'),
      panes: { separatorColor: cssHsl('--muted-foreground', 0.25), separatorHoverColor: cssHsl('--muted-foreground', 0.2) }
    },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    timeScale: { borderColor: grid },
    rightPriceScale: { borderColor: grid }
  }
}
