import type { CandleData } from "./indicators.ts";

export type EngulfingDirection = 1 | -1;
export type EngulfingSetupState = 0 | 1 | 2;

export interface EngulfingCandleState {
  high: number;
  low: number;
  direction: EngulfingDirection;
}

export interface EngulfingZoneRectangle {
  startBar: number;
  endBar: number;
  top: number;
  bottom: number;
}

export interface EngulfingSetup {
  direction: EngulfingDirection;
  zone1Top: number;
  zone1Bottom: number;
  state: EngulfingSetupState;
  confirmBar: number;
  extreme: number;
  swingLevel: number | null;
  pullbackExtreme: number | null;
  pullbackStartBar: number | null;
  box: EngulfingZoneRectangle | null;
}

export interface EngulfingZonesSettings {
  lookbackBars: number;
  maxPullbackBars: number;
  maxActiveSetups: number;
  bullishFillColor: string;
  bullishBorderColor: string;
  bearishFillColor: string;
  bearishBorderColor: string;
}

export interface EngulfingZonesResult {
  reference: EngulfingCandleState | null;
  lastOpp: EngulfingCandleState | null;
  setups: EngulfingSetup[];
}

function candleState(candle: CandleData): EngulfingCandleState {
  return {
    high: candle.high,
    low: candle.low,
    direction: candle.close >= candle.open ? 1 : -1,
  };
}

function createSetup(
  direction: EngulfingDirection,
  zone1Top: number,
  zone1Bottom: number,
  candle: CandleData,
  bar: number,
): EngulfingSetup {
  return {
    direction,
    zone1Top,
    zone1Bottom,
    state: 0,
    confirmBar: bar,
    extreme: direction === 1 ? candle.high : candle.low,
    swingLevel: null,
    pullbackExtreme: null,
    pullbackStartBar: null,
    box: null,
  };
}

export function calculateEngulfingZones(
  candles: CandleData[],
  settings: Pick<EngulfingZonesSettings, "lookbackBars" | "maxPullbackBars" | "maxActiveSetups">,
): EngulfingZonesResult {
  if (candles.length === 0) return { reference: null, lastOpp: null, setups: [] };

  const lookbackBars = Math.max(1, Math.floor(settings.lookbackBars));
  const maxPullbackBars = Math.max(1, Math.floor(settings.maxPullbackBars));
  const maxActiveSetups = Math.max(1, Math.floor(settings.maxActiveSetups));
  let reference = candleState(candles[0]!);
  let lastOpp: EngulfingCandleState | null = null;
  let setups: EngulfingSetup[] = [];

  for (let bar = 1; bar < candles.length; bar++) {
    const candle = candles[bar]!;
    const current = candleState(candle);

    if (current.direction === reference.direction) {
      const engulfsLastOpp =
        lastOpp !== null &&
        lastOpp.direction !== current.direction &&
        (current.direction === 1 ? candle.close > lastOpp.high : candle.close < lastOpp.low);
      if (engulfsLastOpp && lastOpp) {
        setups.push(
          createSetup(current.direction, lastOpp.high, lastOpp.low, candle, bar),
        );
        lastOpp = null;
      }
      reference = current;
    } else {
      const confirmsAgainstReference =
        (reference.direction === 1 && candle.close < reference.low) ||
        (reference.direction === -1 && candle.close > reference.high);
      if (confirmsAgainstReference) {
        setups.push(createSetup(current.direction, reference.high, reference.low, candle, bar));
        reference = current;
      } else {
        lastOpp = current;
      }
    }

    while (setups.length > maxActiveSetups) setups.shift();

    const retained: EngulfingSetup[] = [];
    for (const setup of setups) {
      if (bar - setup.confirmBar > lookbackBars) continue;

      if (bar !== setup.confirmBar) {
        const invalidated =
          (setup.direction === 1 && candle.low <= setup.zone1Bottom) ||
          (setup.direction === -1 && candle.high >= setup.zone1Top);
        if (invalidated) continue;

        if (setup.state === 0) {
          const overlapsZone1 =
            candle.low <= setup.zone1Top && candle.high >= setup.zone1Bottom;
          if (overlapsZone1) {
            setup.swingLevel = setup.extreme;
            setup.pullbackExtreme = setup.direction === 1 ? candle.low : candle.high;
            setup.pullbackStartBar = bar;
            setup.state = 1;
          } else if (bar - setup.confirmBar > maxPullbackBars) {
            continue;
          } else if (setup.direction === 1) {
            setup.extreme = Math.max(setup.extreme, candle.high);
          } else {
            setup.extreme = Math.min(setup.extreme, candle.low);
          }
        } else if (setup.state === 1) {
          setup.pullbackExtreme =
            setup.direction === 1
              ? Math.min(setup.pullbackExtreme!, candle.low)
              : Math.max(setup.pullbackExtreme!, candle.high);
          const crossedSwingLevel =
            setup.direction === 1
              ? candle.high >= setup.swingLevel!
              : candle.low <= setup.swingLevel!;
          if (crossedSwingLevel) {
            const zone2Top =
              setup.direction === 1
                ? Math.max(setup.pullbackExtreme, setup.zone1Bottom)
                : Math.max(setup.pullbackExtreme, setup.zone1Top);
            const zone2Bottom =
              setup.direction === 1
                ? Math.min(setup.pullbackExtreme, setup.zone1Bottom)
                : Math.min(setup.pullbackExtreme, setup.zone1Top);
            setup.box = {
              startBar: setup.pullbackStartBar!,
              endBar: bar,
              top: zone2Top,
              bottom: zone2Bottom,
            };
            setup.state = 2;
          }
        } else if (setup.box) {
          setup.box.endBar = bar;
        }
      }

      retained.push(setup);
    }
    setups = retained;
  }

  return { reference, lastOpp, setups };
}