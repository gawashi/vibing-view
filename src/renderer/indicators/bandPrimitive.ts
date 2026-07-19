import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { LineData } from './types'

/** hex ('#rrggbb') -> rgba(...) at the given alpha. Generic — any indicator's palette hue works. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

class BandPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly source: BandPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const { chart, series, upper, lower, color, visible } = this.source
    if (!visible || !chart || !series || upper.length < 2 || lower.length < 2) return

    const timeScale = chart.timeScale()
    const toPoint = (d: LineData): { x: number; y: number } | null => {
      const x = timeScale.timeToCoordinate(d.time as Time)
      const y = series.priceToCoordinate(d.value)
      if (x === null || y === null) return null
      return { x, y }
    }
    // Skip points that aren't currently scaled (off-screen / not yet laid out) rather than
    // throwing off the polygon — a gap in coverage is preferable to a crash.
    const upperPts = upper.map(toPoint).filter((p): p is { x: number; y: number } => p !== null)
    const lowerPts = lower.map(toPoint).filter((p): p is { x: number; y: number } => p !== null)
    if (upperPts.length < 2 || lowerPts.length < 2) return

    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr } = scope
      ctx.beginPath()
      ctx.moveTo(upperPts[0].x * hr, upperPts[0].y * vr)
      for (let i = 1; i < upperPts.length; i++) ctx.lineTo(upperPts[i].x * hr, upperPts[i].y * vr)
      for (let i = lowerPts.length - 1; i >= 0; i--) ctx.lineTo(lowerPts[i].x * hr, lowerPts[i].y * vr)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
    })
  }
}

class BandPaneView implements IPrimitivePaneView {
  constructor(private readonly source: BandPrimitive) {}

  // 'bottom' — the fill renders under the anchor series' line, matching the 3-lines-on-top spec.
  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom'
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new BandPaneRenderer(this.source)
  }
}

/**
 * Generic translucent band-fill primitive (D-29 / DESIGN §5) — draws a polygon between an
 * "upper" and a "lower" LineData series. Not BB-specific: any future indicator with a
 * `kind:'band'` output can attach one of these to its anchor line series.
 */
export class BandPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null
  series: ISeriesApi<'Line'> | null = null
  upper: LineData[] = []
  lower: LineData[] = []
  color = 'rgba(0, 0, 0, 0)'
  visible = true

  private requestUpdate: (() => void) | null = null
  private readonly views = [new BandPaneView(this)]

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart
    this.series = param.series as ISeriesApi<'Line'>
    this.requestUpdate = param.requestUpdate
  }

  detached(): void {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }

  update(upper: LineData[], lower: LineData[], color: string, visible: boolean): void {
    this.upper = upper
    this.lower = lower
    this.color = color
    this.visible = visible
    this.requestUpdate?.()
  }
}
