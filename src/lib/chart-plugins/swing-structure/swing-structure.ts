import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  CandlestickData,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  Time,
} from "lightweight-charts";
import { calculateSwingStructure, type SwingPivot } from "../../swing-structure.ts";
import { PluginBase } from "../plugin-base.ts";

export interface SwingStructureOptions {
  lookbackBars: number;
  color: string;
  lineWidth: number;
  showLabels: boolean;
  showFormingLeg: boolean;
  highLabelColor: string;
  lowLabelColor: string;
}

interface Point {
  x: number;
  y: number;
}

interface Label extends Point {
  text: string;
  color: string;
  offsetY: number;
}

interface RenderData {
  confirmedSegments: Array<[Point, Point]>;
  formingSegment: [Point, Point] | null;
  labels: Label[];
  formingLabel: Label | null;
  options: SwingStructureOptions;
}

class SwingStructurePaneRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(private readonly data: RenderData) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context }) => {
      const ctx = context;
      ctx.save();
      ctx.lineWidth = this.data.options.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = this.data.options.color;
      for (const [start, end] of this.data.confirmedSegments) {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }

      if (this.data.options.showFormingLeg && this.data.formingSegment) {
        const [start, end] = this.data.formingSegment;
        ctx.strokeStyle = translucent(this.data.options.color);
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (this.data.options.showLabels) {
        ctx.font = "600 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const label of this.data.labels) drawLabel(ctx, label);
      }
      if (this.data.options.showFormingLeg && this.data.formingLabel) {
        ctx.font = "600 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        drawLabel(ctx, this.data.formingLabel);
      }
      ctx.restore();
    });
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: Label,
): void {
  ctx.fillStyle = label.color;
  ctx.fillText(label.text, label.x, label.y + label.offsetY);
}

function translucent(color: string): string {
  const hex = color.replace(/^#/, "");
  const fullHex = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(fullHex)) return "rgba(30, 100, 230, 0.4)";
  const red = Number.parseInt(fullHex.slice(0, 2), 16);
  const green = Number.parseInt(fullHex.slice(2, 4), 16);
  const blue = Number.parseInt(fullHex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.4)`;
}

class SwingStructurePaneView implements ISeriesPrimitivePaneView {
  private data = EMPTY_RENDER_DATA;

  constructor(private readonly source: SwingStructurePrimitive) {}

  update(): void {
    this.data = this.source.resolveRenderData();
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new SwingStructurePaneRenderer(this.data);
  }
}

const EMPTY_RENDER_DATA: RenderData = {
  confirmedSegments: [],
  formingSegment: null,
  labels: [],
  formingLabel: null,
  options: {
    color: "#1E64E6",
    lookbackBars: 500,
    lineWidth: 2,
    showLabels: true,
    showFormingLeg: true,
    highLabelColor: "#ef4444",
    lowLabelColor: "#22c55e",
  },
};

export class SwingStructurePrimitive extends PluginBase {
  private pivots: SwingPivot[] = [];
  private forming: SwingPivot | null = null;
  private options = EMPTY_RENDER_DATA.options;
  private readonly views = [new SwingStructurePaneView(this)];

  setSettings(options: SwingStructureOptions): void {
    this.options = options;
    this.refreshPivots();
  }

  protected dataUpdated(): void {
    this.refreshPivots();
  }

  private refreshPivots(): void {
    const data = this.series.data() as CandlestickData<Time>[];
    const result = calculateSwingStructure(
      data.map((candle) => ({
        time: candle.time as number,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
      this.options.lookbackBars,
    );
    this.pivots = result.pivots;
    this.forming = result.forming;
    this.updateAllViews();
    this.requestUpdate();
  }

  updateAllViews(): void {
    for (const view of this.views) view.update();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this.views;
  }

  resolveRenderData(): RenderData {
    const toPoint = (pivot: SwingPivot): Point | null => {
      const x = this.chart.timeScale().timeToCoordinate(pivot.time as Time);
      const y = this.series.priceToCoordinate(pivot.value);
      return x === null || y === null ? null : { x, y };
    };
    const points = this.pivots.map(toPoint);
    const confirmedSegments: Array<[Point, Point]> = [];
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1];
      const end = points[index];
      if (start && end) confirmedSegments.push([start, end]);
    }

    const labels: Label[] = [];
    if (this.options.showLabels) {
      this.pivots.forEach((pivot, index) => {
        const point = points[index];
        if (!point) return;
        labels.push({
          ...point,
          text: pivot.type === "high" ? "H" : "L",
          color: pivot.type === "high" ? this.options.highLabelColor : this.options.lowLabelColor,
          offsetY: pivot.type === "high" ? -10 : 10,
        });
      });
    }

    const formingPoint = this.forming ? toPoint(this.forming) : null;
    const lastPoint = points[points.length - 1];
    const formingSegment = lastPoint && formingPoint ? [lastPoint, formingPoint] as [Point, Point] : null;
    const formingLabel = this.forming && formingPoint
      ? {
          ...formingPoint,
          text: this.forming.type === "high" ? "H?" : "L?",
          color: this.forming.type === "high" ? this.options.highLabelColor : this.options.lowLabelColor,
          offsetY: this.forming.type === "high" ? -10 : 10,
        }
      : null;

    return {
      confirmedSegments,
      formingSegment,
      labels,
      formingLabel,
      options: this.options,
    };
  }
}