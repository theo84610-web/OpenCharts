import type { CandleData } from "./indicators.ts";

export type SwingPivotType = "high" | "low";

export interface SwingPivot {
  time: number;
  value: number;
  type: SwingPivotType;
}

export interface SwingStructureResult {
  pivots: SwingPivot[];
  forming: SwingPivot | null;
}

export interface SwingStructureSettings {
  lookbackBars: number;
  lineColor: string;
  lineWidth: number;
  showLabels: boolean;
  showFormingLeg: boolean;
  highLabelColor: string;
  lowLabelColor: string;
}

export function calculateSwingStructure(
  candles: CandleData[],
  lookbackBars = 500,
): SwingStructureResult {
  if (candles.length === 0) return { pivots: [], forming: null };

  const maxLookback = Math.max(1, Math.floor(lookbackBars));
  const first = candles[0]!;
  let referenceHigh = first.high;
  let referenceLow = first.low;
  const indexedPivots: Array<{ pivot: SwingPivot; index: number }> = [];

  const pushPivot = (candle: CandleData, type: SwingPivotType, index: number) => {
    const value = type === "high" ? candle.high : candle.low;
    const latest = indexedPivots[indexedPivots.length - 1];
    if (latest?.pivot.type === type) {
      const moreExtreme = type === "high" ? value > latest.pivot.value : value < latest.pivot.value;
      if (moreExtreme) {
        latest.pivot = { time: candle.time, value, type };
        latest.index = index;
      }
      return;
    }
    indexedPivots.push({ pivot: { time: candle.time, value, type }, index });
  };

  for (let index = 1; index < candles.length; index++) {
    const candle = candles[index]!;
    const breaksHigh = candle.high > referenceHigh;
    const breaksLow = candle.low < referenceLow;
    if (breaksHigh || breaksLow) {
      if (breaksHigh && breaksLow) {
        if (candle.close > candle.open) {
          pushPivot(candle, "low", index);
          pushPivot(candle, "high", index);
        } else {
          pushPivot(candle, "high", index);
          pushPivot(candle, "low", index);
        }
      } else {
        pushPivot(candle, breaksHigh ? "high" : "low", index);
      }

      referenceHigh = candle.high;
      referenceLow = candle.low;
    }

    while (indexedPivots.length > 0 && index - indexedPivots[0]!.index > maxLookback) {
      indexedPivots.shift();
    }
  }

  const pivots = indexedPivots.map(({ pivot }) => pivot);
  const lastPivot = pivots[pivots.length - 1];
  const latestCandle = candles[candles.length - 1]!;
  const forming: SwingPivot | null = lastPivot
    ? {
        time: latestCandle.time,
        value: lastPivot.type === "high" ? latestCandle.low : latestCandle.high,
        type: lastPivot.type === "high" ? "low" : "high",
      }
    : null;

  return { pivots, forming };
}