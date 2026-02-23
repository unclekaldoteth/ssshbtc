import { useEffect, useRef, useState } from "react";

export type ActivityTone = "neutral" | "ok" | "warn" | "bad";
export type ActivityCategory = "onchain" | "proof" | "local-sync" | "requests";
export type ActivityFilter = "all" | ActivityCategory;

export const ACTIVITY_CATEGORY_ORDER: ActivityCategory[] = [
  "onchain",
  "proof",
  "local-sync",
  "requests",
];

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  onchain: "Onchain",
  proof: "Proof",
  "local-sync": "Local Sync",
  requests: "Requests",
};

export interface ActivityEntry {
  id: string;
  timestamp: string;
  tone: ActivityTone;
  category: ActivityCategory;
  message: string;
}

export interface PendingStatusActivityMeta {
  category?: ActivityCategory;
  tone?: ActivityTone;
}

interface UseWalletActivityOptions<TAction extends string> {
  actionCategoryHint: Partial<Record<TAction, ActivityCategory>>;
  initialStatus?: string;
  feedLimit?: number;
}

function classifyActivityTone(message: string): ActivityTone {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("blocked") ||
    normalized.includes("cannot ") ||
    normalized.includes("unable ") ||
    normalized.includes("rejected") ||
    normalized.includes("reverted") ||
    normalized.includes("timed out") ||
    normalized.includes("mismatch")
  ) {
    return "bad";
  }
  if (
    normalized.includes("pending") ||
    normalized.includes("awaiting") ||
    normalized.includes("refresh") ||
    normalized.includes("loading") ||
    normalized.includes("connecting") ||
    normalized.includes("submitting") ||
    normalized.includes("generating") ||
    normalized.includes("verifying") ||
    normalized.includes("syncing") ||
    normalized.includes("checking") ||
    normalized.includes("fetching")
  ) {
    return "warn";
  }
  if (
    normalized.includes("completed") ||
    normalized.includes("confirmed") ||
    normalized.includes("connected") ||
    normalized.includes("created") ||
    normalized.includes("synced") ||
    normalized.includes("committed") ||
    normalized.includes("copied") ||
    normalized.includes("minted") ||
    normalized.includes("ready") ||
    normalized.includes("refreshed")
  ) {
    return "ok";
  }
  return "neutral";
}

function resolveActivityCategory<TAction extends string>(
  actionHintMap: Partial<Record<TAction, ActivityCategory>>,
  actionHint?: TAction | null,
  overrideCategory?: ActivityCategory
): ActivityCategory {
  if (overrideCategory) {
    return overrideCategory;
  }

  if (actionHint && actionHintMap[actionHint]) {
    return actionHintMap[actionHint] as ActivityCategory;
  }

  return "local-sync";
}

export function useWalletActivity<TAction extends string>({
  actionCategoryHint,
  initialStatus = "Idle",
  feedLimit = 12,
}: UseWalletActivityOptions<TAction>) {
  const [status, setStatus] = useState(initialStatus);
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");

  const activeActionRef = useRef<TAction | null>(null);
  const recentActionRef = useRef<{ action: TAction; at: number } | null>(null);
  const pendingStatusActivityMetaRef = useRef<PendingStatusActivityMeta | null>(null);
  const lastLoggedStatusRef = useRef<string>(initialStatus);
  const activityCounterRef = useRef(0);

  function setStatusTracked(message: string, meta?: PendingStatusActivityMeta): void {
    pendingStatusActivityMetaRef.current = meta ?? null;
    setStatus(message);
  }

  function beginActivityAction(action: TAction): void {
    activeActionRef.current = action;
  }

  function finishActivityAction(action: TAction): void {
    recentActionRef.current = {
      action,
      at: Date.now(),
    };
    activeActionRef.current = null;
  }

  useEffect(() => {
    const message = status.trim();
    if (!message || message === "Idle") {
      return;
    }

    if (lastLoggedStatusRef.current === message) {
      return;
    }

    lastLoggedStatusRef.current = message;
    activityCounterRef.current += 1;
    const now = Date.now();
    const recentAction = recentActionRef.current;
    const actionHint =
      activeActionRef.current ??
      (recentAction && now - recentAction.at < 2000 ? recentAction.action : null);
    const pendingMeta = pendingStatusActivityMetaRef.current;
    pendingStatusActivityMetaRef.current = null;

    const entry: ActivityEntry = {
      id: `${now}-${activityCounterRef.current}`,
      timestamp: new Date(now).toISOString(),
      tone: pendingMeta?.tone ?? classifyActivityTone(message),
      category: resolveActivityCategory(actionCategoryHint, actionHint, pendingMeta?.category),
      message,
    };

    setActivityFeed((previous) => [entry, ...previous].slice(0, feedLimit));
  }, [actionCategoryHint, feedLimit, status]);

  return {
    status,
    setStatus,
    setStatusTracked,
    activityFeed,
    activityFilter,
    setActivityFilter,
    beginActivityAction,
    finishActivityAction,
  };
}

