import {
  deriveCommitment,
  hashToField,
  randomHex,
  type NoteCiphertext,
  type ShieldedNote,
} from "@sssh-btc/shared";

import {
  createMintedNote,
  createTransferProof,
  createWithdrawProof,
  executePrivateTransfer,
  executePrivateWithdraw,
  ingestCommitmentTyped,
  verifyProofBundle,
} from "../lib/api";
import { SSSH_BTC_CONTRACTS } from "../lib/contracts";
import {
  getErc20Balance,
  getShieldedPoolRoot,
  submitOnchainDeposit,
  submitOnchainTransfer,
  submitOnchainWithdraw,
} from "../lib/onchain";
import type { ConnectedStarknetSession } from "../lib/starknet";
import { parseAmountInput, parseRequiredText } from "../lib/wallet-validation";

type ActivityToneLike = "neutral" | "ok" | "warn" | "bad";
type ActivityCategoryLike = "onchain" | "proof" | "local-sync" | "requests";

interface StatusMetaLike {
  category?: ActivityCategoryLike;
  tone?: ActivityToneLike;
}

interface PendingDepositSyncLike {
  id: string;
  walletHint: string;
  commitment: string;
  note: {
    ownerHint: string;
    asset: string;
    amount: string;
    blinding: string;
  };
  ciphertext: NoteCiphertext;
  txHash?: string;
  createdAt: string;
}

interface RootDataLike {
  root: string;
}

interface TransferFormLike {
  recipientHint: string;
  amount: string;
  fee: string;
  requestHash: string;
}

interface PoolLiquidityStateLike {
  loading: boolean;
  amount: string | null;
  error: string | null;
  updatedAt: string | null;
}

type SetTransferFormLike = (
  updater: (previous: TransferFormLike) => TransferFormLike
) => void;

type SetPoolLiquidityLike = (value: PoolLiquidityStateLike) => void;
type MutateFn = () => Promise<unknown>;
type SetStatusFn = (message: string) => void;
type SetStatusTrackedFn = (message: string, meta?: StatusMetaLike) => void;
type ShortFn = (value: string, size?: number) => string;
type NormalizeWalletHintFn = (value: string) => string;
type IsHexAddressLikeFn = (value: string) => boolean;
type ExtractRequestHashInputFn = (value: string) => string;
type RefreshPoolLiquidityFn = (options?: { silent?: boolean }) => Promise<string | null>;
type RefreshPendingDepositCountFn = (currentWalletHint: string) => void;
type EnsureDigestRegistrationPreconditionsFn = (
  operationLabel: "transfer" | "withdraw"
) => Promise<boolean>;
type ComputeWithdrawExactAmountsFn = (notes: ShieldedNote[], fee: bigint) => string[];
type FilterAmountsByMaxLiquidityFn = (amounts: string[], maxLiquidity: bigint) => string[];

type MarkTransferProgressFn = (
  stage:
    | "idle"
    | "validating"
    | "proving"
    | "verifying"
    | "preparing-onchain"
    | "awaiting-signature"
    | "tx-submitted"
    | "syncing-local"
    | "completed"
    | "failed",
  percent: number,
  message: string,
  txHash?: string
) => void;

type MarkWithdrawProgressFn = MarkTransferProgressFn;

interface RunDepositActionArgs {
  walletHint: string;
  setWalletHint: (value: string) => void;
  depositAmount: string;
  setDepositAmount: (value: string) => void;
  onchainReady: boolean;
  walletSession: ConnectedStarknetSession | null;
  defaultAsset: string;
  isHexAddressLike: IsHexAddressLikeFn;
  normalizeWalletHint: NormalizeWalletHintFn;
  setStatus: SetStatusFn;
  setStatusTracked: SetStatusTrackedFn;
  short: ShortFn;
  mutateRoot: MutateFn;
  mutateSnapshot: MutateFn;
  refreshPoolLiquidity: RefreshPoolLiquidityFn;
  refreshPendingDepositCount: RefreshPendingDepositCountFn;
  upsertPendingDepositSync: (entry: PendingDepositSyncLike) => void;
  removePendingDepositSync: (id: string) => void;
}

export async function runDepositAction({
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
}: RunDepositActionArgs): Promise<void> {
  try {
    const walletHintResult = parseRequiredText(walletHint, "Wallet hint");
    if (!walletHintResult.ok) {
      setStatus(walletHintResult.error);
      return;
    }

    const depositAmountResult = parseAmountInput(depositAmount, "Deposit amount");
    if (!depositAmountResult.ok) {
      setStatus(depositAmountResult.error);
      return;
    }

    const normalizedWalletHint = normalizeWalletHint(walletHintResult.value);
    const normalizedDepositAmount = depositAmountResult.normalized;
    if (walletHint !== normalizedWalletHint) {
      setWalletHint(normalizedWalletHint);
    }
    if (depositAmount !== normalizedDepositAmount) {
      setDepositAmount(normalizedDepositAmount);
    }

    const poolAddress = SSSH_BTC_CONTRACTS.shieldedPoolAddress;

    if (onchainReady && walletSession && poolAddress && isHexAddressLike(defaultAsset)) {
      const blinding = randomHex();
      const commitment = deriveCommitment(
        normalizedWalletHint,
        defaultAsset,
        normalizedDepositAmount,
        blinding
      );
      const ciphertext: NoteCiphertext = {
        commitment,
        recipientHint: normalizedWalletHint,
        ephemeralPubKey: randomHex(16),
        ciphertext: randomHex(32),
        nonce: randomHex(12),
      };
      const encryptedNote = hashToField(
        "encrypted-note",
        commitment,
        normalizedWalletHint,
        String(Date.now())
      );
      const pendingSyncId = `${Date.now()}-${randomHex(8)}`;
      const pendingSyncEntry: PendingDepositSyncLike = {
        id: pendingSyncId,
        walletHint: normalizedWalletHint,
        commitment,
        note: {
          ownerHint: normalizedWalletHint,
          asset: defaultAsset,
          amount: normalizedDepositAmount,
          blinding,
        },
        ciphertext,
        createdAt: new Date().toISOString(),
      };
      upsertPendingDepositSync(pendingSyncEntry);
      refreshPendingDepositCount(normalizedWalletHint);

      setStatusTracked("Submitting onchain approve + deposit transaction...", {
        category: "onchain",
        tone: "warn",
      });
      const depositTx = await submitOnchainDeposit({
        wallet: walletSession.wallet,
        poolAddress,
        assetAddress: defaultAsset,
        amount: normalizedDepositAmount,
        commitment,
        encryptedNote,
      });
      upsertPendingDepositSync({
        ...pendingSyncEntry,
        txHash: depositTx.txHash,
      });

      try {
        await ingestCommitmentTyped({
          commitment,
          recipientHint: normalizedWalletHint,
          note: {
            ownerHint: normalizedWalletHint,
            asset: defaultAsset,
            amount: normalizedDepositAmount,
            blinding,
          },
          ciphertext,
        });
        removePendingDepositSync(pendingSyncId);
        refreshPendingDepositCount(normalizedWalletHint);
      } catch (syncError) {
        setStatusTracked(
          `Onchain deposit confirmed ${short(depositTx.txHash, 10)} but local note sync failed: ${
            syncError instanceof Error ? syncError.message : "unknown error"
          }. Use "Sync Pending Notes" or "Recover Deposit from Tx Hash".`,
          {
            category: "local-sync",
          }
        );
        return;
      }

      await Promise.all([mutateRoot(), mutateSnapshot()]);
      await refreshPoolLiquidity({ silent: true });
      setStatusTracked(`Onchain deposit confirmed ${short(depositTx.txHash, 10)} and note synced locally.`, {
        category: "onchain",
        tone: "ok",
      });
      return;
    }

    if (onchainReady && !isHexAddressLike(defaultAsset)) {
      setStatus("Default asset is not a Starknet token address. Creating local demo deposit note.");
    } else {
      setStatus("Wallet not connected. Creating local confidential deposit note...");
    }
    await createMintedNote({
      ownerHint: normalizedWalletHint,
      recipientHint: normalizedWalletHint,
      amount: normalizedDepositAmount,
      asset: defaultAsset,
    });

    await Promise.all([mutateRoot(), mutateSnapshot()]);
    setStatus("Deposit note minted in local indexer state.");
  } catch (error) {
    setStatus(`Deposit failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

interface RunTransferActionArgs {
  spendable: ShieldedNote[];
  walletHint: string;
  setWalletHint: (value: string) => void;
  transfer: TransferFormLike;
  setTransfer: SetTransferFormLike;
  onchainReady: boolean;
  walletSession: ConnectedStarknetSession | null;
  senderSecret: string;
  rootData?: RootDataLike;
  isHexAddressLike: IsHexAddressLikeFn;
  normalizeWalletHint: NormalizeWalletHintFn;
  extractRequestHashInput: ExtractRequestHashInputFn;
  setStatus: SetStatusFn;
  setStatusTracked: SetStatusTrackedFn;
  short: ShortFn;
  markTransferProgress: MarkTransferProgressFn;
  setTransferProgressFailed: (message: string) => void;
  mutateRoot: MutateFn;
  mutateSnapshot: MutateFn;
  ensureDigestRegistrationPreconditions: EnsureDigestRegistrationPreconditionsFn;
}

export async function runTransferAction({
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
}: RunTransferActionArgs): Promise<void> {
  try {
    if (spendable.length === 0) {
      const message = "No spendable notes available.";
      markTransferProgress("failed", 0, message);
      setStatus(message);
      return;
    }

    const walletHintResult = parseRequiredText(walletHint, "Wallet hint");
    if (!walletHintResult.ok) {
      markTransferProgress("failed", 0, walletHintResult.error);
      setStatus(walletHintResult.error);
      return;
    }

    const recipientHintResult = parseRequiredText(transfer.recipientHint, "Recipient wallet hint");
    if (!recipientHintResult.ok) {
      markTransferProgress("failed", 0, recipientHintResult.error);
      setStatus(recipientHintResult.error);
      return;
    }

    const transferAmountResult = parseAmountInput(transfer.amount, "Transfer amount");
    if (!transferAmountResult.ok) {
      markTransferProgress("failed", 0, transferAmountResult.error);
      setStatus(transferAmountResult.error);
      return;
    }

    const transferFeeResult = parseAmountInput(transfer.fee, "Transfer fee", {
      allowZero: true,
      defaultToZero: true,
    });
    if (!transferFeeResult.ok) {
      markTransferProgress("failed", 0, transferFeeResult.error);
      setStatus(transferFeeResult.error);
      return;
    }

    const normalizedWalletHint = normalizeWalletHint(walletHintResult.value);
    const normalizedRecipientHint = normalizeWalletHint(recipientHintResult.value);
    const normalizedTransferAmount = transferAmountResult.normalized;
    const normalizedTransferFee = transferFeeResult.normalized;
    const normalizedRequestHash = extractRequestHashInput(transfer.requestHash);

    if (walletHint !== normalizedWalletHint) {
      setWalletHint(normalizedWalletHint);
    }
    setTransfer((previous) => ({
      ...previous,
      recipientHint: normalizedRecipientHint,
      amount: normalizedTransferAmount,
      fee: normalizedTransferFee,
      requestHash: normalizedRequestHash,
    }));

    const poolAddress = SSSH_BTC_CONTRACTS.shieldedPoolAddress;
    const shouldRunOnchain = Boolean(onchainReady && walletSession && poolAddress);
    const source = shouldRunOnchain
      ? spendable.find((note) => isHexAddressLike(note.asset))
      : spendable[0];
    if (!source) {
      const message =
        "No onchain spendable notes found for Starknet asset. Submit an onchain deposit first.";
      markTransferProgress("failed", 0, message);
      setStatus(message);
      return;
    }

    const sourceAmount = BigInt(source.amount);
    const amount = transferAmountResult.value;
    const fee = transferFeeResult.value;

    if (amount + fee > sourceAmount) {
      const message = "Transfer amount plus fee exceeds available note value.";
      markTransferProgress("failed", 0, message);
      setStatus(message);
      return;
    }

    const change = sourceAmount - amount - fee;
    const recipientBlinding = randomHex();
    const changeBlinding = randomHex();
    const outputNotes = [
      {
        ownerHint: normalizedRecipientHint,
        amount: normalizedTransferAmount,
        blinding: recipientBlinding,
      },
      {
        ownerHint: normalizedWalletHint,
        amount: change.toString(),
        blinding: changeBlinding,
      },
    ];

    markTransferProgress("proving", 24, "Generating transfer proof...");
    setStatusTracked("Generating transfer proof...", {
      category: "proof",
      tone: "warn",
    });
    const transferProof = await createTransferProof({
      root: rootData?.root ?? "0x0",
      inputNotes: [
        {
          commitment: source.commitment,
          amount: source.amount,
          blinding: source.blinding,
        },
      ],
      outputNotes,
      feeAmount: normalizedTransferFee,
      asset: source.asset,
      senderSecret,
    });

    markTransferProgress("verifying", 42, "Verifying transfer proof integrity...");
    const verification = await verifyProofBundle(transferProof);
    if (!verification.valid) {
      const message = "Transfer proof verification failed.";
      markTransferProgress("failed", 42, message);
      setStatus(message);
      return;
    }

    let onchainTxHash: string | undefined;
    if (shouldRunOnchain && walletSession && poolAddress) {
      const shouldRegisterDigest = await ensureDigestRegistrationPreconditions("transfer");
      markTransferProgress("preparing-onchain", 56, "Preparing onchain transfer prechecks...");
      markTransferProgress(
        "awaiting-signature",
        66,
        shouldRegisterDigest
          ? "Awaiting wallet signature (digest registration + transfer in one tx)..."
          : "Awaiting wallet signature for private transfer..."
      );
      setStatusTracked("Submitting private transfer onchain...", {
        category: "onchain",
        tone: "warn",
      });
      const onchainRoot =
        (await getShieldedPoolRoot(walletSession.wallet, poolAddress).catch(() => null)) ??
        (rootData?.root ?? "0x0");
      const newEncryptedNotes = transferProof.publicInputs.outputCommitments.map(
        (commitment, index) =>
          hashToField(
            "encrypted-note",
            commitment,
            outputNotes[index].ownerHint,
            outputNotes[index].blinding
          )
      );

      const onchainTransfer = await submitOnchainTransfer({
        wallet: walletSession.wallet,
        poolAddress,
        feeAsset: source.asset,
        feeAmountCommitment: transferProof.publicInputs.feeCommitment,
        proofBundle: transferProof,
        newCommitments: transferProof.publicInputs.outputCommitments,
        newEncryptedNotes,
        nullifiers: transferProof.publicInputs.inputNullifiers,
        merkleRoot: onchainRoot,
        externalVerifierAddress: SSSH_BTC_CONTRACTS.externalVerifierAddress,
        registerDigest: shouldRegisterDigest,
        lifecycle: {
          onSubmitted: (txHash) => {
            markTransferProgress(
              "tx-submitted",
              82,
              `Transfer tx submitted ${short(txHash, 10)}. Waiting confirmation...`,
              txHash
            );
          },
          onConfirmed: (txHash) => {
            markTransferProgress(
              "syncing-local",
              90,
              `Transfer tx confirmed ${short(txHash, 10)}. Syncing local notes...`,
              txHash
            );
          },
        },
      });
      onchainTxHash = onchainTransfer.txHash;
    } else {
      markTransferProgress("syncing-local", 82, "Applying private transfer to local note state...");
    }

    const transferResult = await executePrivateTransfer({
      senderHint: normalizedWalletHint,
      root: rootData?.root ?? "0x0",
      asset: source.asset,
      feeAmount: normalizedTransferFee,
      inputNotes: [
        {
          commitment: source.commitment,
          amount: source.amount,
          blinding: source.blinding,
        },
      ],
      outputNotes,
      proofBundle: transferProof,
      ...(normalizedRequestHash ? { requestHash: normalizedRequestHash } : {}),
    });

    markTransferProgress("syncing-local", 94, "Refreshing wallet snapshot...");
    await Promise.all([mutateRoot(), mutateSnapshot()]);
    setStatusTracked(
      `Private transfer committed. Nullifier: ${short(transferResult.nullifiers[0])}, root: ${short(
        transferResult.newRoot
      )}${onchainTxHash ? `, tx: ${short(onchainTxHash, 10)}` : ""}`,
      {
        category: onchainTxHash ? "onchain" : "local-sync",
        tone: "ok",
      }
    );
    markTransferProgress(
      "completed",
      100,
      `Transfer completed. New root ${short(transferResult.newRoot)}.`,
      onchainTxHash
    );
  } catch (error) {
    const message = `Private transfer failed: ${error instanceof Error ? error.message : "unknown error"}`;
    setTransferProgressFailed(message);
    setStatus(message);
  }
}

interface RunWithdrawActionArgs {
  spendable: ShieldedNote[];
  withdrawCandidateNotes: ShieldedNote[];
  poolLiquidityValue: bigint | null;
  walletHint: string;
  setWalletHint: (value: string) => void;
  withdrawAmount: string;
  setWithdrawAmount: (value: string) => void;
  withdrawFee: string;
  setWithdrawFee: (value: string) => void;
  onchainReady: boolean;
  walletSession: ConnectedStarknetSession | null;
  walletAddress: string | null;
  senderSecret: string;
  rootData?: RootDataLike;
  normalizeWalletHint: NormalizeWalletHintFn;
  computeWithdrawExactAmounts: ComputeWithdrawExactAmountsFn;
  filterAmountsByMaxLiquidity: FilterAmountsByMaxLiquidityFn;
  setStatus: SetStatusFn;
  setStatusTracked: SetStatusTrackedFn;
  short: ShortFn;
  markWithdrawProgress: MarkWithdrawProgressFn;
  setWithdrawProgressFailed: (message: string) => void;
  setPoolLiquidity: SetPoolLiquidityLike;
  mutateRoot: MutateFn;
  mutateSnapshot: MutateFn;
  refreshPoolLiquidity: RefreshPoolLiquidityFn;
  ensureDigestRegistrationPreconditions: EnsureDigestRegistrationPreconditionsFn;
}

export async function runWithdrawAction({
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
}: RunWithdrawActionArgs): Promise<void> {
  try {
    markWithdrawProgress("validating", 8, "Validating withdrawal inputs...");
    if (spendable.length === 0) {
      const message = "No spendable notes available for withdrawal.";
      markWithdrawProgress("failed", 8, message);
      setStatus(message);
      return;
    }

    const walletHintResult = parseRequiredText(walletHint, "Wallet hint");
    if (!walletHintResult.ok) {
      markWithdrawProgress("failed", 8, walletHintResult.error);
      setStatus(walletHintResult.error);
      return;
    }

    const withdrawAmountResult = parseAmountInput(withdrawAmount, "Withdraw amount");
    if (!withdrawAmountResult.ok) {
      markWithdrawProgress("failed", 8, withdrawAmountResult.error);
      setStatus(withdrawAmountResult.error);
      return;
    }

    const withdrawFeeResult = parseAmountInput(withdrawFee, "Withdraw fee", {
      allowZero: true,
      defaultToZero: true,
    });
    if (!withdrawFeeResult.ok) {
      markWithdrawProgress("failed", 8, withdrawFeeResult.error);
      setStatus(withdrawFeeResult.error);
      return;
    }

    const normalizedWalletHint = normalizeWalletHint(walletHintResult.value);
    const normalizedWithdrawAmount = withdrawAmountResult.normalized;
    const normalizedWithdrawFee = withdrawFeeResult.normalized;

    if (walletHint !== normalizedWalletHint) {
      setWalletHint(normalizedWalletHint);
    }
    if (withdrawAmount !== normalizedWithdrawAmount) {
      setWithdrawAmount(normalizedWithdrawAmount);
    }
    if (withdrawFee !== normalizedWithdrawFee) {
      setWithdrawFee(normalizedWithdrawFee);
    }

    const poolAddress = SSSH_BTC_CONTRACTS.shieldedPoolAddress;
    const shouldRunOnchain = Boolean(onchainReady && walletSession && poolAddress);
    const candidateNotes = withdrawCandidateNotes;
    if (candidateNotes.length === 0) {
      const message =
        "No onchain spendable notes found for Starknet asset. Submit an onchain deposit first.";
      markWithdrawProgress("failed", 8, message);
      setStatus(message);
      return;
    }

    const amount = withdrawAmountResult.value;
    const fee = withdrawFeeResult.value;
    const requiredTotal = amount + fee;
    const source =
      candidateNotes.find((note) => BigInt(note.amount) === requiredTotal) ?? candidateNotes[0];
    const sourceAmount = BigInt(source.amount);
    if (requiredTotal !== sourceAmount) {
      const validWithdrawAmounts = computeWithdrawExactAmounts(candidateNotes, fee);
      const liquidityFilteredAmounts =
        shouldRunOnchain && poolLiquidityValue !== null
          ? filterAmountsByMaxLiquidity(validWithdrawAmounts, poolLiquidityValue)
          : validWithdrawAmounts;
      if (validWithdrawAmounts.length === 0) {
        const message = `Withdraw currently has no valid amount for fee ${normalizedWithdrawFee}. Decrease fee or deposit a matching note.`;
        markWithdrawProgress("failed", 8, message);
        setStatus(message);
        return;
      }

      if (shouldRunOnchain && poolLiquidityValue !== null && liquidityFilteredAmounts.length === 0) {
        const noteMatchPreview = validWithdrawAmounts.slice(0, 6).join(", ");
        const noteMatchRemaining = Math.max(0, validWithdrawAmounts.length - 6);
        const message = `No onchain withdrawable amount for fee ${normalizedWithdrawFee}: exact note-match amount(s) exceed pool liquidity ${poolLiquidityValue.toString()}. Exact note-match amounts: ${noteMatchPreview}${noteMatchRemaining > 0 ? ` (+${noteMatchRemaining} more)` : ""}.`;
        markWithdrawProgress("failed", 8, message);
        setStatus(message);
        return;
      }

      const minAmount = liquidityFilteredAmounts[0];
      const maxAmount = liquidityFilteredAmounts[liquidityFilteredAmounts.length - 1];
      const amountPreview = liquidityFilteredAmounts.slice(0, 6).join(", ");
      const remainingCount = Math.max(0, liquidityFilteredAmounts.length - 6);
      const liquiditySuffix =
        shouldRunOnchain && poolLiquidityValue !== null
          ? ` (filtered by pool liquidity ${poolLiquidityValue.toString()})`
          : "";
      const message = `Withdraw requires exact match (amount + fee = note amount). Required=${requiredTotal.toString()}, min=${minAmount}, max=${maxAmount}, valid amounts${liquiditySuffix}: ${amountPreview}${remainingCount > 0 ? ` (+${remainingCount} more)` : ""}.`;
      markWithdrawProgress("failed", 8, message);
      setStatus(message);
      return;
    }

    const changeAmount = sourceAmount - requiredTotal;
    const changeBlinding = changeAmount > 0n ? randomHex() : undefined;
    const recipient = walletAddress ?? normalizedWalletHint;

    if (shouldRunOnchain && walletSession && poolAddress) {
      markWithdrawProgress("validating", 14, "Checking pool liquidity...");
      const poolBalanceRaw = await getErc20Balance(walletSession.wallet, source.asset, poolAddress);
      const updatedAt = new Date().toISOString();
      setPoolLiquidity({
        loading: false,
        amount: poolBalanceRaw,
        error: null,
        updatedAt,
      });

      const poolBalance = BigInt(poolBalanceRaw);
      if (amount > poolBalance) {
        const message = `Withdraw amount ${normalizedWithdrawAmount} exceeds pool liquidity ${poolBalanceRaw}. Deposit more to pool or lower withdraw amount.`;
        markWithdrawProgress("failed", 14, message);
        setStatus(message);
        return;
      }
    }

    markWithdrawProgress("proving", 24, "Generating withdraw proof...");
    setStatusTracked("Generating withdraw proof...", {
      category: "proof",
      tone: "warn",
    });
    const withdrawProof = await createWithdrawProof({
      root: rootData?.root ?? "0x0",
      inputNotes: [
        {
          commitment: source.commitment,
          amount: source.amount,
          blinding: source.blinding,
        },
      ],
      recipient,
      amount: normalizedWithdrawAmount,
      feeAmount: normalizedWithdrawFee,
      asset: source.asset,
      senderSecret,
    });

    markWithdrawProgress("verifying", 42, "Verifying withdraw proof integrity...");
    const verification = await verifyProofBundle(withdrawProof);
    if (!verification.valid) {
      const message = "Withdraw proof verification failed.";
      markWithdrawProgress("failed", 42, message);
      setStatus(message);
      return;
    }

    let onchainTxHash: string | undefined;
    if (shouldRunOnchain && walletSession && poolAddress) {
      if (!walletAddress) {
        const message = "Connect a Starknet wallet before submitting onchain withdrawal.";
        markWithdrawProgress("failed", 42, message);
        setStatus(message);
        return;
      }

      const shouldRegisterDigest = await ensureDigestRegistrationPreconditions("withdraw");
      markWithdrawProgress("preparing-onchain", 56, "Preparing onchain withdrawal prechecks...");
      markWithdrawProgress(
        "awaiting-signature",
        66,
        shouldRegisterDigest
          ? "Awaiting wallet signature (digest registration + withdraw in one tx)..."
          : "Awaiting wallet signature for private withdrawal..."
      );
      setStatusTracked("Submitting private withdraw onchain...", {
        category: "onchain",
        tone: "warn",
      });
      const onchainRoot =
        (await getShieldedPoolRoot(walletSession.wallet, poolAddress).catch(() => null)) ??
        (rootData?.root ?? "0x0");

      const onchainWithdraw = await submitOnchainWithdraw({
        wallet: walletSession.wallet,
        poolAddress,
        recipient: walletAddress,
        withdrawAmount: normalizedWithdrawAmount,
        amountCommitment: withdrawProof.publicInputs.amountCommitment,
        assetAddress: source.asset,
        proofBundle: withdrawProof,
        nullifiers: withdrawProof.publicInputs.inputNullifiers,
        merkleRoot: onchainRoot,
        externalVerifierAddress: SSSH_BTC_CONTRACTS.externalVerifierAddress,
        registerDigest: shouldRegisterDigest,
        lifecycle: {
          onSubmitted: (txHash) => {
            markWithdrawProgress(
              "tx-submitted",
              82,
              `Withdraw tx submitted ${short(txHash, 10)}. Waiting confirmation...`,
              txHash
            );
          },
          onConfirmed: (txHash) => {
            markWithdrawProgress(
              "syncing-local",
              90,
              `Withdraw tx confirmed ${short(txHash, 10)}. Syncing local notes...`,
              txHash
            );
          },
        },
      });
      onchainTxHash = onchainWithdraw.txHash;
    } else {
      markWithdrawProgress("syncing-local", 82, "Applying private withdrawal to local note state...");
    }

    const withdrawResult = await executePrivateWithdraw({
      senderHint: normalizedWalletHint,
      root: rootData?.root ?? "0x0",
      asset: source.asset,
      recipient,
      withdrawAmount: normalizedWithdrawAmount,
      feeAmount: normalizedWithdrawFee,
      inputNotes: [
        {
          commitment: source.commitment,
          amount: source.amount,
          blinding: source.blinding,
        },
      ],
      ...(changeBlinding ? { changeBlinding } : {}),
      proofBundle: withdrawProof,
    });

    markWithdrawProgress("syncing-local", 94, "Refreshing wallet snapshot...", onchainTxHash);
    await Promise.all([mutateRoot(), mutateSnapshot()]);
    if (onchainTxHash) {
      await refreshPoolLiquidity({ silent: true });
    }
    setStatusTracked(
      `Withdraw committed. Amount commitment: ${short(withdrawResult.amountCommitment)}${
        onchainTxHash ? `, tx: ${short(onchainTxHash, 10)}` : ""
      }`,
      {
        category: onchainTxHash ? "onchain" : "local-sync",
        tone: "ok",
      }
    );
    markWithdrawProgress(
      "completed",
      100,
      `Withdrawal completed. Amount commitment ${short(withdrawResult.amountCommitment)}.`,
      onchainTxHash
    );
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "unknown error";
    const message = rawMessage.includes("Withdraw conservation check failed before proof generation")
      ? "Withdraw amount + fee must exactly equal one spendable note amount (current circuit has no change output)."
      : `Withdraw failed: ${rawMessage}`;
    setWithdrawProgressFailed(message);
    setStatus(message);
  }
}
