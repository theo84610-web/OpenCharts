/**
 * API facade for the browser terminal. OANDA supplies market data; the local
 * paper-trading engine continues to provide demo account and trading methods.
 */
import { demoApi } from "./demo/api.ts";
import { DEMO_SYMBOLS } from "./demo/instruments.ts";
import type { Symbol } from "./schemas.ts";
import type { MarketDataCandle } from "./api/market-data.ts";
import { TIMEFRAMES, type Timeframe } from "../pages/trading/constants.ts";

export const API_BASE = "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const OANDA_BASE_URL = "https://api-fxpractice.oanda.com";
const OANDA_GRANULARITY: Record<Timeframe, string> = {
  "15s": "S15",
  "30s": "S30",
  "1m": "M1",
  "2m": "M2",
  "3m": "M3",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1h": "H1",
  "4h": "H4",
  "1d": "D",
  "1w": "W",
};

type CandleRange = { fromMs: number; toMs: number };
type OandaCandle = {
  time: string;
  volume: number;
  mid?: { o: string; h: string; l: string; c: string };
};

async function oandaGet<T>(url: string): Promise<T> {
  const apiKey = import.meta.env.OANDA_API_KEY;
  if (!apiKey) throw new ApiError("OANDA_API_KEY is not configured");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) {
    let message = response.statusText || "OANDA request failed";
    try {
      const body = (await response.json()) as { errorMessage?: string };
      message = body.errorMessage || message;
    } catch {
      // Keep the HTTP status text when OANDA returns a non-JSON error body.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

function assertInstrument(symbol: string): void {
  if (symbol !== "XAU_USD") throw new ApiError(`Unsupported instrument: ${symbol}`);
}

export async function getCandles(
  symbol: string,
  timeframe: string,
  limit?: number,
  range?: CandleRange,
): Promise<MarketDataCandle[]> {
  assertInstrument(symbol);
  if (!TIMEFRAMES.includes(timeframe as Timeframe)) {
    throw new ApiError(`Unsupported timeframe: ${timeframe}`);
  }

  const params = new URLSearchParams({
    granularity: OANDA_GRANULARITY[timeframe as Timeframe],
    dailyAlignment: "18",
    alignmentTimezone: "America/New_York",
    price: "M",
  });
  if (range) {
    params.set("from", new Date(range.fromMs).toISOString());
    params.set("to", new Date(range.toMs).toISOString());
  } else {
    params.set("count", String(Math.min(Math.max(Math.floor(limit ?? 500), 1), 5000)));
  }

  const response = await oandaGet<{ candles?: OandaCandle[] }>(
    `${OANDA_BASE_URL}/v3/instruments/XAU_USD/candles?${params}`,
  );
  return (response.candles ?? []).flatMap((candle) => {
    if (!candle.mid) return [];
    return [{
      time: Math.floor(Date.parse(candle.time) / 1000),
      timestamp: candle.time,
      open: Number(candle.mid.o),
      high: Number(candle.mid.h),
      low: Number(candle.mid.l),
      close: Number(candle.mid.c),
      volume: candle.volume,
    }];
  });
}

async function getCandlesWithMeta(symbol: string, timeframe: string, limit?: number) {
  const candles = await getCandles(symbol, timeframe, limit);
  return {
    candles,
    metadata: {
      historicalCoverageStart: candles[0]?.time ?? null,
      isPartial: false,
      backfillQueued: false,
    },
  };
}

async function getTick(symbol: string) {
  assertInstrument(symbol);
  const accountId = import.meta.env.OANDA_ACCOUNT_ID;
  if (!accountId) throw new ApiError("OANDA_ACCOUNT_ID is not configured");
  const url = `${OANDA_BASE_URL}/v3/accounts/${encodeURIComponent(accountId)}/pricing?instruments=XAU_USD`;
  const response = await oandaGet<{
    prices?: Array<{
      instrument: string;
      time: string;
      bids?: Array<{ price: string }>;
      asks?: Array<{ price: string }>;
      closeoutBid?: string;
      closeoutAsk?: string;
    }>;
  }>(url);
  const price = response.prices?.[0];
  if (!price) throw new ApiError("OANDA returned no price for XAU_USD");
  return {
    symbol,
    bid: Number(price.bids?.[0]?.price ?? price.closeoutBid),
    ask: Number(price.asks?.[0]?.price ?? price.closeoutAsk),
    timestamp: price.time,
  };
}

const marketDataApi = {
  getSymbols: (): Promise<Symbol[]> => Promise.resolve(DEMO_SYMBOLS),
  getCandles,
  getCandlesWithMeta,
  getTick,
};

export const api = new Proxy(demoApi as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in marketDataApi) return marketDataApi[prop as keyof typeof marketDataApi];
    if (prop in target) return target[prop];
    return () => Promise.resolve(null);
  },
}) as typeof demoApi & typeof marketDataApi & Record<string, (...args: never[]) => Promise<unknown>>;