export type OandaErrorSource = "REST" | "STREAM";

export interface OandaDiagnosticSnapshot {
  restError: string | null;
  streamError: string | null;
}

let snapshot: OandaDiagnosticSnapshot = { restError: null, streamError: null };
const listeners = new Set<() => void>();

export const oandaDebugEnvironment = {
  apiKeyDefined: Boolean(import.meta.env.VITE_OANDA_API_KEY),
  accountIdDefined: Boolean(import.meta.env.VITE_OANDA_ACCOUNT_ID),
};

export function getOandaApiKey(): string | undefined {
  return import.meta.env.VITE_OANDA_API_KEY || import.meta.env.OANDA_API_KEY;
}

export function getOandaAccountId(): string | undefined {
  return import.meta.env.VITE_OANDA_ACCOUNT_ID || import.meta.env.OANDA_ACCOUNT_ID;
}

export function getOandaDiagnosticSnapshot(): OandaDiagnosticSnapshot {
  return snapshot;
}

export function subscribeToOandaDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportOandaError(source: OandaErrorSource, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  snapshot = {
    ...snapshot,
    [source === "REST" ? "restError" : "streamError"]: message,
  };
  listeners.forEach((listener) => listener());
}

export function clearOandaError(source: OandaErrorSource): void {
  const key = source === "REST" ? "restError" : "streamError";
  if (snapshot[key] === null) return;
  snapshot = { ...snapshot, [key]: null };
  listeners.forEach((listener) => listener());
}