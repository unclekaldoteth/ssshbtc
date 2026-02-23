import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ShieldedNote, WalletStateSnapshot } from "@sssh-btc/shared";

import { parseAmountInput } from "../lib/wallet-validation";

type ActivityToneLike = "neutral" | "ok" | "warn" | "bad";
type ActivityCategoryLike = "onchain" | "proof" | "local-sync" | "requests";
type ActivityFilterLike = "all" | ActivityCategoryLike;

interface ActivityEntryLike {
  category: ActivityCategoryLike;
}

interface ActivityGroupLike<TActivityEntry extends ActivityEntryLike> {
  category: ActivityCategoryLike;
  items: TActivityEntry[];
}

interface TransferFormLike {
  recipientHint: string;
  amount: string;
  fee: string;
  requestHash: string;
}

interface ProgressLike {
  stage: string;
}

interface PoolLiquidityLike {
  amount: string | null;
}

interface PendingRequestLike {
  requestHash: string;
  receiverStealthPubkey: string;
}

interface FlowStepLike {
  id: string;
  label: string;
  done: boolean;
  optional?: boolean;
  helper: string;
}

interface StatusMetaLike {
  category?: ActivityCategoryLike;
  tone?: ActivityToneLike;
}

interface UseWalletFlowStateArgs<TActivityEntry extends ActivityEntryLike> {
  snapshot: WalletStateSnapshot | undefined;
  trimmedWalletHint: string;
  requestShareHash: string;
  transfer: TransferFormLike;
  transferProgress: ProgressLike;
  withdrawProgress: ProgressLike;
  withdrawAmount: string;
  withdrawFee: string;
  poolLiquidity: PoolLiquidityLike;
  onchainReady: boolean;
  activityFeed: TActivityEntry[];
  activityFilter: ActivityFilterLike;
  activityCategoryOrder: ActivityCategoryLike[];
  isHexAddressLike: (value: string) => boolean;
  extractRequestHashInput: (value: string) => string;
  computeWithdrawExactAmounts: (notes: ShieldedNote[], fee: bigint) => string[];
  filterAmountsByMaxLiquidity: (amounts: string[], maxLiquidity: bigint) => string[];
  setTransfer: Dispatch<SetStateAction<TransferFormLike>>;
  setStatusTracked: (message: string, meta?: StatusMetaLike) => void;
  short: (value: string, size?: number) => string;
}

export function useWalletFlowState<TActivityEntry extends ActivityEntryLike>({
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
  activityCategoryOrder,
  isHexAddressLike,
  extractRequestHashInput,
  computeWithdrawExactAmounts,
  filterAmountsByMaxLiquidity,
  setTransfer,
  setStatusTracked,
  short,
}: UseWalletFlowStateArgs<TActivityEntry>) {
  const availableNotes = snapshot?.knownNotes ?? [];
  const pendingRequests = snapshot?.pendingRequests ?? [];

  const spendable = useMemo(
    () => availableNotes.filter((note) => note.spentAt === undefined),
    [availableNotes]
  );

  const hasRequestContext =
    pendingRequests.length > 0 ||
    Boolean(requestShareHash) ||
    Boolean(extractRequestHashInput(transfer.requestHash));

  const transferCompleted = transferProgress.stage === "completed";
  const withdrawCompleted = withdrawProgress.stage === "completed";

  const flowSteps: FlowStepLike[] = [
    {
      id: "identity",
      label: "Set sender alias",
      done: trimmedWalletHint.length > 0,
      helper: "Use a demo alias or your connected Starknet address.",
    },
    {
      id: "fund",
      label: "Create a funding note (deposit)",
      done: availableNotes.length > 0,
      helper: "Deposit onchain or mint a demo note to start the private flow.",
    },
    {
      id: "request",
      label: "Create or load a payment request",
      done: hasRequestContext,
      helper: "Optional, but useful for the request -> transfer demo flow.",
    },
    {
      id: "transfer",
      label: "Send a private transfer",
      done: transferCompleted,
      helper: "Transfers create recipient + change notes and consume a nullifier.",
    },
    {
      id: "withdraw",
      label: "Withdraw a note (optional)",
      done: withdrawCompleted,
      optional: true,
      helper: "Current circuit requires exact match: withdraw amount + fee = one note.",
    },
  ];

  const completedFlowSteps = flowSteps.filter((step) => step.done).length;
  const nextFlowStep = flowSteps.find((step) => !step.done && !step.optional) ?? null;
  const nextFlowHint = nextFlowStep
    ? `Next: ${nextFlowStep.label}. ${nextFlowStep.helper}`
    : withdrawCompleted
      ? "Flow complete. You can repeat with another wallet hint to demo recipient-side visibility."
      : "Core flow complete. Optional next step: try a withdrawal with an exact note-match amount.";

  const activityCounts = useMemo(() => {
    const base: Record<ActivityCategoryLike, number> = {
      onchain: 0,
      proof: 0,
      "local-sync": 0,
      requests: 0,
    };

    for (const entry of activityFeed) {
      base[entry.category] += 1;
    }

    return base;
  }, [activityFeed]);

  const visibleActivityGroups = useMemo(() => {
    const categories =
      activityFilter === "all" ? activityCategoryOrder : ([activityFilter] as ActivityCategoryLike[]);

    return categories
      .map((category) => ({
        category,
        items: activityFeed.filter((entry) => entry.category === category),
      }))
      .filter((group) => group.items.length > 0) as ActivityGroupLike<TActivityEntry>[];
  }, [activityFeed, activityCategoryOrder, activityFilter]);

  const activeActivityCount =
    activityFilter === "all" ? activityFeed.length : activityCounts[activityFilter];

  const withdrawCandidateNotes = useMemo(() => {
    return onchainReady ? spendable.filter((note) => isHexAddressLike(note.asset)) : spendable;
  }, [isHexAddressLike, onchainReady, spendable]);

  const withdrawFeePreview = useMemo(() => {
    const parsed = parseAmountInput(withdrawFee, "Withdraw fee", {
      allowZero: true,
      defaultToZero: true,
    });
    return parsed.ok ? parsed.value : null;
  }, [withdrawFee]);

  const withdrawAmountPreview = useMemo(() => {
    const parsed = parseAmountInput(withdrawAmount, "Withdraw amount");
    return parsed.ok ? parsed.value : null;
  }, [withdrawAmount]);

  const withdrawValidAmounts = useMemo(() => {
    if (withdrawFeePreview === null) {
      return [] as string[];
    }
    return computeWithdrawExactAmounts(withdrawCandidateNotes, withdrawFeePreview);
  }, [computeWithdrawExactAmounts, withdrawCandidateNotes, withdrawFeePreview]);

  const poolLiquidityValue = useMemo(() => {
    if (!poolLiquidity.amount) {
      return null;
    }
    try {
      return BigInt(poolLiquidity.amount);
    } catch {
      return null;
    }
  }, [poolLiquidity.amount]);

  const withdrawEffectiveValidAmounts = useMemo(() => {
    if (!onchainReady || poolLiquidityValue === null) {
      return withdrawValidAmounts;
    }

    return filterAmountsByMaxLiquidity(withdrawValidAmounts, poolLiquidityValue);
  }, [filterAmountsByMaxLiquidity, onchainReady, poolLiquidityValue, withdrawValidAmounts]);

  const withdrawMinAmount = withdrawEffectiveValidAmounts[0] ?? null;
  const withdrawMaxAmount =
    withdrawEffectiveValidAmounts.length > 0
      ? withdrawEffectiveValidAmounts[withdrawEffectiveValidAmounts.length - 1]
      : null;
  const withdrawValidAmountsPreview = withdrawEffectiveValidAmounts.slice(0, 6);
  const withdrawValidAmountsRemaining = Math.max(
    0,
    withdrawEffectiveValidAmounts.length - withdrawValidAmountsPreview.length
  );
  const withdrawExactMatchOnlyPreview = withdrawValidAmounts.slice(0, 6);
  const withdrawExactMatchFilteredByLiquidity =
    onchainReady &&
    poolLiquidityValue !== null &&
    withdrawValidAmounts.length > 0 &&
    withdrawEffectiveValidAmounts.length < withdrawValidAmounts.length;

  const withdrawPoolLiquidityExceeded = useMemo(() => {
    if (!poolLiquidity.amount || withdrawAmountPreview === null) {
      return false;
    }

    try {
      return withdrawAmountPreview > BigInt(poolLiquidity.amount);
    } catch {
      return false;
    }
  }, [poolLiquidity.amount, withdrawAmountPreview]);

  function setTransferRecipientHint(value: string): void {
    setTransfer((previous) => ({ ...previous, recipientHint: value }));
  }

  function setTransferAmount(value: string): void {
    setTransfer((previous) => ({ ...previous, amount: value }));
  }

  function setTransferFee(value: string): void {
    setTransfer((previous) => ({ ...previous, fee: value }));
  }

  function setTransferRequestHash(value: string): void {
    setTransfer((previous) => ({ ...previous, requestHash: value }));
  }

  function normalizeTransferRequestHash(): void {
    const normalizedHash = extractRequestHashInput(transfer.requestHash);
    if (normalizedHash !== transfer.requestHash) {
      setTransfer((previous) => ({ ...previous, requestHash: normalizedHash }));
    }
  }

  function fillTransferFormFromRequest(request: PendingRequestLike): void {
    setTransfer((previous) => ({
      ...previous,
      recipientHint: request.receiverStealthPubkey,
      requestHash: request.requestHash,
    }));
    setStatusTracked(`Transfer form populated from request ${short(request.requestHash)}.`, {
      category: "requests",
      tone: "ok",
    });
  }

  return {
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
  };
}

