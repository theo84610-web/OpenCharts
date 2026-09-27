import type { Symbol } from "../schemas.ts";

/** The single OANDA practice instrument used by the terminal. */
export const DEMO_SYMBOLS: Symbol[] = [
  {
    id: "XAU_USD",
    name: "XAU_USD",
    displayName: "Gold / USD",
    category: "COMMODITIES",
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    marginPercent: 1,
    maxLeverage: 100,
    commission: 0,
    swapLong: 0,
    swapShort: 0,
    tradingHoursStart: null,
    tradingHoursEnd: null,
    isActive: true,
  },
];

export const DEMO_SYMBOL_NAMES = DEMO_SYMBOLS.map((s) => s.name);

export function getDemoSymbol(name: string): Symbol | undefined {
  return DEMO_SYMBOLS.find((s) => s.name === name);
}
