export function getOandaApiKey(): string | undefined {
  return import.meta.env.VITE_OANDA_API_KEY || import.meta.env.OANDA_API_KEY;
}

export function getOandaAccountId(): string | undefined {
  return import.meta.env.VITE_OANDA_ACCOUNT_ID || import.meta.env.OANDA_ACCOUNT_ID;
}