import { describe, expect, it } from "vitest";
import { calculateEngulfingZones } from "../lib/engulfing-zones.ts";
import type { CandleData } from "../lib/indicators.ts";

const settings = { lookbackBars: 1000, maxPullbackBars: 15, maxActiveSetups: 40 };

function candle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): CandleData {
  return { time, open, high, low, close };
}

describe("calculateEngulfingZones", () => {
  it("creates a setup when continuation engulfs the last opposite candle", () => {
    const result = calculateEngulfingZones(
      [
        candle(1, 8, 10, 5, 9),
        candle(2, 8, 9, 6, 7),
        candle(3, 8, 11, 6, 10),
      ],
      settings,
    );

    expect(result.setups).toMatchObject([
      {
        direction: 1,
        zone1Top: 9,
        zone1Bottom: 6,
        state: 0,
        confirmBar: 2,
        extreme: 11,
        swingLevel: null,
        pullbackExtreme: null,
        pullbackStartBar: null,
        box: null,
      },
    ]);
    expect(result.lastOpp).toBeNull();
  });

  it("confirms an opposite-direction engulf against candle A immediately", () => {
    const result = calculateEngulfingZones(
      [candle(1, 8, 10, 5, 9), candle(2, 6, 9, 4, 4)],
      settings,
    );

    expect(result.setups).toMatchObject([
      { direction: -1, zone1Top: 10, zone1Bottom: 5, confirmBar: 1, extreme: 4 },
    ]);
    expect(result.reference).toEqual({ high: 9, low: 4, direction: -1 });
  });

  it("tracks pullback, confirms the swing cross, and extends the zone", () => {
    const result = calculateEngulfingZones(
      [
        candle(1, 8, 10, 5, 9),
        candle(2, 8, 9, 6, 7),
        candle(3, 8, 11, 6, 10),
        candle(4, 9, 10, 8, 9),
        candle(5, 9, 11, 7, 10),
        candle(6, 9, 12, 7, 11),
      ],
      settings,
    );

    expect(result.setups).toMatchObject([
      {
        state: 2,
        swingLevel: 11,
        pullbackExtreme: 7,
        pullbackStartBar: 3,
        box: { startBar: 3, endBar: 5, top: 7, bottom: 6 },
      },
    ]);
  });

  it("invalidates setups at zone1 and expires setups after maxPullbackBars", () => {
    const invalidated = calculateEngulfingZones(
      [candle(1, 8, 10, 5, 9), candle(2, 8, 9, 6, 7), candle(3, 8, 11, 6, 10), candle(4, 8, 9, 5, 7)],
      settings,
    );
    const expired = calculateEngulfingZones(
      [
        candle(1, 8, 10, 5, 9),
        candle(2, 8, 9, 6, 7),
        candle(3, 8, 11, 6, 10),
        candle(4, 10, 12, 10, 11),
        candle(5, 11, 13, 11, 12),
        candle(6, 12, 14, 12, 13),
      ],
      { ...settings, maxPullbackBars: 2 },
    );

    expect(invalidated.setups).toHaveLength(0);
    expect(expired.setups).toHaveLength(0);
  });

  it("drops the oldest setup when the active limit is exceeded", () => {
    const result = calculateEngulfingZones(
      [
        candle(1, 8, 10, 5, 9),
        candle(2, 6, 9, 4, 4),
        candle(3, 5, 10, 5, 9),
        candle(4, 6, 11, 6, 10),
      ],
      { ...settings, maxActiveSetups: 1 },
    );

    expect(result.setups).toHaveLength(1);
    expect(result.setups[0]).toMatchObject({ direction: 1, confirmBar: 3 });
  });

  it("keeps lastOpp when a continuation candle does not close through it", () => {
    const result = calculateEngulfingZones(
      [
        candle(1, 8, 10, 5, 9),
        candle(2, 8, 9, 6, 7),
        candle(3, 7, 9, 6, 9),
      ],
      settings,
    );

    expect(result.setups).toHaveLength(0);
    expect(result.lastOpp).toEqual({ high: 9, low: 6, direction: -1 });
    expect(result.reference).toEqual({ high: 9, low: 6, direction: 1 });
  });

  it("mirrors pullback and swing-cross bounds for bearish setups", () => {
    const result = calculateEngulfingZones(
      [
        candle(1, 9, 10, 5, 6),
        candle(2, 6, 9, 6, 8),
        candle(3, 7, 8, 4, 5),
        candle(4, 8, 8, 7, 7),
        candle(5, 8, 8, 4, 4),
      ],
      settings,
    );

    expect(result.setups).toMatchObject([
      {
        direction: -1,
        state: 2,
        swingLevel: 4,
        pullbackExtreme: 8,
        pullbackStartBar: 3,
        box: { startBar: 3, endBar: 4, top: 9, bottom: 8 },
      },
    ]);
  });

  it("stops tracking setups older than the configured lookback", () => {
    const result = calculateEngulfingZones(
      [
        candle(1, 8, 10, 5, 9),
        candle(2, 8, 9, 6, 7),
        candle(3, 8, 11, 6, 10),
        candle(4, 10, 12, 10, 11),
        candle(5, 11, 13, 11, 12),
      ],
      { ...settings, lookbackBars: 1 },
    );

    expect(result.setups).toHaveLength(0);
  });
});