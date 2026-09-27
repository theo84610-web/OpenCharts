import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  CandlestickData,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  Time,
} from "lightweight-charts";
import {
  calculateEngulfingZones,
  type EngulfingSetup,
  type EngulfingZonesSettings,
} from "../../engulfing-zones.ts";
import { PluginBase } from "../plugin-base.ts";

export type EngulfingZonesOptions = EngulfingZonesSettings;

interface ZoneRenderItem {
  x1: number;
  x2: number;
  top: number;
  bottom: number;
  fillColor: string;
  borderColor: string;
}

class EngulfingZonesPaneRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(private readonly zones: ZoneRenderItem[]) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context }) => {
      const ctx = context;
      ctx.save();
      for (const zone of this.zones) {
        const left = Math.min(zone.x1, zone.x2);
        const width = Math.max(1, Math.abs(zone.x2 - zone.x1));
        const top = Math.min(zone.top, zone.bottom);
        const height = Math.max(1, Math.abs(zone.bottom - zone.top));
        ctx.fillStyle = zone.fillColor;
        ctx.fillRect(left, top, width, height);
        ctx.strokeStyle = zone.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(left, top, width, height);
      }
      ctx.restore();
    });
  }
}

class EngulfingZonesPaneView implements ISeriesPrimitivePaneView {
  private zones: ZoneRenderItem[] = [];

  constructor(private readonly source: EngulfingZonesPrimitive) {}

  update(): void {
    this.zones = this.source.resolveZones();
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new EngulfingZonesPaneRenderer(this.zones);
  }
}

function colorWithAlpha(color: string, alpha: number): string {
  const hex = color.replace(/^#/, "");
  const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return `rgba(30, 100, 230, ${alpha})`;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const DEFAULT_OPTIONS: EngulfingZonesOptions = {
  lookbackBars: 1000,
  maxPullbackBars: 15,
  maxActiveSetups: 40,
  bullishFillColor: "#3b82f6",
  bullishBorderColor: "#1e64e6",
  bearishFillColor: "#fb923c",
  bearishBorderColor: "#ea580c",
};

export class EngulfingZonesPrimitive extends PluginBase {
  private options = DEFAULT_OPTIONS;
  private setups: EngulfingSetup[] = [];
  private readonly views = [new EngulfingZonesPaneView(this)];

  setSettings(options: EngulfingZonesOptions): void {
    this.options = options;
    this.refreshSetups();
  }

  protected dataUpdated(): void {
    this.refreshSetups();
  }

  private refreshSetups(): void {
    const data = this.series.data() as CandlestickData<Time>[];
    const candles = data.map((candle) => ({
      time: candle.time as number,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const { setups } = calculateEngulfingZones(candles, this.options);
    this.setups = setups;
    this.updateAllViews();
    this.requestUpdate();
  }

  updateAllViews(): void {
    for (const view of this.views) view.update();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this.views;
  }

  resolveZones(): ZoneRenderItem[] {
    const candles = this.series.data() as CandlestickData<Time>[];
    const timeScale = this.chart.timeScale();
    const barSpacing = Math.max(1, timeScale.options().barSpacing ?? 6);
    const zones: ZoneRenderItem[] = [];
    for (const setup of this.setups) {
      if (setup.state !== 2 || !setup.box) continue;
      const startCandle = candles[setup.box.startBar];
      const endCandle = candles[setup.box.endBar];
      if (!startCandle || !endCandle) continue;
      const startX = timeScale.timeToCoordinate(startCandle.time);
      const endX = timeScale.timeToCoordinate(endCandle.time);
      const top = this.series.priceToCoordinate(setup.box.top);
      const bottom = this.series.priceToCoordinate(setup.box.bottom);
      if (startX === null || endX === null || top === null || bottom === null) continue;
      zones.push({
        x1: startX - barSpacing / 2,
        x2: endX + barSpacing / 2,
        top,
        bottom,
        fillColor: colorWithAlpha(
          setup.direction === 1 ? this.options.bullishFillColor : this.options.bearishFillColor,
          0.2,
        ),
        borderColor:
          setup.direction === 1 ? this.options.bullishBorderColor : this.options.bearishBorderColor,
      });
    }
    return zones;
  }
}