import {
  toField,
  type ProofBundle,
  type PublicInputsTransfer,
  type PublicInputsWithdraw,
} from "@sssh-btc/shared";

import type {
  InjectedStarknet,
  StarknetCall,
  StarknetExecutionResult,
} from "./starknet";

const FIELD_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001"
);
const U128_MASK = (1n << 128n) - 1n;
const PUBLIC_RPC_URL = (process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "").trim();
const USE_WALLET_WAIT_FALLBACK = (process.env.NEXT_PUBLIC_USE_WALLET_WAIT_FALLBACK ?? "0") === "1";
const COMMITMENT_INSERTED_EVENT_KEY =
  "0x25f90f27ecf51762f9c9b9a2a88b0d8e04ac33f94ba819ed2eba457a4dac774";
const ENTRYPOINT_SELECTORS: Record<string, string> = {
  get_root: "0x0398830bc6fe8846e977af33763b61eeac1ce5000d2da9d0e2d5ad5eaf33ae30",
  get_verifier: "0x02447995222389987e292a0aa1e3f6ebf3cea683f56017219c7d9662d3f57631",
  is_mock_mode: "0x0353c49f31729fd1ca9f6cad4435502a9d5741cfdfa094f3c7d8cdb5d2e7fc6a",
  balance_of: "0x035a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33",
};

function feltLength(length: number): string {
  return `0x${BigInt(length).toString(16)}`;
}

function normalizeFelt(value: string): string {
  return toField(value);
}

function normalizeHexId(value: string): string {
  try {
    return `0x${BigInt(value).toString(16)}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function feltToBool(value: string): boolean {
  return BigInt(normalizeFelt(value)) !== 0n;
}

function toU256(amount: string): [string, string] {
  let parsed: bigint;
  try {
    parsed = BigInt(amount);
  } catch {
    throw new Error("Invalid amount for u256 encoding");
  }

  if (parsed < 0n) {
    throw new Error("Amount must be non-negative");
  }

  const low = parsed & U128_MASK;
  const high = parsed >> 128n;
  return [`0x${low.toString(16)}`, `0x${high.toString(16)}`];
}

function u256ToDecimal(lowHex: string, highHex: string): string {
  const low = BigInt(lowHex);
  const high = BigInt(highHex);
  if (low < 0n || high < 0n) {
    throw new Error("u256 words must be non-negative");
  }

  return ((high << 128n) + low).toString();
}

function resultToU256Decimal(result: string[]): string {
  const low = result[0];
  const high = result[1] ?? "0x0";
  if (!low) {
    throw new Error("Missing u256 low word in call result");
  }

  return u256ToDecimal(low, high);
}

function modField(value: bigint): bigint {
  const next = value % FIELD_PRIME;
  return next >= 0n ? next : next + FIELD_PRIME;
}

function isWithdrawPublicInputs(
  inputs: PublicInputsTransfer | PublicInputsWithdraw
): inputs is PublicInputsWithdraw {
  return "recipient" in inputs;
}

function flattenFallbackPublicInputs(
  inputs: PublicInputsTransfer | PublicInputsWithdraw
): string[] {
  if (isWithdrawPublicInputs(inputs)) {
    return [
      inputs.root,
      inputs.asset,
      ...inputs.inputCommitments,
      ...inputs.inputNullifiers,
      inputs.recipient,
      inputs.amountCommitment,
      inputs.feeCommitment,
    ].map(normalizeFelt);
  }

  return [
    inputs.root,
    inputs.asset,
    ...inputs.inputCommitments,
    ...inputs.inputNullifiers,
    ...inputs.outputCommitments,
    inputs.feeCommitment,
  ].map(normalizeFelt);
}

function extractVerifierPublicInputs(
  proofBundle: ProofBundle<PublicInputsTransfer> | ProofBundle<PublicInputsWithdraw>
): string[] {
  if (proofBundle.publicSignals && proofBundle.publicSignals.length > 0) {
    return proofBundle.publicSignals.map(normalizeFelt);
  }

  return flattenFallbackPublicInputs(proofBundle.publicInputs);
}

function computeDigestHex(proof: string[], publicInputs: string[]): string {
  let digest = 0n;

  for (const item of proof) {
    digest = modField(digest + BigInt(normalizeFelt(item)));
  }
  for (const item of publicInputs) {
    digest = modField(digest + BigInt(normalizeFelt(item)));
  }

  return `0x${digest.toString(16)}`;
}

function normalizeCallResult(raw: string[] | { result?: string[] }): string[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (Array.isArray(raw.result)) {
    return raw.result;
  }

  throw new Error("Unexpected call_contract response shape");
}

function canUsePublicRpcFallback(call: StarknetCall): boolean {
  return Boolean(PUBLIC_RPC_URL && ENTRYPOINT_SELECTORS[call.entrypoint]);
}

async function callPublicRpc<TResult>(method: string, params: unknown[]): Promise<TResult> {
  if (!PUBLIC_RPC_URL) {
    throw new Error("Public RPC URL is not configured");
  }
  const response = await fetch(PUBLIC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Public RPC HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: TResult;
    error?: { message?: string };
  };

  if (payload.result !== undefined) {
    return payload.result;
  }

  throw new Error(payload.error?.message ?? `${method} RPC call failed`);
}

async function callContractViaPublicRpc(call: StarknetCall): Promise<string[]> {
  const selector = ENTRYPOINT_SELECTORS[call.entrypoint];
  if (!selector) {
    throw new Error("Public RPC fallback is not configured for this entrypoint");
  }

  return callPublicRpc<string[]>("starknet_call", [
    {
      contract_address: call.contractAddress,
      entry_point_selector: selector,
      calldata: call.calldata,
    },
    "latest",
  ]);
}

function extractTxHash(result: string | StarknetExecutionResult): string {
  if (typeof result === "string") {
    return result;
  }

  const txHash = result.transaction_hash ?? result.transactionHash;
  if (!txHash) {
    throw new Error("Wallet execute did not return transaction hash");
  }
  return txHash;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface TxReceiptStatus {
  finality_status?: string;
  execution_status?: string;
  status?: string;
}

function isReceiptAccepted(receipt: TxReceiptStatus): boolean {
  return (
    receipt.finality_status === "ACCEPTED_ON_L2" ||
    receipt.finality_status === "ACCEPTED_ON_L1" ||
    receipt.status === "ACCEPTED_ON_L2" ||
    receipt.status === "ACCEPTED_ON_L1"
  );
}

function isReceiptRejected(receipt: TxReceiptStatus): boolean {
  return (
    receipt.finality_status === "REJECTED" ||
    receipt.status === "REJECTED" ||
    receipt.execution_status === "REVERTED"
  );
}

async function waitForTransactionViaPublicRpc(txHash: string): Promise<void> {
  if (!PUBLIC_RPC_URL) {
    throw new Error("Public RPC URL is not configured");
  }

  const timeoutMs = 120_000;
  const pollIntervalMs = 1_500;
  const startedAt = Date.now();
  let lastMessage = "pending";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const receipt = await callPublicRpc<TxReceiptStatus>("starknet_getTransactionReceipt", [txHash]);
      if (isReceiptRejected(receipt)) {
        throw new Error(
          `Transaction reverted/rejected (finality=${receipt.finality_status ?? receipt.status ?? "unknown"}, execution=${receipt.execution_status ?? "unknown"})`
        );
      }

      if (isReceiptAccepted(receipt)) {
        return;
      }

      lastMessage = `finality=${receipt.finality_status ?? receipt.status ?? "pending"}, execution=${receipt.execution_status ?? "unknown"}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown receipt error";
      if (/reverted|rejected/i.test(message)) {
        throw error instanceof Error ? error : new Error(message);
      }
      // During propagation most RPCs return "not found". Keep polling.
      if (
        /not found|unknown transaction|transaction hash|txn hash|invalid transaction hash/i.test(
          message
        )
      ) {
        lastMessage = "pending: not found yet";
      } else {
        lastMessage = message;
      }
    }

    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for confirmation via public RPC (${lastMessage})`);
}

interface ExecutionLifecycleCallbacks {
  onSubmitted?: (txHash: string) => void;
  onConfirmed?: (txHash: string) => void;
}

async function executeCalls(
  wallet: InjectedStarknet,
  calls: StarknetCall[],
  lifecycle?: ExecutionLifecycleCallbacks
): Promise<string> {
  if (!wallet.account?.execute) {
    throw new Error("Connected wallet does not expose account.execute");
  }

  const result = await wallet.account.execute(calls);
  const txHash = extractTxHash(result);
  lifecycle?.onSubmitted?.(txHash);

  const waitErrors: string[] = [];
  let confirmed = false;

  // Prefer public RPC confirmation to avoid extension-specific wait/poll failures.
  if (PUBLIC_RPC_URL) {
    try {
      await waitForTransactionViaPublicRpc(txHash);
      confirmed = true;
    } catch (error) {
      waitErrors.push(
        `public RPC wait failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  // Wallet/provider fallback is opt-in when public RPC is configured.
  const shouldUseWalletWait = !PUBLIC_RPC_URL || USE_WALLET_WAIT_FALLBACK;
  if (!confirmed && shouldUseWalletWait && wallet.account.waitForTransaction) {
    try {
      await wallet.account.waitForTransaction(txHash);
      confirmed = true;
    } catch (error) {
      waitErrors.push(
        `wallet wait failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  if (!confirmed && shouldUseWalletWait && wallet.provider?.waitForTransaction) {
    try {
      await wallet.provider.waitForTransaction(txHash);
      confirmed = true;
    } catch (error) {
      waitErrors.push(
        `provider wait failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  if (!confirmed) {
    throw new Error(
      `Unable to confirm tx ${txHash}. ${waitErrors.length > 0 ? waitErrors.join(" | ") : "No wait strategy available."}`
    );
  }

  lifecycle?.onConfirmed?.(txHash);

  return txHash;
}

async function callContract(
  wallet: InjectedStarknet,
  call: StarknetCall
): Promise<string[]> {
  const errors: string[] = [];

  if (canUsePublicRpcFallback(call)) {
    try {
      const result = await callContractViaPublicRpc(call);
      return normalizeCallResult(result);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "public RPC call failed");
    }
  }

  // Prefer provider reads. Some wallet account wrappers throw on read calls while tx signing still works.
  if (wallet.provider?.callContract) {
    try {
      const result = await wallet.provider.callContract(call);
      return normalizeCallResult(result);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "provider.callContract failed");
    }
  }

  if (wallet.account?.callContract) {
    try {
      const result = await wallet.account.callContract(call);
      return normalizeCallResult(result);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "account.callContract failed");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Unable to read contract state via connected wallet: ${errors.join(" | ")}`);
  }

  throw new Error("Connected wallet does not expose callContract on provider or account");
}

interface RegisterDigestParams {
  wallet: InjectedStarknet;
  externalVerifierAddress: string;
  proof: string[];
  publicInputs: string[];
}

export async function registerProofDigest(
  params: RegisterDigestParams
): Promise<{ digestHex: string; txHash: string }> {
  const proof = params.proof.map(normalizeFelt);
  const publicInputs = params.publicInputs.map(normalizeFelt);
  const digestHex = computeDigestHex(proof, publicInputs);

  const txHash = await executeCalls(params.wallet, [
    {
      contractAddress: params.externalVerifierAddress,
      entrypoint: "register_digest",
      calldata: [digestHex],
    },
  ]);

  return {
    digestHex,
    txHash,
  };
}

interface SubmitDepositParams {
  wallet: InjectedStarknet;
  poolAddress: string;
  assetAddress: string;
  amount: string;
  commitment: string;
  encryptedNote: string;
}

export async function submitOnchainDeposit(
  params: SubmitDepositParams
): Promise<{ txHash: string }> {
  const [amountLow, amountHigh] = toU256(params.amount);

  const txHash = await executeCalls(params.wallet, [
    {
      contractAddress: params.assetAddress,
      entrypoint: "approve",
      calldata: [params.poolAddress, amountLow, amountHigh],
    },
    {
      contractAddress: params.poolAddress,
      entrypoint: "deposit",
      calldata: [
        params.assetAddress,
        amountLow,
        amountHigh,
        normalizeFelt(params.commitment),
        normalizeFelt(params.encryptedNote),
      ],
    },
  ]);

  return { txHash };
}

interface SubmitTransferParams {
  wallet: InjectedStarknet;
  poolAddress: string;
  feeAsset: string;
  feeAmountCommitment: string;
  proofBundle: ProofBundle<PublicInputsTransfer>;
  newCommitments: string[];
  newEncryptedNotes: string[];
  nullifiers: string[];
  merkleRoot: string;
  externalVerifierAddress?: string | null;
  registerDigest?: boolean;
  lifecycle?: ExecutionLifecycleCallbacks;
}

export async function submitOnchainTransfer(
  params: SubmitTransferParams
): Promise<{ txHash: string; digestHex?: string; digestTxHash?: string }> {
  const proof = params.proofBundle.proof.map(normalizeFelt);
  const publicInputs = extractVerifierPublicInputs(params.proofBundle);

  let digestHex: string | undefined;
  const calls: StarknetCall[] = [];
  if (params.registerDigest && params.externalVerifierAddress) {
    digestHex = computeDigestHex(proof, publicInputs);
    calls.push({
      contractAddress: params.externalVerifierAddress,
      entrypoint: "register_digest",
      calldata: [digestHex],
    });
  }

  calls.push({
    contractAddress: params.poolAddress,
    entrypoint: "transact",
    calldata: [
      feltLength(proof.length),
      ...proof,
      feltLength(publicInputs.length),
      ...publicInputs,
      feltLength(params.newCommitments.length),
      ...params.newCommitments.map(normalizeFelt),
      feltLength(params.newEncryptedNotes.length),
      ...params.newEncryptedNotes.map(normalizeFelt),
      feltLength(params.nullifiers.length),
      ...params.nullifiers.map(normalizeFelt),
      normalizeFelt(params.merkleRoot),
      params.feeAsset,
      normalizeFelt(params.feeAmountCommitment),
    ],
  });

  const txHash = await executeCalls(
    params.wallet,
    calls,
    params.lifecycle
  );

  return {
    txHash,
    ...(digestHex ? { digestHex } : {}),
    ...(digestHex ? { digestTxHash: txHash } : {}),
  };
}

interface SubmitWithdrawParams {
  wallet: InjectedStarknet;
  poolAddress: string;
  recipient: string;
  withdrawAmount: string;
  amountCommitment: string;
  assetAddress: string;
  proofBundle: ProofBundle<PublicInputsWithdraw>;
  nullifiers: string[];
  merkleRoot: string;
  externalVerifierAddress?: string | null;
  registerDigest?: boolean;
  lifecycle?: ExecutionLifecycleCallbacks;
}

export async function submitOnchainWithdraw(
  params: SubmitWithdrawParams
): Promise<{ txHash: string; digestHex?: string; digestTxHash?: string }> {
  const proof = params.proofBundle.proof.map(normalizeFelt);
  const publicInputs = extractVerifierPublicInputs(params.proofBundle);

  let digestHex: string | undefined;
  const [amountLow, amountHigh] = toU256(params.withdrawAmount);
  const calls: StarknetCall[] = [];
  if (params.registerDigest && params.externalVerifierAddress) {
    digestHex = computeDigestHex(proof, publicInputs);
    calls.push({
      contractAddress: params.externalVerifierAddress,
      entrypoint: "register_digest",
      calldata: [digestHex],
    });
  }

  calls.push({
    contractAddress: params.poolAddress,
    entrypoint: "withdraw",
    calldata: [
      feltLength(proof.length),
      ...proof,
      feltLength(publicInputs.length),
      ...publicInputs,
      feltLength(params.nullifiers.length),
      ...params.nullifiers.map(normalizeFelt),
      params.recipient,
      amountLow,
      amountHigh,
      normalizeFelt(params.amountCommitment),
      params.assetAddress,
      normalizeFelt(params.merkleRoot),
    ],
  });

  const txHash = await executeCalls(
    params.wallet,
    calls,
    params.lifecycle
  );

  return {
    txHash,
    ...(digestHex ? { digestHex } : {}),
    ...(digestHex ? { digestTxHash: txHash } : {}),
  };
}

export async function getShieldedPoolRoot(
  wallet: InjectedStarknet,
  poolAddress: string
): Promise<string> {
  const result = await callContract(wallet, {
    contractAddress: poolAddress,
    entrypoint: "get_root",
    calldata: [],
  });

  const root = result[0];
  if (!root) {
    throw new Error("Unable to read onchain root");
  }

  return normalizeFelt(root);
}

export async function getErc20Balance(
  wallet: InjectedStarknet,
  tokenAddress: string,
  holderAddress: string
): Promise<string> {
  const result = await callContract(wallet, {
    contractAddress: tokenAddress,
    entrypoint: "balance_of",
    calldata: [holderAddress],
  });

  return resultToU256Decimal(result);
}

export async function getVerifierAdapterState(
  wallet: InjectedStarknet,
  verifierAdapterAddress: string
): Promise<{ mockMode: boolean; verifierAddress: string }> {
  const [mockModeResult, verifierResult] = await Promise.all([
    callContract(wallet, {
      contractAddress: verifierAdapterAddress,
      entrypoint: "is_mock_mode",
      calldata: [],
    }),
    callContract(wallet, {
      contractAddress: verifierAdapterAddress,
      entrypoint: "get_verifier",
      calldata: [],
    }),
  ]);

  const mockModeRaw = mockModeResult[0];
  const verifierRaw = verifierResult[0];
  if (!mockModeRaw || !verifierRaw) {
    throw new Error("Unable to read verifier adapter state");
  }

  return {
    mockMode: feltToBool(mockModeRaw),
    verifierAddress: normalizeFelt(verifierRaw),
  };
}

interface TxReceiptEvent {
  from_address?: string;
  keys?: string[];
  data?: string[];
}

interface TxReceiptResponse {
  transaction_hash?: string;
  execution_status?: string;
  events?: TxReceiptEvent[];
}

export async function readDepositCommitmentFromTxReceipt(params: {
  txHash: string;
  poolAddress: string;
}): Promise<{ commitment: string; amount?: string; index?: string; root?: string }> {
  const receipt = await callPublicRpc<TxReceiptResponse>("starknet_getTransactionReceipt", [
    params.txHash,
  ]);

  if (receipt.execution_status === "REVERTED") {
    throw new Error("Transaction reverted; deposit commitment cannot be recovered.");
  }

  const poolAddress = normalizeHexId(params.poolAddress);
  const poolEvents = (receipt.events ?? []).filter((event) => {
    if (!event.from_address || !Array.isArray(event.data) || event.data.length === 0) {
      return false;
    }

    return normalizeHexId(event.from_address) === poolAddress;
  });

  if (poolEvents.length === 0) {
    throw new Error("No ShieldedPool events found in this transaction receipt.");
  }

  const depositEvent =
    poolEvents.find(
      (event) =>
        Array.isArray(event.keys) &&
        event.keys.length > 0 &&
        normalizeHexId(event.keys[0]) === COMMITMENT_INSERTED_EVENT_KEY
    ) ??
    poolEvents.find((event) => Array.isArray(event.data) && event.data.length >= 3) ??
    poolEvents[0];

  const commitmentRaw = depositEvent.data?.[0];
  if (!commitmentRaw) {
    throw new Error("Unable to parse commitment from ShieldedPool event.");
  }

  const indexRaw = depositEvent.data?.[1];
  const rootRaw = depositEvent.data?.[2];
  const transferToPoolEvent = (receipt.events ?? []).find((event) => {
    if (!Array.isArray(event.data) || event.data.length < 4) {
      return false;
    }

    return normalizeHexId(event.data[1]) === poolAddress;
  });

  let amount: string | undefined;
  if (transferToPoolEvent?.data && transferToPoolEvent.data.length >= 4) {
    try {
      amount = u256ToDecimal(transferToPoolEvent.data[2], transferToPoolEvent.data[3]);
    } catch {
      amount = undefined;
    }
  }

  return {
    commitment: normalizeFelt(commitmentRaw),
    ...(amount ? { amount } : {}),
    ...(indexRaw ? { index: normalizeFelt(indexRaw) } : {}),
    ...(rootRaw ? { root: normalizeFelt(rootRaw) } : {}),
  };
}
