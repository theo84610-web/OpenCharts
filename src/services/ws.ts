/** OANDA pricing stream client plus the local paper-trading event bus. */
import { mark } from "./demo/engine.ts";
import { publish, subscribeChannel, type ChannelHandler } from "./demo/bus.ts";

export type ConnectionState = "connected" | "connecting" | "reconnecting" | "disconnected";
export type WsHandler = ChannelHandler;

type OandaPriceMessage = {
  type?: string;
  instrument?: string;
  time?: string;
  bids?: Array<{ price: string }>;
  asks?: Array<{ price: string }>;
};

const OANDA_STREAM_URL = "https://stream-fxpractice.oanda.com";

function waitToReconnect(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, 1_000);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function publishPriceLine(line: string): void {
  let message: OandaPriceMessage;
  try {
    message = JSON.parse(line) as OandaPriceMessage;
  } catch {
    return;
  }
  if (message.type !== "PRICE" || message.instrument !== "XAU_USD") return;

  const bid = Number(message.bids?.[0]?.price);
  const ask = Number(message.asks?.[0]?.price);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;

  const midpoint = (bid + ask) / 2;
  publish("market-data", {
    eventType: "MarketTick",
    symbol: "XAU_USD",
    bid,
    ask,
    occurredAt: message.time ?? Date.now(),
  });
  mark("XAU_USD", midpoint);
}

async function readPricingStream(response: Response, signal: AbortSignal): Promise<void> {
  if (!response.body) throw new Error("OANDA pricing stream has no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) publishPriceLine(line);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) publishPriceLine(pending);
  } finally {
    reader.releaseLock();
  }
}

class OandaWsClient {
  private _state: ConnectionState = "disconnected";
  private stateListeners = new Set<(s: ConnectionState) => void>();

  get state(): ConnectionState {
    return this._state;
  }

  private setState(next: ConnectionState): void {
    this._state = next;
    for (const cb of this.stateListeners) cb(next);
  }

  private controller: AbortController | null = null;

  connect(_token?: string): void {
    this.controller?.abort();
    const apiKey = import.meta.env.OANDA_API_KEY;
    const accountId = import.meta.env.OANDA_ACCOUNT_ID;
    if (!apiKey || !accountId) {
      this.controller = null;
      this.setState("disconnected");
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    this.setState("connecting");
    void this.consumePricingStream(apiKey, accountId, controller.signal);
  }

  disconnect(): void {
    this.controller?.abort();
    this.controller = null;
    this.setState("disconnected");
  }

  reauthenticate(_token: string): void {
    // OANDA credentials are supplied through the configured environment.
  }

  subscribe(channel: string, handler: WsHandler): () => void {
    return subscribeChannel(channel, handler);
  }

  subscribeAccounts(_accountIds: string[]): void {
    // All account events already flow through the "account" channel.
  }

  setSymbolInterest(_symbols: string[]): void {
    // The OANDA stream is intentionally fixed to the single supported instrument.
  }

  onStateChange(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this._state);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /** Allow the engine/feed to push events through the same client (parity helper). */
  emit(channel: string, event: unknown): void {
    publish(channel, event);
  }

  private async consumePricingStream(
    apiKey: string,
    accountId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const url = `${OANDA_STREAM_URL}/v3/accounts/${encodeURIComponent(accountId)}/pricing/stream?instruments=XAU_USD`;
    while (!signal.aborted) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/octet-stream" },
          signal,
        });
        if (!response.ok) throw new Error(`OANDA stream failed with HTTP ${response.status}`);
        this.setState("connected");
        await readPricingStream(response, signal);
      } catch {
        if (signal.aborted) break;
        this.setState("reconnecting");
      }
      if (!signal.aborted) {
        this.setState("reconnecting");
        await waitToReconnect(signal);
      }
    }
    if (this.controller?.signal === signal) {
      this.controller = null;
      this.setState("disconnected");
    }
  }
}

export const wsClient = new OandaWsClient();
