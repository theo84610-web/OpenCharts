import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api.ts";
import { wsClient } from "../services/ws.ts";

afterEach(() => {
  wsClient.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OANDA market data", () => {
  it("exposes only XAU_USD as an active instrument", async () => {
    await expect(api.getSymbols()).resolves.toMatchObject([
      { id: "XAU_USD", name: "XAU_USD", displayName: "Gold / USD", tickSize: 0.01 },
    ]);
  });

  it("maps 15-second candles and parses midpoint values", async () => {
    vi.stubEnv("OANDA_API_KEY", "practice-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candles: [
            {
              time: "2026-09-26T12:00:00.000000000Z",
              volume: 17,
              mid: { o: "2650.10", h: "2651.20", l: "2649.80", c: "2650.90" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.getCandlesWithMeta("XAU_USD", "15s", 10);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v3/instruments/XAU_USD/candles?");
    expect(String(url)).toContain("granularity=S15");
    expect(String(url)).toContain("count=10");
    expect(String(url)).toContain("price=M");
    expect(options).toMatchObject({ headers: { Authorization: "Bearer practice-key" } });
    expect(result.candles[0]).toMatchObject({
      time: Date.parse("2026-09-26T12:00:00.000Z") / 1000,
      open: 2650.1,
      high: 2651.2,
      low: 2649.8,
      close: 2650.9,
      volume: 17,
    });
  });

  it("publishes streamed OANDA prices as market ticks", async () => {
    vi.stubEnv("OANDA_API_KEY", "practice-key");
    vi.stubEnv("OANDA_ACCOUNT_ID", "practice-account");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({
              type: "PRICE",
              instrument: "XAU_USD",
              time: "2026-09-26T12:00:00Z",
              bids: [{ price: "2650.10" }],
              asks: [{ price: "2650.30" }],
            })}\n`,
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const events: unknown[] = [];
    const unsubscribe = wsClient.subscribe("market-data", (event) => events.push(event));

    wsClient.connect();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    unsubscribe();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://stream-fxpractice.oanda.com/v3/accounts/practice-account/pricing/stream?instruments=XAU_USD",
    );
    expect(events[0]).toMatchObject({
      eventType: "MarketTick",
      symbol: "XAU_USD",
      bid: 2650.1,
      ask: 2650.3,
      occurredAt: "2026-09-26T12:00:00Z",
    });
  });
});