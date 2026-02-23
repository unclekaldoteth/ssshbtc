"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  DepositCard,
  DiagnosticsCard,
  FlowGuideCard,
  PaymentRequestCard,
  PrivateTransferCard,
  RecentActivityCard,
  WalletNotesCard,
  WalletSessionCard,
  WithdrawCard,
} from "./wallet-feature-cards";
import {
  copyRequestHashAction,
  copyShareLinkAction,
  runCreateRequestAction,
  runLoadRequestAction,
  runRecoverDepositAction,
} from "./wallet-request-actions";
import { usePendingDepositSync } from "./use-pending-deposit-sync";
import {
  runDepositAction,
  runTransferAction,
  runWithdrawAction,
} from "./wallet-transaction-actions";
import {
  ACTIVITY_CATEGORY_LABEL,
  ACTIVITY_CATEGORY_ORDER,
  type ActivityCategory,
  useWalletActivity,
} from "./use-wallet-activity";
import { useWalletOnchainUtilities } from "./use-wallet-onchain-utilities";
import { useWalletFlowState } from "./use-wallet-flow-state";

import {
  randomHex,
  type ShieldedNote,
  type WalletStateSnapshot,
} from "@sssh-btc/shared";

import {
  getTreeRoot,
  getWalletSnapshot,
  getXverseContext,
} from "../lib/api";
import { HAS_LIVE_DEPLOYMENT_CONFIG, SSSH_BTC_CONTRACTS } from "../lib/contracts";
import {
  getVerifierAdapterState,
} from "../lib/onchain";
import { connectInjectedWallet, type ConnectedStarknetSession } from "../lib/starknet";

function short(value: string, size = 8): string {
  if (value.length <= size * 2) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return "n/a";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatUnixTimestampSeconds(value: number | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }

  return formatTimestamp(new Date(value * 1000).toISOString());
}

function isHexAddressLike(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

function normalizeAddress(value: string): string {
  try {
    return `0x${BigInt(value).toString(16)}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeWalletHint(value: string): string {
  const trimmed = value.trim();
  if (isHexAddressLike(trimmed)) {
    return normalizeAddress(trimmed);
  }

  return trimmed;
}

function sameAddress(left: string, right: string): boolean {
  return normalizeAddress(left) === normalizeAddress(right);
}

function sameWalletHint(left: string, right: string): boolean {
  return normalizeWalletHint(left) === normalizeWalletHint(right);
}

function extractRequestHashInput(value: string): string {
  const decodeMaybe = (raw: string): string => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const request = parsed.searchParams.get("request");
    if (request) {
      const normalized = decodeMaybe(request).trim();
      if (normalized) {
        return normalized;
      }
    }
  } catch {
    // Ignore URL parsing errors and continue with fallback extraction.
  }

  const queryMatch = trimmed.match(/[?&]request=([^&#\s]+)/i);
  if (queryMatch?.[1]) {
    const normalized = decodeMaybe(queryMatch[1]).trim();
    if (normalized) {
      return normalized;
    }
  }

  return trimmed;
}

function sortBigIntStringsAscending(values: string[]): string[] {
  return [...values].sort((left, right) => {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
    return 0;
  });
}

function computeWithdrawExactAmounts(notes: ShieldedNote[], fee: bigint): string[] {
  const amounts = new Set<string>();
  for (const note of notes) {
    const noteValue = BigInt(note.amount);
    if (noteValue > fee) {
      amounts.add((noteValue - fee).toString());
    }
  }
  return sortBigIntStringsAscending([...amounts]);
}

function filterAmountsByMaxLiquidity(amounts: string[], maxLiquidity: bigint): string[] {
  return amounts.filter((amount) => {
    try {
      return BigInt(amount) <= maxLiquidity;
    } catch {
      return false;
    }
  });
}

interface TransferFormState {
  recipientHint: string;
  amount: string;
  fee: string;
  requestHash: string;
}

type TransferProgressStage =
  | "idle"
  | "validating"
  | "proving"
  | "verifying"
  | "preparing-onchain"
  | "awaiting-signature"
  | "tx-submitted"
  | "syncing-local"
  | "completed"
  | "failed";

interface TransferProgressState {
  stage: TransferProgressStage;
  percent: number;
  message: string;
  txHash: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

const INITIAL_TRANSFER_PROGRESS: TransferProgressState = {
  stage: "idle",
  percent: 0,
  message: "No transfer in progress.",
  txHash: null,
  startedAt: null,
  updatedAt: null,
};

type WithdrawProgressStage = TransferProgressStage;

interface WithdrawProgressState {
  stage: WithdrawProgressStage;
  percent: number;
  message: string;
  txHash: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

const INITIAL_WITHDRAW_PROGRESS: WithdrawProgressState = {
  stage: "idle",
  percent: 0,
  message: "No withdrawal in progress.",
  txHash: null,
  startedAt: null,
  updatedAt: null,
};

const ACTION_ACTIVITY_CATEGORY_HINT: Record<string, ActivityCategory> = {
  connect: "onchain",
  "refresh-onchain-health": "onchain",
  "refresh-liquidity": "onchain",
  "refresh-snapshot": "local-sync",
  "sync-pending-notes": "local-sync",
  deposit: "local-sync",
  "recover-deposit": "local-sync",
  "create-request": "requests",
  "load-request": "requests",
  transfer: "local-sync",
  withdraw: "local-sync",
};

type ActionKey =
  | "connect"
  | "refresh-snapshot"
  | "refresh-onchain-health"
  | "refresh-liquidity"
  | "sync-pending-notes"
  | "deposit"
  | "recover-deposit"
  | "create-request"
  | "transfer"
  | "withdraw"
  | "load-request";

export function WalletApp() {
  const [walletHint, setWalletHint] = useState("demo-alice");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletSession, setWalletSession] = useState<ConnectedStarknetSession | null>(null);
  const [senderSecret] = useState(() => randomHex(24));
  const pendingActionRef = useRef<ActionKey | null>(null);
  const {
    status,
    setStatus,
    setStatusTracked,
    activityFeed,
    activityFilter,
    setActivityFilter,
    beginActivityAction,
    finishActivityAction,
  } = useWalletActivity<ActionKey>({
    actionCategoryHint: ACTION_ACTIVITY_CATEGORY_HINT,
  });
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);

  const [depositAmount, setDepositAmount] = useState("100000");
  const [recoveryTxHash, setRecoveryTxHash] = useState("");
  const [recoveryAmount, setRecoveryAmount] = useState("100000");
  const [transferProgress, setTransferProgress] = useState<TransferProgressState>(
    INITIAL_TRANSFER_PROGRESS
  );
  const [withdrawProgress, setWithdrawProgress] = useState<WithdrawProgressState>(
    INITIAL_WITHDRAW_PROGRESS
  );
  const [transfer, setTransfer] = useState<TransferFormState>({
    recipientHint: "demo-bob",
    amount: "25000",
    fee: "100",
    requestHash: "",
  });
  const [withdrawAmount, setWithdrawAmount] = useState("10000");
  const [withdrawFee, setWithdrawFee] = useState("100");

  const [requestAmount, setRequestAmount] = useState("20000");
  const [requestMemo, setRequestMemo] = useState("Private merchandise invoice");
  const [requestShareHash, setRequestShareHash] = useState("");
  const [requestShareUrl, setRequestShareUrl] = useState("");
  const [shareLinkCopyState, setShareLinkCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const [shareHashCopyState, setShareHashCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );

  const [xverseAddress, setXverseAddress] = useState("");
  const trimmedWalletHint = walletHint.trim();
  const trimmedXverseAddress = xverseAddress.trim();
  const isBusy = pendingAction !== null;
  const defaultAsset = SSSH_BTC_CONTRACTS.defaultAsset;
  const {
    onchainHealth,
    setOnchainHealth,
    refreshOnchainHealth,
    poolLiquidity,
    setPoolLiquidity,
    refreshPoolLiquidity,
  } = useWalletOnchainUtilities({
    walletSession,
    verifierAdapterAddress: SSSH_BTC_CONTRACTS.verifierAdapterAddress,
    shieldedPoolAddress: SSSH_BTC_CONTRACTS.shieldedPoolAddress,
    defaultAsset,
    isHexAddressLike,
    setStatus,
  });
  const onchainReady = Boolean(walletSession && SSSH_BTC_CONTRACTS.shieldedPoolAddress);
  const onchainSubmissionEnabled = onchainReady && isHexAddressLike(defaultAsset);
  const executionMode = !walletSession
    ? "demo"
    : onchainSubmissionEnabled
      ? "onchain"
      : "indexer";
  const executionModeLabel =
    executionMode === "onchain"
      ? "Onchain-enabled"
      : executionMode === "indexer"
        ? "Indexer-only"
        : "Demo-only";
  const executionModeTone =
    executionMode === "onchain" ? "ok" : executionMode === "indexer" ? "warn" : "demo";
  const executionModeDescription =
    executionMode === "onchain"
      ? "Wallet + Starknet pool config detected. Deposits/transfers/withdrawals can submit Starknet txs, then sync private notes locally."
      : executionMode === "indexer"
        ? "Wallet is connected, but onchain execution is not fully configured (for example missing pool/default asset address). Actions run through local prover + indexer flow."
        : "No Starknet wallet connected. Deposits mint demo notes locally and private actions run in local demo mode.";
  const depositIdleLabel = onchainSubmissionEnabled ? "Deposit Onchain" : "Mint Demo Note";
  const depositPendingLabel = onchainSubmissionEnabled
    ? "Submitting Onchain Deposit..."
    : "Minting Demo Note...";
  const transferIdleLabel = onchainReady
    ? "Submit Private Transfer"
    : "Apply Private Transfer (Local)";
  const transferPendingLabel = onchainReady
    ? "Submitting Private Transfer..."
    : "Applying Private Transfer...";
  const withdrawIdleLabel = onchainReady
    ? "Submit Private Withdraw"
    : "Apply Private Withdraw (Local)";
  const withdrawPendingLabel = onchainReady
    ? "Submitting Private Withdraw..."
    : "Applying Private Withdraw...";
  const expectedVerifierAdmin = SSSH_BTC_CONTRACTS.testVectorAdminAddress;
  const walletIsExpectedVerifierAdmin =
    walletAddress && expectedVerifierAdmin
      ? sameAddress(walletAddress, expectedVerifierAdmin)
      : null;
  const digestRegistrationRequired =
    SSSH_BTC_CONTRACTS.registerTestVectorDigests && onchainHealth.adapterMockMode === false;
  const adapterVerifierMismatch =
    Boolean(onchainHealth.adapterVerifierAddress) &&
    Boolean(SSSH_BTC_CONTRACTS.externalVerifierAddress) &&
    !sameAddress(
      onchainHealth.adapterVerifierAddress!,
      SSSH_BTC_CONTRACTS.externalVerifierAddress!
    );
  const digestRegistrationCapable =
    !SSSH_BTC_CONTRACTS.registerTestVectorDigests ||
    (onchainHealth.adapterMockMode !== null &&
      (!digestRegistrationRequired ||
        (Boolean(SSSH_BTC_CONTRACTS.externalVerifierAddress) &&
          Boolean(expectedVerifierAdmin) &&
          walletIsExpectedVerifierAdmin === true &&
          !adapterVerifierMismatch &&
          !onchainHealth.error)));

  const deploymentEntries = useMemo(
    () => [
      {
        label: "ShieldedPool",
        address: SSSH_BTC_CONTRACTS.shieldedPoolAddress,
      },
      {
        label: "VerifierAdapter",
        address: SSSH_BTC_CONTRACTS.verifierAdapterAddress,
      },
      {
        label: "PaymentRequestRegistry",
        address: SSSH_BTC_CONTRACTS.paymentRequestRegistryAddress,
      },
      {
        label: "ExternalVerifier",
        address: SSSH_BTC_CONTRACTS.externalVerifierAddress,
      },
    ],
    []
  );

  const {
    data: rootData,
    error: rootError,
    mutate: mutateRoot,
  } = useSWR("tree-root", getTreeRoot, {
    refreshInterval: 5000,
  });

  const {
    data: snapshot,
    error: snapshotError,
    mutate: mutateSnapshot,
  } = useSWR<WalletStateSnapshot>(
    trimmedWalletHint ? `snapshot-${trimmedWalletHint}` : null,
    () => getWalletSnapshot(trimmedWalletHint),
    {
      refreshInterval: 5000,
    }
  );

  const {
    data: xverseData,
    error: xverseError,
    isLoading: xverseLoading,
  } = useSWR(
    trimmedXverseAddress.length > 3 ? `xverse-${trimmedXverseAddress}` : null,
    () => getXverseContext(trimmedXverseAddress),
    { revalidateOnFocus: false }
  );

  const {
    pendingDepositSyncCount,
    refreshPendingDepositCount,
    syncPendingDepositNotes,
    upsertPendingDepositSync,
    removePendingDepositSync,
  } = usePendingDepositSync({
    walletHint,
    trimmedWalletHint,
    snapshot,
    mutateRoot,
    mutateSnapshot,
    normalizeWalletHint,
    sameWalletHint,
    setStatus,
  });

  const {
    availableNotes,
    pendingRequests,
    spendable,
    flowSteps,
    completedFlowSteps,
    nextFlowHint,
    activityCounts,
    visibleActivityGroups,
    activeActivityCount,
    withdrawCandidateNotes,
    withdrawFeePreview,
    withdrawValidAmounts,
    poolLiquidityValue,
    withdrawEffectiveValidAmounts,
    withdrawMinAmount,
    withdrawMaxAmount,
    withdrawValidAmountsPreview,
    withdrawValidAmountsRemaining,
    withdrawExactMatchOnlyPreview,
    withdrawExactMatchFilteredByLiquidity,
    withdrawPoolLiquidityExceeded,
    setTransferRecipientHint,
    setTransferAmount,
    setTransferFee,
    setTransferRequestHash,
    normalizeTransferRequestHash,
    fillTransferFormFromRequest,
  } = useWalletFlowState({
    snapshot,
    trimmedWalletHint,
    requestShareHash,
    transfer,
    transferProgress,
    withdrawProgress,
    withdrawAmount,
    withdrawFee,
    poolLiquidity,
    onchainReady,
    activityFeed,
    activityFilter,
    activityCategoryOrder: ACTIVITY_CATEGORY_ORDER,
    isHexAddressLike,
    extractRequestHashInput,
    computeWithdrawExactAmounts,
    filterAmountsByMaxLiquidity,
    setTransfer,
    setStatusTracked,
    short,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestHash = params.get("request");
    const recipientHint = params.get("to");

    if (!requestHash) {
      return;
    }

    setTransfer((prev) => ({
      ...prev,
      requestHash,
      recipientHint: recipientHint ?? prev.recipientHint,
    }));
  }, []);

  function markTransferProgress(
    stage: TransferProgressStage,
    percent: number,
    message: string,
    txHash?: string
  ): void {
    const now = new Date().toISOString();
    setTransferProgress((previous) => ({
      stage,
      percent,
      message,
      txHash: txHash ?? previous.txHash,
      startedAt: previous.startedAt ?? now,
      updatedAt: now,
    }));
  }

  function resetTransferProgress(): void {
    setTransferProgress(INITIAL_TRANSFER_PROGRESS);
  }

  function setTransferProgressFailed(message: string): void {
    setTransferProgress((previous) => ({
      ...previous,
      stage: "failed",
      message,
      updatedAt: new Date().toISOString(),
    }));
  }

  function markWithdrawProgress(
    stage: WithdrawProgressStage,
    percent: number,
    message: string,
    txHash?: string
  ): void {
    const now = new Date().toISOString();
    setWithdrawProgress((previous) => ({
      stage,
      percent,
      message,
      txHash: txHash ?? previous.txHash,
      startedAt: previous.startedAt ?? now,
      updatedAt: now,
    }));
  }

  function resetWithdrawProgress(): void {
    setWithdrawProgress(INITIAL_WITHDRAW_PROGRESS);
  }

  function setWithdrawProgressFailed(message: string): void {
    setWithdrawProgress((previous) => ({
      ...previous,
      stage: "failed",
      message,
      updatedAt: new Date().toISOString(),
    }));
  }

  async function runAction(action: ActionKey, operation: () => Promise<void>): Promise<void> {
    if (pendingActionRef.current) {
      setStatus(
        `Another action is still running (${pendingActionRef.current}). If stuck, click "Reset Busy State".`
      );
      return;
    }

    pendingActionRef.current = action;
    beginActivityAction(action);
    setPendingAction(action);

    try {
      await operation();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operation failed.");
    } finally {
      finishActivityAction(action);
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }

  function resetBusyState(): void {
    pendingActionRef.current = null;
    setPendingAction(null);
    setStatusTracked("Busy state reset. You can retry Sync/Recover now.", {
      category: "local-sync",
    });
  }

  async function ensureDigestRegistrationPreconditions(
    operationLabel: "transfer" | "withdraw"
  ): Promise<boolean> {
    if (!SSSH_BTC_CONTRACTS.registerTestVectorDigests) {
      return false;
    }

    if (!walletSession || !SSSH_BTC_CONTRACTS.verifierAdapterAddress) {
      return false;
    }

    const adapterState = await getVerifierAdapterState(
      walletSession.wallet,
      SSSH_BTC_CONTRACTS.verifierAdapterAddress
    );
    setOnchainHealth({
      loading: false,
      adapterMockMode: adapterState.mockMode,
      adapterVerifierAddress: adapterState.verifierAddress,
      error: null,
    });

    if (adapterState.mockMode) {
      return false;
    }

    if (!SSSH_BTC_CONTRACTS.externalVerifierAddress) {
      throw new Error(
        `Cannot submit ${operationLabel}: NEXT_PUBLIC_EXTERNAL_VERIFIER_ADDRESS is not configured.`
      );
    }

    if (!sameAddress(adapterState.verifierAddress, SSSH_BTC_CONTRACTS.externalVerifierAddress)) {
      throw new Error(
        `Cannot submit ${operationLabel}: VerifierAdapter points to ${adapterState.verifierAddress} but env expects ${SSSH_BTC_CONTRACTS.externalVerifierAddress}.`
      );
    }

    if (!expectedVerifierAdmin) {
      throw new Error(
        `Cannot submit ${operationLabel}: NEXT_PUBLIC_TEST_VECTOR_ADMIN_ADDRESS is required for digest registration.`
      );
    }

    if (!walletAddress || !sameAddress(walletAddress, expectedVerifierAdmin)) {
      throw new Error(
        `Cannot submit ${operationLabel}: connected wallet is not TestVectorVerifier admin.`
      );
    }

    return true;
  }

  async function connectWallet() {
    try {
      setStatus("Connecting Starknet wallet...");
      const session = await connectInjectedWallet();
      if (!session) {
        setStatus("No wallet extension detected. Running in demo mode.");
        return;
      }

      setWalletSession(session);
      setWalletAddress(session.address);
      setWalletHint(normalizeWalletHint(session.address));
      setStatus(`Connected wallet ${short(session.address)}`);
    } catch (error) {
      setStatus(
        `Wallet connection failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  async function handleDemoDeposit() {
    await runDepositAction({
      walletHint,
      setWalletHint,
      depositAmount,
      setDepositAmount,
      onchainReady,
      walletSession,
      defaultAsset,
      isHexAddressLike,
      normalizeWalletHint,
      setStatus,
      setStatusTracked,
      short,
      mutateRoot,
      mutateSnapshot,
      refreshPoolLiquidity,
      refreshPendingDepositCount,
      upsertPendingDepositSync,
      removePendingDepositSync,
    });
  }

  async function handleRecoverDeposit(): Promise<void> {
    await runRecoverDepositAction({
      walletHint,
      setWalletHint,
      recoveryTxHash,
      setRecoveryTxHash,
      recoveryAmount,
      setRecoveryAmount,
      snapshot,
      defaultAsset,
      normalizeWalletHint,
      setStatus,
      setStatusTracked,
      short,
      mutateRoot,
      mutateSnapshot,
    });
  }

  async function handlePrivateTransfer() {
    const startedAt = new Date().toISOString();
    setTransferProgress({
      stage: "validating",
      percent: 8,
      message: "Validating transfer inputs...",
      txHash: null,
      startedAt,
      updatedAt: startedAt,
    });

    await runTransferAction({
      spendable,
      walletHint,
      setWalletHint,
      transfer,
      setTransfer,
      onchainReady,
      walletSession,
      senderSecret,
      rootData,
      isHexAddressLike,
      normalizeWalletHint,
      extractRequestHashInput,
      setStatus,
      setStatusTracked,
      short,
      markTransferProgress,
      setTransferProgressFailed,
      mutateRoot,
      mutateSnapshot,
      ensureDigestRegistrationPreconditions,
    });
  }

  async function handleWithdraw() {
    await runWithdrawAction({
      spendable,
      withdrawCandidateNotes,
      poolLiquidityValue,
      walletHint,
      setWalletHint,
      withdrawAmount,
      setWithdrawAmount,
      withdrawFee,
      setWithdrawFee,
      onchainReady,
      walletSession,
      walletAddress,
      senderSecret,
      rootData,
      normalizeWalletHint,
      computeWithdrawExactAmounts,
      filterAmountsByMaxLiquidity,
      setStatus,
      setStatusTracked,
      short,
      markWithdrawProgress,
      setWithdrawProgressFailed,
      setPoolLiquidity,
      mutateRoot,
      mutateSnapshot,
      refreshPoolLiquidity,
      ensureDigestRegistrationPreconditions,
    });
  }

  async function handleCreateRequest() {
    await runCreateRequestAction({
      walletHint,
      setWalletHint,
      requestAmount,
      setRequestAmount,
      requestMemo,
      setRequestMemo,
      defaultAsset,
      setRequestShareHash,
      setRequestShareUrl,
      setShareLinkCopyState,
      setShareHashCopyState,
      setTransfer,
      mutateSnapshot,
      normalizeWalletHint,
      setStatus,
      short,
    });
  }

  async function handleLoadRequest(hash: string) {
    await runLoadRequestAction({
      hash,
      transferRequestHash: transfer.requestHash,
      setTransfer,
      extractRequestHashInput,
      setStatus,
      short,
    });
  }

  async function handleCopyRequestHash(): Promise<void> {
    await copyRequestHashAction({
      requestShareHash,
      setShareHashCopyState,
      setStatusTracked,
    });
  }

  async function handleCopyShareLink(): Promise<void> {
    await copyShareLinkAction({
      requestShareUrl,
      setShareLinkCopyState,
      setStatusTracked,
    });
  }

  return (
    <div className="grid" aria-busy={isBusy}>
      <WalletSessionCard
        walletHint={walletHint}
        onWalletHintChange={(value) => setWalletHint(value)}
        isBusy={isBusy}
        pendingAction={pendingAction}
        onConnect={() => void runAction("connect", connectWallet)}
        onRefreshSnapshot={() =>
          void runAction("refresh-snapshot", async () => {
            await mutateSnapshot();
            setStatus("Snapshot refreshed.");
          })
        }
        onSyncPendingNotes={() => void runAction("sync-pending-notes", () => syncPendingDepositNotes())}
        onRefreshOnchainHealth={() =>
          void runAction("refresh-onchain-health", async () => {
            await refreshOnchainHealth();
            setStatus("Onchain health refreshed.");
          })
        }
        onResetBusyState={resetBusyState}
        walletAddress={walletAddress}
        walletAddressShort={walletAddress ? short(walletAddress, 6) : null}
        status={status}
        hasLiveDeploymentConfig={HAS_LIVE_DEPLOYMENT_CONFIG}
        onchainSubmissionEnabled={onchainSubmissionEnabled}
        pendingDepositSyncCount={pendingDepositSyncCount}
        executionModeLabel={executionModeLabel}
        executionModeTone={executionModeTone}
        executionModeDescription={executionModeDescription}
      />

      <FlowGuideCard
        completedFlowSteps={completedFlowSteps}
        totalFlowSteps={flowSteps.length}
        nextFlowHint={nextFlowHint}
        flowSteps={flowSteps}
      />

      <RecentActivityCard
        activityFeed={activityFeed}
        activityFilter={activityFilter}
        onActivityFilterChange={(value) => setActivityFilter(value)}
        activityCategoryOrder={ACTIVITY_CATEGORY_ORDER}
        activityCategoryLabel={ACTIVITY_CATEGORY_LABEL}
        activityCounts={activityCounts}
        activeActivityCount={activeActivityCount}
        visibleActivityGroups={visibleActivityGroups}
        nextFlowHint={nextFlowHint}
        formatTimestamp={formatTimestamp}
      />

      <DepositCard
        onchainSubmissionEnabled={onchainSubmissionEnabled}
        depositAmount={depositAmount}
        onDepositAmountChange={(value) => setDepositAmount(value)}
        isBusy={isBusy}
        pendingAction={pendingAction}
        depositPendingLabel={depositPendingLabel}
        depositIdleLabel={depositIdleLabel}
        onSubmitDeposit={() => void runAction("deposit", handleDemoDeposit)}
        recoveryTxHash={recoveryTxHash}
        onRecoveryTxHashChange={(value) => setRecoveryTxHash(value)}
        recoveryAmount={recoveryAmount}
        onRecoveryAmountChange={(value) => setRecoveryAmount(value)}
        onRecoverDeposit={() => void runAction("recover-deposit", handleRecoverDeposit)}
      />

      <PaymentRequestCard
        requestAmount={requestAmount}
        onRequestAmountChange={(value) => setRequestAmount(value)}
        requestMemo={requestMemo}
        onRequestMemoChange={(value) => setRequestMemo(value)}
        isBusy={isBusy}
        pendingAction={pendingAction}
        onCreateRequest={() => void runAction("create-request", handleCreateRequest)}
        requestShareHash={requestShareHash}
        requestShareUrl={requestShareUrl}
        shareHashCopyState={shareHashCopyState}
        shareLinkCopyState={shareLinkCopyState}
        onCopyRequestHash={() => void handleCopyRequestHash()}
        onCopyShareLink={() => void handleCopyShareLink()}
        pendingRequests={pendingRequests}
        trimmedWalletHint={trimmedWalletHint}
        short={short}
        formatUnixTimestampSeconds={formatUnixTimestampSeconds}
        onFillTransferFormFromRequest={fillTransferFormFromRequest}
        onLoadRequestStatus={(requestHash) =>
          void runAction("load-request", () => handleLoadRequest(requestHash))
        }
      />

      <PrivateTransferCard
        spendableCount={spendable.length}
        isBusy={isBusy}
        depositIdleLabel={depositIdleLabel}
        onStartDeposit={() => void runAction("deposit", handleDemoDeposit)}
        transfer={transfer}
        onRecipientHintChange={setTransferRecipientHint}
        onTransferAmountChange={setTransferAmount}
        onTransferFeeChange={setTransferFee}
        onTransferRequestHashChange={setTransferRequestHash}
        onNormalizeTransferRequestHash={normalizeTransferRequestHash}
        onLoadAttachedRequestStatus={() =>
          void runAction("load-request", () => handleLoadRequest(transfer.requestHash))
        }
        pendingAction={pendingAction}
        transferPendingLabel={transferPendingLabel}
        transferIdleLabel={transferIdleLabel}
        onSubmitTransfer={() => void runAction("transfer", handlePrivateTransfer)}
        transferProgress={transferProgress}
        onClearTransferProgress={resetTransferProgress}
      />

      <WithdrawCard
        withdrawAmount={withdrawAmount}
        onWithdrawAmountChange={(value) => setWithdrawAmount(value)}
        withdrawFee={withdrawFee}
        onWithdrawFeeChange={(value) => setWithdrawFee(value)}
        poolLiquidity={poolLiquidity}
        withdrawPoolLiquidityExceeded={withdrawPoolLiquidityExceeded}
        withdrawFeePreview={withdrawFeePreview}
        withdrawCandidateNotesCount={withdrawCandidateNotes.length}
        withdrawEffectiveValidAmountsCount={withdrawEffectiveValidAmounts.length}
        withdrawMinAmount={withdrawMinAmount}
        withdrawMaxAmount={withdrawMaxAmount}
        withdrawValidAmountsPreview={withdrawValidAmountsPreview}
        withdrawValidAmountsRemaining={withdrawValidAmountsRemaining}
        withdrawExactMatchFilteredByLiquidity={withdrawExactMatchFilteredByLiquidity}
        withdrawExactMatchOnlyPreview={withdrawExactMatchOnlyPreview}
        withdrawValidAmountsCount={withdrawValidAmounts.length}
        isBusy={isBusy}
        pendingAction={pendingAction}
        onRefreshPoolLiquidity={() =>
          void runAction("refresh-liquidity", async () => {
            await refreshPoolLiquidity();
          })
        }
        onSubmitWithdraw={() => void runAction("withdraw", handleWithdraw)}
        withdrawPendingLabel={withdrawPendingLabel}
        withdrawIdleLabel={withdrawIdleLabel}
        withdrawProgress={withdrawProgress}
        onClearWithdrawProgress={resetWithdrawProgress}
      />

      <WalletNotesCard
        snapshotError={snapshotError}
        availableNotes={availableNotes}
        nextFlowHint={nextFlowHint}
        pendingDepositSyncCount={pendingDepositSyncCount}
        onchainSubmissionEnabled={onchainSubmissionEnabled}
        isBusy={isBusy}
        pendingAction={pendingAction}
        depositPendingLabel={depositPendingLabel}
        depositIdleLabel={depositIdleLabel}
        onSubmitDeposit={() => void runAction("deposit", handleDemoDeposit)}
        onSyncPendingNotes={() => void runAction("sync-pending-notes", () => syncPendingDepositNotes())}
        short={short}
        formatTimestamp={formatTimestamp}
      />

      <DiagnosticsCard
        rootData={rootData}
        rootError={rootError}
        onchainHealth={onchainHealth}
        digestRegistrationCapable={digestRegistrationCapable}
        expectedVerifierAdmin={expectedVerifierAdmin}
        walletIsExpectedVerifierAdmin={walletIsExpectedVerifierAdmin}
        adapterVerifierMismatch={adapterVerifierMismatch}
        network={SSSH_BTC_CONTRACTS.network}
        defaultAsset={defaultAsset}
        registerTestVectorDigests={SSSH_BTC_CONTRACTS.registerTestVectorDigests}
        deploymentEntries={deploymentEntries}
        xverseAddress={xverseAddress}
        onXverseAddressChange={(value) => setXverseAddress(value)}
        xverseLoading={xverseLoading}
        xverseError={xverseError}
        xverseData={xverseData}
      />
    </div>
  );
}
