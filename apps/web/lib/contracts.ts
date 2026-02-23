import { DEFAULT_ASSET_SYMBOL } from "@sssh-btc/shared";

export interface SsshBtcContractsConfig {
  network: string;
  defaultAsset: string;
  shieldedPoolAddress: string | null;
  verifierAdapterAddress: string | null;
  paymentRequestRegistryAddress: string | null;
  externalVerifierAddress: string | null;
  testVectorAdminAddress: string | null;
  registerTestVectorDigests: boolean;
}

function envString(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function envAddress(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  return fallback;
}

export const SSSH_BTC_CONTRACTS: Readonly<SsshBtcContractsConfig> = Object.freeze({
  network: envString(process.env.NEXT_PUBLIC_STARKNET_NETWORK, "SN_SEPOLIA"),
  defaultAsset: envString(process.env.NEXT_PUBLIC_DEFAULT_ASSET, DEFAULT_ASSET_SYMBOL),
  shieldedPoolAddress: envAddress(process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS),
  verifierAdapterAddress: envAddress(process.env.NEXT_PUBLIC_VERIFIER_ADAPTER_ADDRESS),
  paymentRequestRegistryAddress: envAddress(
    process.env.NEXT_PUBLIC_PAYMENT_REQUEST_REGISTRY_ADDRESS
  ),
  externalVerifierAddress: envAddress(process.env.NEXT_PUBLIC_EXTERNAL_VERIFIER_ADDRESS),
  testVectorAdminAddress: envAddress(process.env.NEXT_PUBLIC_TEST_VECTOR_ADMIN_ADDRESS),
  registerTestVectorDigests: envBoolean(
    process.env.NEXT_PUBLIC_REGISTER_TEST_VECTOR_DIGESTS,
    true
  ),
});

export const HAS_LIVE_DEPLOYMENT_CONFIG = Boolean(
  SSSH_BTC_CONTRACTS.shieldedPoolAddress &&
    SSSH_BTC_CONTRACTS.verifierAdapterAddress &&
    SSSH_BTC_CONTRACTS.paymentRequestRegistryAddress
);
