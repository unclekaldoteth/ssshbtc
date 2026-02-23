import { amountToCommitment, hashToField, randomHex, type WalletStateSnapshot } from "@sssh-btc/shared";

import {
  createPaymentRequest,
  getPaymentRequest,
  ingestCommitmentTyped,
} from "../lib/api";
import { SSSH_BTC_CONTRACTS } from "../lib/contracts";
import { readDepositCommitmentFromTxReceipt } from "../lib/onchain";
import { parseAmountInput, parseRequiredText } from "../lib/wallet-validation";

type ActivityToneLike = "neutral" | "ok" | "warn" | "bad";
type ActivityCategoryLike = "onchain" | "proof" | "local-sync" | "requests";

interface StatusMetaLike {
  category?: ActivityCategoryLike;
  tone?: ActivityToneLike;
}

interface TransferFormLike {
  recipientHint: string;
  amount: string;
  fee: string;
  requestHash: string;
}

type SetTransferFormLike = (
  updater: (previous: TransferFormLike) => TransferFormLike
) => void;

type MutateFn = () => Promise<unknown>;
type SetStatusFn = (message: string) => void;
type SetStatusTrackedFn = (message: string, meta?: StatusMetaLike) => void;
type ShortFn = (value: string, size?: number) => string;
type NormalizeWalletHintFn = (value: string) => string;
type ExtractRequestHashInputFn = (value: string) => string;

interface RunRecoverDepositActionArgs {
  walletHint: string;
  setWalletHint: (value: string) => void;
  recoveryTxHash: string;
  setRecoveryTxHash: (value: string) => void;
  recoveryAmount: string;
  setRecoveryAmount: (value: string) => void;
  snapshot: WalletStateSnapshot | undefined;
  defaultAsset: string;
  normalizeWalletHint: NormalizeWalletHintFn;
  setStatus: SetStatusFn;
  setStatusTracked: SetStatusTrackedFn;
  short: ShortFn;
  mutateRoot: MutateFn;
  mutateSnapshot: MutateFn;
}

export async function runRecoverDepositAction({
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
}: RunRecoverDepositActionArgs): Promise<void> {
  try {
    const walletHintResult = parseRequiredText(walletHint, "Wallet hint");
    if (!walletHintResult.ok) {
      setStatus(walletHintResult.error);
      return;
    }

    const txHashResult = parseRequiredText(recoveryTxHash, "Deposit transaction hash");
    if (!txHashResult.ok) {
      setStatus(txHashResult.error);
      return;
    }

    const normalizedWalletHint = normalizeWalletHint(walletHintResult.value);
    const normalizedTxHash = txHashResult.value.toLowerCase();

    if (walletHint !== normalizedWalletHint) {
      setWalletHint(normalizedWalletHint);
    }
    if (recoveryTxHash !== normalizedTxHash) {
      setRecoveryTxHash(normalizedTxHash);
    }

    const poolAddress = SSSH_BTC_CONTRACTS.shieldedPoolAddress;
    if (!poolAddress) {
      setStatus("Cannot recover note: ShieldedPool contract address is not configured.");
      return;
    }

    setStatusTracked("Fetching Starknet receipt and parsing deposit commitment...", {
      category: "onchain",
      tone: "warn",
    });
    const recovered = await readDepositCommitmentFromTxReceipt({
      txHash: normalizedTxHash,
      poolAddress,
    });

    const amountCandidate = recoveryAmount.trim() || recovered.amount;
    if (!amountCandidate) {
      setStatus("Could not infer deposit amount from tx receipt. Enter recovered amount manually.");
      return;
    }

    const amountResult = parseAmountInput(amountCandidate, "Recovered deposit amount");
    if (!amountResult.ok) {
      setStatus(amountResult.error);
      return;
    }
    const normalizedAmount = amountResult.normalized;

    if (recovered.amount && normalizedAmount !== recovered.amount) {
      setStatus(
        `Recovered tx amount is ${recovered.amount}. Update recovered amount to match before syncing note.`
      );
      setRecoveryAmount(recovered.amount);
      return;
    }

    if (recoveryAmount !== normalizedAmount) {
      setRecoveryAmount(normalizedAmount);
    }

    const alreadyKnown = (snapshot?.knownNotes ?? []).some(
      (note) => note.commitment === recovered.commitment
    );
    if (alreadyKnown) {
      setStatus(`Recovered commitment ${short(recovered.commitment, 10)} is already in wallet notes.`);
      return;
    }

    const blinding = randomHex();
    await ingestCommitmentTyped({
      commitment: recovered.commitment,
      recipientHint: normalizedWalletHint,
      note: {
        ownerHint: normalizedWalletHint,
        asset: defaultAsset,
        amount: normalizedAmount,
        blinding,
      },
      ciphertext: {
        commitment: recovered.commitment,
        recipientHint: normalizedWalletHint,
        ephemeralPubKey: randomHex(16),
        ciphertext: randomHex(32),
        nonce: randomHex(12),
      },
    });

    await Promise.all([mutateRoot(), mutateSnapshot()]);
    setStatus(
      `Recovered spendable note ${short(recovered.commitment, 10)} from tx ${short(normalizedTxHash, 10)}.`
    );
  } catch (error) {
    setStatus(
      `Recover deposit failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}

interface RunCreateRequestActionArgs {
  walletHint: string;
  setWalletHint: (value: string) => void;
  requestAmount: string;
  setRequestAmount: (value: string) => void;
  requestMemo: string;
  setRequestMemo: (value: string) => void;
  defaultAsset: string;
  setRequestShareHash: (value: string) => void;
  setRequestShareUrl: (value: string) => void;
  setShareLinkCopyState: (value: "idle" | "copied" | "failed") => void;
  setShareHashCopyState: (value: "idle" | "copied" | "failed") => void;
  setTransfer: SetTransferFormLike;
  mutateSnapshot: MutateFn;
  normalizeWalletHint: NormalizeWalletHintFn;
  setStatus: SetStatusFn;
  short: ShortFn;
}

export async function runCreateRequestAction({
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
}: RunCreateRequestActionArgs): Promise<void> {
  try {
    const walletHintResult = parseRequiredText(walletHint, "Wallet hint");
    if (!walletHintResult.ok) {
      setStatus(walletHintResult.error);
      return;
    }

    const requestAmountResult = parseAmountInput(requestAmount, "Requested amount");
    if (!requestAmountResult.ok) {
      setStatus(requestAmountResult.error);
      return;
    }

    const normalizedWalletHint = normalizeWalletHint(walletHintResult.value);
    const normalizedRequestAmount = requestAmountResult.normalized;
    const normalizedRequestMemo = requestMemo.trim();
    if (walletHint !== normalizedWalletHint) {
      setWalletHint(normalizedWalletHint);
    }
    if (requestAmount !== normalizedRequestAmount) {
      setRequestAmount(normalizedRequestAmount);
    }
    if (requestMemo !== normalizedRequestMemo) {
      setRequestMemo(normalizedRequestMemo);
    }

    const blinding = randomHex();
    const amountCommitment = amountToCommitment(normalizedRequestAmount, blinding);
    const requestHash = hashToField("request", normalizedWalletHint, amountCommitment, String(Date.now()));

    const created = await createPaymentRequest({
      requestHash,
      receiverStealthPubkey: normalizedWalletHint,
      expiry: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      memo: normalizedRequestMemo,
      asset: defaultAsset,
      amountCommitment,
    });

    const shareUrl = `${window.location.origin}?request=${created.requestHash}&to=${normalizedWalletHint}`;
    setRequestShareHash(created.requestHash);
    setRequestShareUrl(shareUrl);
    setShareLinkCopyState("idle");
    setShareHashCopyState("idle");
    setTransfer((prev) => ({ ...prev, requestHash: created.requestHash }));
    await mutateSnapshot();
    setStatus(`Created request ${short(created.requestHash)} with hidden amount.`);
  } catch (error) {
    setStatus(
      `Create request failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}

interface RunLoadRequestActionArgs {
  hash: string;
  transferRequestHash: string;
  setTransfer: SetTransferFormLike;
  extractRequestHashInput: ExtractRequestHashInputFn;
  setStatus: SetStatusFn;
  short: ShortFn;
}

export async function runLoadRequestAction({
  hash,
  transferRequestHash,
  setTransfer,
  extractRequestHashInput,
  setStatus,
  short,
}: RunLoadRequestActionArgs): Promise<void> {
  const normalizedHash = extractRequestHashInput(hash);
  if (!normalizedHash) {
    return;
  }

  try {
    if (normalizedHash !== transferRequestHash) {
      setTransfer((prev) => ({ ...prev, requestHash: normalizedHash }));
    }

    const request = await getPaymentRequest(normalizedHash);
    setStatus(`Request ${short(request.requestHash)} ${request.paid ? "already paid" : "is pending"}.`);
  } catch (error) {
    setStatus(`Unable to load request: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

interface CopyRequestHashActionArgs {
  requestShareHash: string;
  setShareHashCopyState: (value: "idle" | "copied" | "failed") => void;
  setStatusTracked: SetStatusTrackedFn;
}

export async function copyRequestHashAction({
  requestShareHash,
  setShareHashCopyState,
  setStatusTracked,
}: CopyRequestHashActionArgs): Promise<void> {
  if (!requestShareHash) {
    return;
  }

  try {
    await navigator.clipboard.writeText(requestShareHash);
    setShareHashCopyState("copied");
    setStatusTracked("Request hash copied to clipboard.", {
      category: "requests",
      tone: "ok",
    });
  } catch (error) {
    setShareHashCopyState("failed");
    setStatusTracked(
      `Failed to copy request hash: ${error instanceof Error ? error.message : "unknown error"}`,
      {
        category: "requests",
        tone: "bad",
      }
    );
  }
}

interface CopyShareLinkActionArgs {
  requestShareUrl: string;
  setShareLinkCopyState: (value: "idle" | "copied" | "failed") => void;
  setStatusTracked: SetStatusTrackedFn;
}

export async function copyShareLinkAction({
  requestShareUrl,
  setShareLinkCopyState,
  setStatusTracked,
}: CopyShareLinkActionArgs): Promise<void> {
  if (!requestShareUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(requestShareUrl);
    setShareLinkCopyState("copied");
    setStatusTracked("Share link copied to clipboard.", {
      category: "requests",
      tone: "ok",
    });
  } catch (error) {
    setShareLinkCopyState("failed");
    setStatusTracked(
      `Failed to copy share link: ${error instanceof Error ? error.message : "unknown error"}`,
      {
        category: "requests",
        tone: "bad",
      }
    );
  }
}

