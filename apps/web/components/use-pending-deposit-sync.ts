import { useEffect, useState } from "react";

import type { NoteCiphertext, WalletStateSnapshot } from "@sssh-btc/shared";

import { ingestCommitmentTyped } from "../lib/api";
import { parseRequiredText } from "../lib/wallet-validation";

export interface PendingDepositSyncEntry {
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

const PENDING_DEPOSIT_SYNC_STORAGE_KEY = "sssh-btc.pendingDepositSync.v1";
const LEGACY_PENDING_DEPOSIT_SYNC_STORAGE_KEY = "shadowbtc.pendingDepositSync.v1";

function parsePendingDepositSyncEntries(raw: string): PendingDepositSyncEntry[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((entry): entry is PendingDepositSyncEntry => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      const candidate = entry as Partial<PendingDepositSyncEntry>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.walletHint === "string" &&
        typeof candidate.commitment === "string" &&
        typeof candidate.createdAt === "string" &&
        typeof candidate.note?.ownerHint === "string" &&
        typeof candidate.note?.asset === "string" &&
        typeof candidate.note?.amount === "string" &&
        typeof candidate.note?.blinding === "string" &&
        typeof candidate.ciphertext?.commitment === "string" &&
        typeof candidate.ciphertext?.recipientHint === "string" &&
        typeof candidate.ciphertext?.ephemeralPubKey === "string" &&
        typeof candidate.ciphertext?.ciphertext === "string" &&
        typeof candidate.ciphertext?.nonce === "string"
      );
    });
  } catch {
    return null;
  }
}

function readPendingDepositSync(): PendingDepositSyncEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const currentRaw = window.localStorage.getItem(PENDING_DEPOSIT_SYNC_STORAGE_KEY);
    if (currentRaw !== null) {
      return parsePendingDepositSyncEntries(currentRaw) ?? [];
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_PENDING_DEPOSIT_SYNC_STORAGE_KEY);
    if (legacyRaw === null) {
      return [];
    }

    const migratedEntries = parsePendingDepositSyncEntries(legacyRaw);
    if (!migratedEntries) {
      return [];
    }

    try {
      window.localStorage.setItem(PENDING_DEPOSIT_SYNC_STORAGE_KEY, JSON.stringify(migratedEntries));
      window.localStorage.removeItem(LEGACY_PENDING_DEPOSIT_SYNC_STORAGE_KEY);
    } catch {
      // no-op: migration is best-effort.
    }

    return migratedEntries;
  } catch {
    return [];
  }
}

function writePendingDepositSync(entries: PendingDepositSyncEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PENDING_DEPOSIT_SYNC_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // no-op: keep UX functional even if storage is unavailable.
  }
}

interface UsePendingDepositSyncArgs {
  walletHint: string;
  trimmedWalletHint: string;
  snapshot: WalletStateSnapshot | undefined;
  mutateRoot: () => Promise<unknown>;
  mutateSnapshot: () => Promise<unknown>;
  normalizeWalletHint: (value: string) => string;
  sameWalletHint: (left: string, right: string) => boolean;
  setStatus: (message: string) => void;
}

export function usePendingDepositSync({
  walletHint,
  trimmedWalletHint,
  snapshot,
  mutateRoot,
  mutateSnapshot,
  normalizeWalletHint,
  sameWalletHint,
  setStatus,
}: UsePendingDepositSyncArgs) {
  const [pendingDepositSyncCount, setPendingDepositSyncCount] = useState(0);

  function upsertPendingDepositSync(entry: PendingDepositSyncEntry): void {
    const next = readPendingDepositSync().filter((candidate) => candidate.id !== entry.id);
    next.push(entry);
    writePendingDepositSync(next);
  }

  function removePendingDepositSync(id: string): void {
    const next = readPendingDepositSync().filter((candidate) => candidate.id !== id);
    writePendingDepositSync(next);
  }

  function refreshPendingDepositCount(currentWalletHint: string): void {
    const normalizedWalletHint = normalizeWalletHint(currentWalletHint);
    const pendingForWallet = readPendingDepositSync().filter((entry) =>
      sameWalletHint(entry.walletHint, normalizedWalletHint)
    );
    setPendingDepositSyncCount(pendingForWallet.length);
  }

  async function syncPendingDepositNotes(options: { silent?: boolean } = {}): Promise<void> {
    const walletHintResult = parseRequiredText(walletHint, "Wallet hint");
    if (!walletHintResult.ok) {
      if (!options.silent) {
        setStatus(walletHintResult.error);
      }
      return;
    }

    const normalizedWalletHint = normalizeWalletHint(walletHintResult.value);
    const pending = readPendingDepositSync().filter((entry) =>
      sameWalletHint(entry.walletHint, normalizedWalletHint)
    );

    if (pending.length === 0) {
      refreshPendingDepositCount(normalizedWalletHint);
      if (!options.silent) {
        setStatus("No pending local note sync items.");
      }
      return;
    }

    let synced = 0;
    let failed = 0;
    let firstError: string | null = null;

    for (const entry of pending) {
      const alreadyKnown = (snapshot?.knownNotes ?? []).some(
        (note) => note.commitment === entry.commitment
      );
      if (alreadyKnown) {
        removePendingDepositSync(entry.id);
        synced += 1;
        continue;
      }

      try {
        await ingestCommitmentTyped({
          commitment: entry.commitment,
          recipientHint: normalizedWalletHint,
          note: {
            ownerHint: normalizedWalletHint,
            asset: entry.note.asset,
            amount: entry.note.amount,
            blinding: entry.note.blinding,
          },
          ciphertext: {
            ...entry.ciphertext,
            recipientHint: normalizedWalletHint,
          },
        });
        removePendingDepositSync(entry.id);
        synced += 1;
      } catch (error) {
        failed += 1;
        if (!firstError) {
          firstError = error instanceof Error ? error.message : "unknown sync error";
        }
      }
    }

    refreshPendingDepositCount(normalizedWalletHint);
    await Promise.all([mutateRoot(), mutateSnapshot()]);
    if (!options.silent) {
      setStatus(
        failed > 0
          ? `Synced ${synced} note(s), ${failed} pending sync item(s) still failing. First error: ${firstError ?? "unknown"}`
          : `Synced ${synced} pending note(s).`
      );
    }
  }

  useEffect(() => {
    refreshPendingDepositCount(trimmedWalletHint);
  }, [trimmedWalletHint, snapshot?.knownNotes.length]);

  useEffect(() => {
    if (!trimmedWalletHint) {
      return;
    }

    void syncPendingDepositNotes({ silent: true });
  }, [trimmedWalletHint]);

  return {
    pendingDepositSyncCount,
    refreshPendingDepositCount,
    syncPendingDepositNotes,
    upsertPendingDepositSync,
    removePendingDepositSync,
  };
}
