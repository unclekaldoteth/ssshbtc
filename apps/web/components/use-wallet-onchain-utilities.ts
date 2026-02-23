import { useEffect, useState } from "react";

import { getErc20Balance, getVerifierAdapterState } from "../lib/onchain";
import type { ConnectedStarknetSession } from "../lib/starknet";

interface OnchainHealthState {
  loading: boolean;
  adapterMockMode: boolean | null;
  adapterVerifierAddress: string | null;
  error: string | null;
}

interface PoolLiquidityState {
  loading: boolean;
  amount: string | null;
  error: string | null;
  updatedAt: string | null;
}

interface UseWalletOnchainUtilitiesArgs {
  walletSession: ConnectedStarknetSession | null;
  verifierAdapterAddress: string | null;
  shieldedPoolAddress: string | null;
  defaultAsset: string;
  isHexAddressLike: (value: string) => boolean;
  setStatus: (message: string) => void;
}

export function useWalletOnchainUtilities({
  walletSession,
  verifierAdapterAddress,
  shieldedPoolAddress,
  defaultAsset,
  isHexAddressLike,
  setStatus,
}: UseWalletOnchainUtilitiesArgs) {
  const [onchainHealth, setOnchainHealth] = useState<OnchainHealthState>({
    loading: false,
    adapterMockMode: null,
    adapterVerifierAddress: null,
    error: null,
  });
  const [poolLiquidity, setPoolLiquidity] = useState<PoolLiquidityState>({
    loading: false,
    amount: null,
    error: null,
    updatedAt: null,
  });

  async function refreshOnchainHealth(): Promise<void> {
    if (!walletSession || !verifierAdapterAddress) {
      setOnchainHealth({
        loading: false,
        adapterMockMode: null,
        adapterVerifierAddress: null,
        error: null,
      });
      return;
    }

    try {
      setOnchainHealth((previous) => ({
        ...previous,
        loading: true,
        error: null,
      }));

      const adapterState = await getVerifierAdapterState(
        walletSession.wallet,
        verifierAdapterAddress
      );
      setOnchainHealth({
        loading: false,
        adapterMockMode: adapterState.mockMode,
        adapterVerifierAddress: adapterState.verifierAddress,
        error: null,
      });
    } catch (error) {
      setOnchainHealth({
        loading: false,
        adapterMockMode: null,
        adapterVerifierAddress: null,
        error: error instanceof Error ? error.message : "Unable to read verifier adapter",
      });
    }
  }

  async function refreshPoolLiquidity(options: { silent?: boolean } = {}): Promise<string | null> {
    if (!walletSession || !shieldedPoolAddress || !isHexAddressLike(defaultAsset)) {
      setPoolLiquidity({
        loading: false,
        amount: null,
        error: null,
        updatedAt: null,
      });
      if (!options.silent) {
        setStatus("Pool liquidity unavailable: connect wallet and configure Starknet asset.");
      }
      return null;
    }

    try {
      setPoolLiquidity((previous) => ({
        ...previous,
        loading: true,
        error: null,
      }));

      const amount = await getErc20Balance(walletSession.wallet, defaultAsset, shieldedPoolAddress);
      const updatedAt = new Date().toISOString();
      setPoolLiquidity({
        loading: false,
        amount,
        error: null,
        updatedAt,
      });
      if (!options.silent) {
        setStatus(`Pool liquidity refreshed: ${amount}`);
      }
      return amount;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setPoolLiquidity((previous) => ({
        loading: false,
        amount: previous.amount,
        error: message,
        updatedAt: previous.updatedAt,
      }));
      if (!options.silent) {
        setStatus(`Failed to read pool liquidity: ${message}`);
      }
      return null;
    }
  }

  useEffect(() => {
    void refreshOnchainHealth();
  }, [walletSession]);

  useEffect(() => {
    void refreshPoolLiquidity({ silent: true });
  }, [walletSession, defaultAsset]);

  return {
    onchainHealth,
    setOnchainHealth,
    refreshOnchainHealth,
    poolLiquidity,
    setPoolLiquidity,
    refreshPoolLiquidity,
  };
}

