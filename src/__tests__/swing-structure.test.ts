import { describe, expect, it } from "vitest";
import { calculateSwingStructure } from "../lib/swing-structure.ts";
import type { CandleData } from "../lib/indicators.ts";

function candle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): CandleData {
  return { time, open, high, low, close };
}

describe("calculateSwingStructure", () => {
  it("ignores inside candles and records a single-side break", () => {
    const result = calculateSwingStructure([
      candle(1, 8, 10, 5, 8),
      candle(2, 7, 9, 6, 8),
      candle(3, 9, 11, 6, 10),
    ]);

    expect(result.pivots).toEqual([{ time: 3, value: 11, type: "high" }]);
    expect(result.forming).toEqual({ time: 3, value: 6, type: "low" });
  });

  it("extends a same-type pivot only when price makes a more extreme value", () => {
    const result = calculateSwingStructure([
      candle(1, 8, 10, 5, 8),
      candle(2, 9, 11, 6, 10),
      candle(3, 10, 10.5, 7, 10),
      candle(4, 10, 12, 7, 11),
    ]);

    expect(result.pivots).toEqual([{ time: 4, value: 12, type: "high" }]);
  });

  it("orders outside-bar pivots by candle direction", () => {
    const bullish = calculateSwingStructure([
      candle(1, 8, 10, 5, 8),
      candle(2, 7, 11, 4, 9),
    ]);
    const bearish = calculateSwingStructure([
      candle(1, 8, 10, 5, 8),
      candle(2, 9, 11, 4, 8),
    ]);

    expect(bullish.pivots.map(({ type }) => type)).toEqual(["low", "high"]);
    expect(bearish.pivots.map(({ type }) => type)).toEqual(["high", "low"]);
  });

  it("drops pivots older than the configured lookback", () => {
    const result = calculateSwingStructure(
      [
        candle(1, 8, 10, 5, 8),
        candle(2, 9, 11, 6, 10),
        candle(3, 7, 10, 5, 6),
        candle(4, 7, 10, 5, 8),
      ],
      1,
    );

    expect(result.pivots).toEqual([{ time: 3, value: 5, type: "low" }]);
  });
});