/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly OANDA_API_KEY?: string;
  readonly OANDA_ACCOUNT_ID?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(element: HTMLElement, options: Record<string, string>): void;
  prompt(): void;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}
