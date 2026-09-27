import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCandles } from "../services/queries.ts";
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
