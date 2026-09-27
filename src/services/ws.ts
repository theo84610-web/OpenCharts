/** OANDA pricing stream client plus the local paper-trading event bus. */
import { mark } from "./demo/engine.ts";
import { publish, subscribeChannel, type ChannelHandler } from "./demo/bus.ts";
import { getOandaAccountId, getOandaApiKey } from "./oanda-config.ts";

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

function publishPriceLine(line: string): boolean {
  let message: OandaPriceMessage;
  try {
    message = JSON.parse(line) as OandaPriceMessage;
  } catch {
    return false;
  }
  if (message.type !== "PRICE" || message.instrument !== "XAU_USD") return false;

  const bid = Number(message.bids?.[0]?.price);
  const ask = Number(message.asks?.[0]?.price);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return false;

  const midpoint = (bid + ask) / 2;
  publish("market-data", {
    eventType: "MarketTick",
    symbol: "XAU_USD",
    bid,
    ask,
    occurredAt: message.time ?? Date.now(),
  });
  mark("XAU_USD", midpoint);
  return true;
}

async function readPricingStream(
  response: Response,
  signal: AbortSignal,
  onTick: () => void,
  onActivity: () => void,
): Promise<void> {
  if (!response.body) throw new Error("OANDA pricing stream has no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let timedOut = false;
  try {
    while (!signal.aborted) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const nextChunk = reader.read();
      const result = await Promise.race([
        nextChunk,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(new Error("OANDA pricing stream timed out"));
          }, 30_000);
        }),
      ]).finally(() => clearTimeout(timeout));
      const { done, value } = result;
      if (done) break;
      onActivity();
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() && publishPriceLine(line)) onTick();
      }
    }
    pending += decoder.decode();
    if (pending.trim() && publishPriceLine(pending)) onTick();
    if (!signal.aborted) throw new Error("OANDA pricing stream closed unexpectedly");
  } finally {
    if (timedOut || signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

class OandaWsClient {
  private _state: ConnectionState = "disconnected";
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private reconnectListeners = new Set<() => Promise<void> | void>();
  private replayMode = false;
  private streamEstablished = false;
  private lastStreamActivityAt = 0;
  private attemptController: AbortController | null = null;
  private retryWake: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private immediateRetry = false;
  private visibilityHandler: (() => void) | null = null;
  private streamInterested = true;
  private sessionRequested = false;

  get state(): ConnectionState {
    return this._state;
  }

  private setState(next: ConnectionState): void {
    this._state = next;
    for (const cb of this.stateListeners) cb(next);
  }

  private controller: AbortController | null = null;

  connect(_token?: string): void {
    this.stopSession();
    this.sessionRequested = true;
    this.streamEstablished = false;
    this.lastStreamActivityAt = 0;
    if (!this.streamInterested) {
      this.setState("disconnected");
      return;
    }
    const apiKey = getOandaApiKey();
    const accountId = getOandaAccountId();
    if (!apiKey || !accountId) {
      this.controller = null;
      this.setState("disconnected");
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    this.setState("connecting");
    this.visibilityHandler = () => {
      if (document.visibilityState !== "visible" || this.replayMode || !this.controller) return;
      const streamIsStale =
        this.state !== "connected" || Date.now() - this.lastStreamActivityAt > 30_000;
      if (streamIsStale) {
        this.immediateRetry = true;
        this.attemptController?.abort();
        this.retryWake?.();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
    void this.consumePricingStream(apiKey, accountId, controller.signal);
  }

  disconnect(): void {
    this.sessionRequested = false;
    this.stopSession();
    this.setState("disconnected");
  }

  setReplayMode(isReplaying: boolean): void {
    this.replayMode = isReplaying;
    if (isReplaying && this.state !== "connected") this.attemptController?.abort();
    if (!isReplaying) this.immediateRetry = true;
    this.retryWake?.();
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

  setSymbolInterest(symbols: string[]): void {
    this.streamInterested = symbols.includes("XAU_USD");
    if (!this.streamInterested) {
      this.stopSession();
      this.setState("disconnected");
    } else if (this.sessionRequested && !this.controller) {
      this.connect();
    }
  }

  onStateChange(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this._state);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  onReconnect(cb: () => Promise<void> | void): () => void {
    this.reconnectListeners.add(cb);
    return () => this.reconnectListeners.delete(cb);
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
    let retryDelay = 1_000;
    let hasAttempted = false;
    while (!signal.aborted) {
      if (this.replayMode) {
        this.setState("disconnected");
        await this.waitForRetry(signal, null);
        continue;
      }
      const attempt = new AbortController();
      this.attemptController = attempt;
      const abortAttempt = () => attempt.abort();
      signal.addEventListener("abort", abortAttempt, { once: true });
      this.setState(hasAttempted ? "reconnecting" : "connecting");
      hasAttempted = true;
      try {
        const connectTimeout = setTimeout(() => attempt.abort(), 15_000);
        let response: Response;
        try {
          response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/octet-stream" },
            signal: attempt.signal,
          });
        } finally {
          clearTimeout(connectTimeout);
        }
        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${body ? `: ${body}` : ""}`,
          );
        }
        this.lastStreamActivityAt = Date.now();
        const isReconnect = this.streamEstablished;
        this.streamEstablished = true;
        if (isReconnect) {
          await Promise.all([...this.reconnectListeners].map((listener) => listener()));
        }
        await readPricingStream(response, attempt.signal, () => {
          this.lastStreamActivityAt = Date.now();
          retryDelay = 1_000;
          this.setState("connected");
        }, () => {
          this.lastStreamActivityAt = Date.now();
        });
      } catch (error) {
        if (!signal.aborted) {
          attempt.abort();
        }
      }
      signal.removeEventListener("abort", abortAttempt);
      if (this.attemptController === attempt) this.attemptController = null;
      if (signal.aborted) break;
      if (attempt.signal.aborted && this.replayMode) continue;
      if (!signal.aborted && !this.replayMode && this.streamInterested) {
        this.setState("disconnected");
        const delay = this.immediateRetry ? 0 : retryDelay;
        this.immediateRetry = false;
        await this.waitForRetry(signal, delay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
      if (!this.streamInterested) break;
    }
    if (this.controller?.signal === signal) {
      this.controller = null;
      this.cleanupVisibilityHandler();
      this.setState("disconnected");
    }
  }

  private waitForRetry(signal: AbortSignal, delay: number | null): Promise<void> {
    if (this.immediateRetry) {
      this.immediateRetry = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = () => {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.retryWake = null;
        this.immediateRetry = false;
        signal.removeEventListener("abort", finish);
        resolve();
      };
      this.retryWake = finish;
      if (delay != null) this.retryTimer = setTimeout(finish, delay);
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  private stopSession(): void {
    this.controller?.abort();
    this.attemptController?.abort();
    this.controller = null;
    this.attemptController = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryWake?.();
    this.immediateRetry = false;
    this.cleanupVisibilityHandler();
  }

  private cleanupVisibilityHandler(): void {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}

export const wsClient = new OandaWsClient();
