import {
  CandlestickChart,
  Crosshair,
  GripVertical,
  Newspaper,
  Palette,
  RotateCcw,
  Target,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { type ChartPreferences, updateChartPreferences } from "../../hooks/useChartPreferences.ts";
import { useDragOffset } from "../../hooks/useDragOffset.ts";
import { cn } from "../../lib/utils.ts";
import { CHART_COLORS, type ChartColors } from "./constants.ts";

// ── Chart Settings dialog ─────────────────────────────────────────────────────
// Opened from the chart context menu. Every control writes straight through
// updateChartPreferences, which broadcasts to all useChartPreferences
// subscribers — the chart applies changes live, no Save button needed.
// The dialog is draggable by its header so it can be moved off the chart area.

export interface ChartSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  prefs: ChartPreferences;
  isDark: boolean;
  activePlugins: string[];
  onTogglePlugin?: (id: string) => void;
  onOpenNewsConfig: () => void;
  /** Whether the account has challenge metrics (controls the Challenge tab note). */
  hasAccount: boolean;
}

type TabId = "appearance" | "colors" | "trading" | "events" | "challenge";

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: "appearance", label: "Appearance", icon: <CandlestickChart className="h-3.5 w-3.5" /> },
  { id: "colors", label: "Colors", icon: <Palette className="h-3.5 w-3.5" /> },
  { id: "trading", label: "Trading", icon: <Crosshair className="h-3.5 w-3.5" /> },
  { id: "events", label: "Events", icon: <Newspaper className="h-3.5 w-3.5" /> },
  { id: "challenge", label: "Challenge", icon: <Target className="h-3.5 w-3.5" /> },
];

/** Per-tab "Reset to defaults" payloads. Events tab has none (plugin-driven). */
const RESET_BY_TAB: Partial<Record<TabId, Partial<ChartPreferences>>> = {
  appearance: {
    showWicks: true,
    showCandleBorders: true,
    showVolume: true,
    showGrid: true,
    showWatermark: true,
    showCountdown: true,
    showOhlcLegend: true,
  },
  colors: {
    candleUpColor: "",
    candleDownColor: "",
    candleUpBorderMode: "body",
    candleUpBorderColor: "",
    candleDownBorderMode: "body",
    candleDownBorderColor: "",
    candleUpWickMode: "body",
    candleUpWickColor: "",
    candleDownWickMode: "body",
    candleDownWickColor: "",
    colorBackground: "",
    colorGrid: "",
    colorScaleText: "",
    colorCrosshair: "",
    colorBidLine: "",
    colorAskLine: "",
    colorPositionLong: "",
    colorPositionShort: "",
    colorOrderLine: "",
    colorTpLine: "",
    colorSlLine: "",
  },
  trading: { showBidLine: true, showAskLine: true, overlayPositionsOnChart: true },
  challenge: {
    challengeOverlay: true,
    challengeDailyLossLine: true,
    challengeMaxDrawdownLine: true,
    challengeProfitTargetLine: true,
  },
};

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  // In-flow flex knob with explicit p-0/border-0 — relying on absolute
  // positioning let the browser's default button padding push the knob off
  // the track, which is what made these render misaligned.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors",
        checked ? "bg-primary" : "bg-secondary",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2", disabled && "opacity-40")}>
      <div className="min-w-0">
        <div className="text-xs text-foreground">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={disabled ? () => undefined : onChange} />
    </div>
  );
}

function ColorSwatch({
  value,
  fallback,
  onChange,
}: {
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="color"
      value={value || fallback}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 w-8 cursor-pointer rounded-full border border-border bg-transparent p-0"
    />
  );
}

function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  /** Stored override; empty string means "theme default". */
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="text-xs text-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <ColorSwatch value={value} fallback={fallback} onChange={onChange} />
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

/** Two swatches on one row (e.g. long/short, up/down). */
function ColorPairRow({
  label,
  a,
  b,
}: {
  label: string;
  a: { value: string; fallback: string; onChange: (v: string) => void };
  b: { value: string; fallback: string; onChange: (v: string) => void };
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="text-xs text-foreground">{label}</div>
      <div className="flex items-center gap-1.5">
        <ColorSwatch {...a} />
        <ColorSwatch {...b} />
      </div>
    </div>
  );
}

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function AppearanceTab({ prefs }: { prefs: ChartPreferences }) {
  const set = updateChartPreferences;
  return (
    <div>
      <SectionTitle>Candles</SectionTitle>
      <ToggleRow label="Wicks" checked={prefs.showWicks} onChange={(v) => set({ showWicks: v })} />
      <ToggleRow
        label="Candle borders"
        checked={prefs.showCandleBorders}
        onChange={(v) => set({ showCandleBorders: v })}
      />
      <SectionTitle>Chart elements</SectionTitle>
      <ToggleRow
        label="Volume"
        hint="Histogram at the bottom of the chart"
        checked={prefs.showVolume}
        onChange={(v) => set({ showVolume: v })}
      />
      <ToggleRow
        label="Grid lines"
        checked={prefs.showGrid}
        onChange={(v) => set({ showGrid: v })}
      />
      <ToggleRow
        label="Symbol watermark"
        checked={prefs.showWatermark}
        onChange={(v) => set({ showWatermark: v })}
      />
      <ToggleRow
        label="Candle countdown"
        hint="Time remaining until the bar closes"
        checked={prefs.showCountdown}
        onChange={(v) => set({ showCountdown: v })}
      />
      <ToggleRow
        label="OHLC legend"
        checked={prefs.showOhlcLegend}
        onChange={(v) => set({ showOhlcLegend: v })}
      />
    </div>
  );
}

function ElementColorRows({ prefs, theme }: { prefs: ChartPreferences; theme: ChartColors }) {
  const set = updateChartPreferences;
  return (
    <>
      <SectionTitle>Chart elements</SectionTitle>
      <ColorRow
        label="Background"
        value={prefs.colorBackground}
        fallback={theme.background}
        onChange={(v) => set({ colorBackground: v })}
      />
      <ColorRow
        label="Grid"
        value={prefs.colorGrid}
        fallback={theme.grid}
        onChange={(v) => set({ colorGrid: v })}
      />
      <ColorRow
        label="Scales text"
        value={prefs.colorScaleText}
        fallback={theme.text}
        onChange={(v) => set({ colorScaleText: v })}
      />
      <ColorRow
        label="Crosshair"
        value={prefs.colorCrosshair}
        fallback={theme.crosshair}
        onChange={(v) => set({ colorCrosshair: v })}
      />
    </>
  );
}

function LineColorRows({ prefs, theme }: { prefs: ChartPreferences; theme: ChartColors }) {
  const set = updateChartPreferences;
  return (
    <>
      <SectionTitle>Price &amp; order lines</SectionTitle>
      <ColorRow
        label="Bid line"
        value={prefs.colorBidLine}
        fallback={theme.bidLine}
        onChange={(v) => set({ colorBidLine: v })}
      />
      <ColorRow
        label="Ask line"
        value={prefs.colorAskLine}
        fallback={theme.askLine}
        onChange={(v) => set({ colorAskLine: v })}
      />
      <ColorPairRow
        label="Open positions"
        a={{
          value: prefs.colorPositionLong,
          fallback: theme.positionLong,
          onChange: (v) => set({ colorPositionLong: v }),
        }}
        b={{
          value: prefs.colorPositionShort,
          fallback: theme.positionShort,
          onChange: (v) => set({ colorPositionShort: v }),
        }}
      />
      <ColorRow
        label="Pending orders"
        value={prefs.colorOrderLine}
        fallback={theme.orderLine}
        onChange={(v) => set({ colorOrderLine: v })}
      />
      <ColorRow
        label="Take profit"
        value={prefs.colorTpLine}
        fallback={theme.tpLine}
        onChange={(v) => set({ colorTpLine: v })}
      />
      <ColorRow
        label="Stop loss"
        value={prefs.colorSlLine}
        fallback={theme.slLine}
        onChange={(v) => set({ colorSlLine: v })}
      />
    </>
  );
}

const CANDLE_PRESETS: Array<{ name: string; values: Partial<ChartPreferences> }> = [
  {
    name: "Classic Green/Red",
    values: {
      candleUpColor: "#26a69a",
      candleDownColor: "#ef5350",
      candleUpBorderMode: "body",
      candleUpBorderColor: "",
      candleDownBorderMode: "body",
      candleDownBorderColor: "",
      candleUpWickMode: "body",
      candleUpWickColor: "",
      candleDownWickMode: "body",
      candleDownWickColor: "",
    },
  },
  {
    name: "TradingView Default",
    values: {
      candleUpColor: "#089981",
      candleDownColor: "#f23645",
      candleUpBorderMode: "body",
      candleUpBorderColor: "",
      candleDownBorderMode: "body",
      candleDownBorderColor: "",
      candleUpWickMode: "body",
      candleUpWickColor: "",
      candleDownWickMode: "body",
      candleDownWickColor: "",
    },
  },
  {
    name: "Black & White",
    values: {
      candleUpColor: "#ffffff",
      candleDownColor: "#111827",
      candleUpBorderMode: "custom",
      candleUpBorderColor: "#111827",
      candleDownBorderMode: "custom",
      candleDownBorderColor: "#111827",
      candleUpWickMode: "custom",
      candleUpWickColor: "#111827",
      candleDownWickMode: "custom",
      candleDownWickColor: "#111827",
    },
  },
  {
    name: "Blue/Orange",
    values: {
      candleUpColor: "#2962ff",
      candleDownColor: "#ff9800",
      candleUpBorderMode: "body",
      candleUpBorderColor: "",
      candleDownBorderMode: "body",
      candleDownBorderColor: "",
      candleUpWickMode: "body",
      candleUpWickColor: "",
      candleDownWickMode: "body",
      candleDownWickColor: "",
    },
  },
];

function CandleColorPicker({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="truncate">{label}</span>
      <input
        type="color"
        aria-label={label}
        value={value || fallback}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
    </label>
  );
}

function CandleModeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CandleStylePreview({ prefs, theme }: { prefs: ChartPreferences; theme: ChartColors }) {
  const bodies = [prefs.candleUpColor || theme.up, prefs.candleDownColor || theme.down];
  const borders = [
    prefs.candleUpBorderMode === "none"
      ? "transparent"
      : prefs.candleUpBorderMode === "custom"
        ? prefs.candleUpBorderColor || bodies[0]
        : bodies[0],
    prefs.candleDownBorderMode === "none"
      ? "transparent"
      : prefs.candleDownBorderMode === "custom"
        ? prefs.candleDownBorderColor || bodies[1]
        : bodies[1],
  ];
  const wicks = [
    prefs.candleUpWickMode === "custom" ? prefs.candleUpWickColor || bodies[0] : bodies[0],
    prefs.candleDownWickMode === "custom" ? prefs.candleDownWickColor || bodies[1] : bodies[1],
  ];
  const candles = [
    { x: 42, high: 10, top: 28, bottom: 56, low: 76, down: false },
    { x: 100, high: 18, top: 39, bottom: 64, low: 82, down: true },
    { x: 158, high: 7, top: 24, bottom: 49, low: 69, down: false },
  ];

  return (
    <svg
      viewBox="0 0 200 90"
      role="img"
      aria-label="Preview of bullish and bearish candles"
      className="h-20 w-full rounded border border-border bg-background"
    >
      {[24, 45, 66].map((y) => (
        <line key={y} x1="0" x2="200" y1={y} y2={y} stroke="currentColor" opacity="0.08" />
      ))}
      {candles.map((candle, index) => {
        const colorIndex = candle.down ? 1 : 0;
        const border = prefs.showCandleBorders && borders[colorIndex] !== "transparent"
          ? borders[colorIndex]
          : "transparent";
        return (
          <g key={candle.x}>
            {prefs.showWicks && (
              <line
                x1={candle.x}
                x2={candle.x}
                y1={candle.high}
                y2={candle.low}
                stroke={wicks[colorIndex]}
                strokeWidth="2"
              />
            )}
            <rect
              x={candle.x - 10}
              y={candle.top}
              width="20"
              height={candle.bottom - candle.top}
              fill={bodies[colorIndex]}
              stroke={border}
              strokeWidth="2"
            />
            <title>{index === 1 ? "Bearish candle" : "Bullish candle"}</title>
          </g>
        );
      })}
    </svg>
  );
}

function CandleStylePanel({ prefs, theme }: { prefs: ChartPreferences; theme: ChartColors }) {
  const set = updateChartPreferences;
  const borderOptions = [
    { value: "body", label: "Match body" },
    { value: "custom", label: "Custom" },
    { value: "none", label: "No border" },
  ];
  const wickOptions = [
    { value: "body", label: "Match body" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <div>
      <SectionTitle>Candle style</SectionTitle>
      <CandleStylePreview prefs={prefs} theme={theme} />
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {CANDLE_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => set({ ...preset.values, showCandleBorders: true, showWicks: true })}
            className="rounded border border-border px-2 py-1.5 text-left text-[11px] text-foreground hover:bg-secondary"
          >
            {preset.name}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <SectionTitle className="col-span-2">Body</SectionTitle>
        <CandleColorPicker
          label="Bullish body"
          value={prefs.candleUpColor}
          fallback={theme.up}
          onChange={(value) => set({ candleUpColor: value })}
        />
        <CandleColorPicker
          label="Bearish body"
          value={prefs.candleDownColor}
          fallback={theme.down}
          onChange={(value) => set({ candleDownColor: value })}
        />
        <SectionTitle className="col-span-2">Borders / outline</SectionTitle>
        <div className="space-y-2">
          <CandleModeSelect
            label="Bullish border"
            value={prefs.candleUpBorderMode}
            options={borderOptions}
            onChange={(value) => set({ candleUpBorderMode: value as ChartPreferences["candleUpBorderMode"] })}
          />
          {prefs.candleUpBorderMode === "custom" && (
            <CandleColorPicker
              label="Bullish border color"
              value={prefs.candleUpBorderColor}
              fallback={prefs.candleUpColor || theme.up}
              onChange={(value) => set({ candleUpBorderColor: value })}
            />
          )}
        </div>
        <div className="space-y-2">
          <CandleModeSelect
            label="Bearish border"
            value={prefs.candleDownBorderMode}
            options={borderOptions}
            onChange={(value) => set({ candleDownBorderMode: value as ChartPreferences["candleDownBorderMode"] })}
          />
          {prefs.candleDownBorderMode === "custom" && (
            <CandleColorPicker
              label="Bearish border color"
              value={prefs.candleDownBorderColor}
              fallback={prefs.candleDownColor || theme.down}
              onChange={(value) => set({ candleDownBorderColor: value })}
            />
          )}
        </div>
        <SectionTitle className="col-span-2">Wicks</SectionTitle>
        <div className="space-y-2">
          <CandleModeSelect
            label="Bullish wick"
            value={prefs.candleUpWickMode}
            options={wickOptions}
            onChange={(value) => set({ candleUpWickMode: value as ChartPreferences["candleUpWickMode"] })}
          />
          {prefs.candleUpWickMode === "custom" && (
            <CandleColorPicker
              label="Bullish wick color"
              value={prefs.candleUpWickColor}
              fallback={prefs.candleUpColor || theme.up}
              onChange={(value) => set({ candleUpWickColor: value })}
            />
          )}
        </div>
        <div className="space-y-2">
          <CandleModeSelect
            label="Bearish wick"
            value={prefs.candleDownWickMode}
            options={wickOptions}
            onChange={(value) => set({ candleDownWickMode: value as ChartPreferences["candleDownWickMode"] })}
          />
          {prefs.candleDownWickMode === "custom" && (
            <CandleColorPicker
              label="Bearish wick color"
              value={prefs.candleDownWickColor}
              fallback={prefs.candleDownColor || theme.down}
              onChange={(value) => set({ candleDownWickColor: value })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ColorsTab({ prefs, isDark }: { prefs: ChartPreferences; isDark: boolean }) {
  const theme = isDark ? CHART_COLORS.dark : CHART_COLORS.light;
  return (
    <div>
      <CandleStylePanel prefs={prefs} theme={theme} />
      <ElementColorRows prefs={prefs} theme={theme} />
      <LineColorRows prefs={prefs} theme={theme} />
    </div>
  );
}

function TradingTab({ prefs }: { prefs: ChartPreferences }) {
  const set = updateChartPreferences;
  return (
    <div>
      <SectionTitle>Price lines</SectionTitle>
      <ToggleRow
        label="Bid line"
        checked={prefs.showBidLine}
        onChange={(v) => set({ showBidLine: v })}
      />
      <ToggleRow
        label="Ask line"
        checked={prefs.showAskLine}
        onChange={(v) => set({ showAskLine: v })}
      />
      <SectionTitle>Positions &amp; orders</SectionTitle>
      <ToggleRow
        label="Show positions and orders on chart"
        hint="Entry, TP and SL lines with drag-to-edit"
        checked={prefs.overlayPositionsOnChart}
        onChange={(v) => set({ overlayPositionsOnChart: v })}
      />
    </div>
  );
}

function EventsTab({
  activePlugins,
  onTogglePlugin,
  onOpenNewsConfig,
  onClose,
}: {
  activePlugins: string[];
  onTogglePlugin?: (id: string) => void;
  onOpenNewsConfig: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <SectionTitle>Sessions</SectionTitle>
      <ToggleRow
        label="Session breaks"
        hint="Vertical line at each trading-day boundary (intraday only)"
        checked={activePlugins.includes("session-breaks")}
        disabled={!onTogglePlugin}
        onChange={() => onTogglePlugin?.("session-breaks")}
      />
      <ToggleRow
        label="Session highlighting"
        hint="Shade Asia / London / New York forex sessions"
        checked={activePlugins.includes("session")}
        disabled={!onTogglePlugin}
        onChange={() => onTogglePlugin?.("session")}
      />
      <SectionTitle>News</SectionTitle>
      <button
        onClick={() => {
          onClose();
          onOpenNewsConfig();
        }}
        className="mt-1 rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary"
      >
        Configure news overlay…
      </button>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Impact filter, event markers and no-trade window shading are configured in the news overlay
        dialog.
      </p>
    </div>
  );
}

function ChallengeTab({ prefs, hasAccount }: { prefs: ChartPreferences; hasAccount: boolean }) {
  const set = updateChartPreferences;
  const master = prefs.challengeOverlay;
  return (
    <div>
      <SectionTitle>Challenge levels on chart</SectionTitle>
      <ToggleRow
        label="Show challenge levels"
        hint="Projects your account's rule thresholds onto the chart as price lines"
        checked={master}
        onChange={(v) => set({ challengeOverlay: v })}
      />
      <ToggleRow
        label="Daily loss limit"
        checked={prefs.challengeDailyLossLine}
        disabled={!master}
        onChange={(v) => set({ challengeDailyLossLine: v })}
      />
      <ToggleRow
        label="Max drawdown"
        checked={prefs.challengeMaxDrawdownLine}
        disabled={!master}
        onChange={(v) => set({ challengeMaxDrawdownLine: v })}
      />
      <ToggleRow
        label="Profit target"
        checked={prefs.challengeProfitTargetLine}
        disabled={!master}
        onChange={(v) => set({ challengeProfitTargetLine: v })}
      />
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Lines appear while you have an open position in the charted symbol — the price at which your
        equity would hit each limit is computed from your net exposure and moves with every tick.
        {!hasAccount && " Select an account to enable."}
      </p>
    </div>
  );
}

function TabBody({
  tab,
  props,
}: {
  tab: TabId;
  props: Pick<
    ChartSettingsDialogProps,
    "prefs" | "isDark" | "activePlugins" | "onTogglePlugin" | "onOpenNewsConfig" | "hasAccount"
  > & { onClose: () => void };
}) {
  if (tab === "appearance") return <AppearanceTab prefs={props.prefs} />;
  if (tab === "colors") return <ColorsTab prefs={props.prefs} isDark={props.isDark} />;
  if (tab === "trading") return <TradingTab prefs={props.prefs} />;
  if (tab === "events") {
    return (
      <EventsTab
        activePlugins={props.activePlugins}
        onTogglePlugin={props.onTogglePlugin}
        onOpenNewsConfig={props.onOpenNewsConfig}
        onClose={props.onClose}
      />
    );
  }
  return <ChallengeTab prefs={props.prefs} hasAccount={props.hasAccount} />;
}

export function ChartSettingsDialog(props: ChartSettingsDialogProps) {
  const { open, onClose } = props;
  const [tab, setTab] = useState<TabId>("appearance");
  const drag = useDragOffset();
  if (!open) return null;

  const close = () => {
    drag.reset();
    onClose();
  };
  const resetPayload = RESET_BY_TAB[tab];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={close}
    >
      <div
        className="flex h-[440px] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        style={drag.style}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle header */}
        <div
          onPointerDown={drag.onPointerDown}
          className="flex cursor-grab select-none items-center justify-between border-b border-border px-3 py-2.5 active:cursor-grabbing"
        >
          <div className="flex items-center gap-1.5">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
            <h2 className="text-sm font-semibold text-foreground">Chart Settings</h2>
          </div>
          <button onClick={close} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-36 shrink-0 border-r border-border p-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors",
                  tab === t.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <TabBody tab={tab} props={{ ...props, onClose: close }} />
          </div>
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          {resetPayload ? (
            <button
              onClick={() => updateChartPreferences(resetPayload)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to defaults
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={close}
            className="rounded bg-secondary px-3 py-1 text-xs text-foreground hover:bg-secondary/70"
          >
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}
