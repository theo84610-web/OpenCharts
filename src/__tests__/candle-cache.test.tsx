import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeCandlesIntoCache, useCandles } from "../services/queries.ts";
import { wsClient } from "../services/ws.ts";

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  wsClient.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("candle timeframe cache", () => {
  it("deduplicates reconnect candles and retains only the newest 5,000 bars", () => {
    const client = createClient();
    const originalCandles = Array.from({ length: 5_000 }, (_, index) => ({
      time: index,
      timestamp: index,
      open: index,
      high: index,
      low: index,
      close: index,
      volume: 1,
    }));
    client.setQueryData(["candles", "XAU_USD", "15s", 5_000, 0], {
      candles: originalCandles,
      metadata: { historicalCoverageStart: 0, isPartial: false, backfillQueued: false },
    });
    client.setQueryData(["candles", "XAU_USD", "15s", 5_000, 7], {
      candles: [originalCandles[0]!],
      metadata: { historicalCoverageStart: 0, isPartial: false, backfillQueued: false },
    });

    mergeCandlesIntoCache(
      client,
      "XAU_USD",
      "15s",
      [
        { ...originalCandles[4_999]!, close: 99 },
        {
          time: 5_000,
          timestamp: 5_000,
          open: 5_000,
          high: 5_000,
          low: 5_000,
          close: 5_000,
          volume: 1,
        },
      ],
      5_000,
      0,
    );

    const result = client.getQueryData<{ candles: typeof originalCandles }>([
      "candles",
      "XAU_USD",
      "15s",
      5_000,
      0,
    ])!;
    expect(result.candles).toHaveLength(5_000);
    expect(result.candles[0]?.time).toBe(1);
    expect(result.candles.at(-2)).toMatchObject({ time: 4_999, close: 99 });
    expect(result.candles.at(-1)?.time).toBe(5_000);
    expect(
      client.getQueryData<{ candles: typeof originalCandles }>([
        "candles",
        "XAU_USD",
        "15s",
        5_000,
        7,
      ])?.candles,
    ).toHaveLength(1);
    client.clear();
  });

  it("reuses recent candles across query clients for the same symbol and timeframe", async () => {
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

    const firstClient = createClient();
    const first = renderHook(() => useCandles("XAU_USD", "15s", 13, 0), {
      wrapper: createWrapper(firstClient),
    });
    await waitFor(() => expect(first.result.current.data).toHaveLength(1));
    first.unmount();
    firstClient.clear();

    const secondClient = createClient();
    const second = renderHook(() => useCandles("XAU_USD", "15s", 10, 0), {
      wrapper: createWrapper(secondClient),
    });
    expect(second.result.current.data).toEqual(first.result.current.data);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    second.unmount();
    secondClient.clear();
  });
});
