export interface StarknetCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

export interface StarknetExecutionResult {
  transaction_hash?: string;
  transactionHash?: string;
}

export interface StarknetCallResult {
  result?: string[];
}

export interface InjectedStarknetAccount {
  address?: string;
  execute?: (
    calls: StarknetCall | StarknetCall[]
  ) => Promise<string | StarknetExecutionResult>;
  callContract?: (call: StarknetCall) => Promise<string[] | StarknetCallResult>;
  waitForTransaction?: (txHash: string) => Promise<unknown>;
}

export interface InjectedStarknetProvider {
  callContract?: (call: StarknetCall) => Promise<string[] | StarknetCallResult>;
  waitForTransaction?: (txHash: string) => Promise<unknown>;
}

export interface InjectedStarknet {
  isConnected?: boolean;
  selectedAddress?: string;
  enable?: (opts?: { showModal?: boolean }) => Promise<string[]>;
  account?: InjectedStarknetAccount;
  provider?: InjectedStarknetProvider;
}

export interface ConnectedStarknetSession {
  address: string;
  wallet: InjectedStarknet;
}

declare global {
  interface Window {
    starknet?: InjectedStarknet;
  }
}

export function getInjectedWallet(): InjectedStarknet | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.starknet ?? null;
}

export async function connectInjectedWallet(): Promise<ConnectedStarknetSession | null> {
  const provider = getInjectedWallet();
  if (!provider) {
    return null;
  }

  if (!provider?.enable) {
    return null;
  }

  const accounts = await provider.enable({ showModal: true });
  const address =
    accounts[0] ?? provider.selectedAddress ?? provider.account?.address ?? null;
  if (!address) {
    return null;
  }

  return {
    address,
    wallet: provider,
  };
}
