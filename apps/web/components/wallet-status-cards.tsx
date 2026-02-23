import type { ShieldedNote } from "@sssh-btc/shared";

type PendingActionLike = string | null;
type ActivityToneLike = "neutral" | "ok" | "warn" | "bad";
type ActivityCategoryLike = "onchain" | "proof" | "local-sync" | "requests";
type ActivityFilterLike = "all" | ActivityCategoryLike;

interface WalletSessionCardProps {
  walletHint: string;
  onWalletHintChange: (value: string) => void;
  isBusy: boolean;
  pendingAction: PendingActionLike;
  onConnect: () => void;
  onRefreshSnapshot: () => void;
  onSyncPendingNotes: () => void;
  onRefreshOnchainHealth: () => void;
  onResetBusyState: () => void;
  walletAddress: string | null;
  walletAddressShort?: string | null;
  status: string;
  hasLiveDeploymentConfig: boolean;
  onchainSubmissionEnabled: boolean;
  pendingDepositSyncCount: number;
  executionModeLabel: string;
  executionModeTone: string;
  executionModeDescription: string;
}

export function WalletSessionCard({
  walletHint,
  onWalletHintChange,
  isBusy,
  pendingAction,
  onConnect,
  onRefreshSnapshot,
  onSyncPendingNotes,
  onRefreshOnchainHealth,
  onResetBusyState,
  walletAddress,
  walletAddressShort,
  status,
  hasLiveDeploymentConfig,
  onchainSubmissionEnabled,
  pendingDepositSyncCount,
  executionModeLabel,
  executionModeTone,
  executionModeDescription,
}: WalletSessionCardProps) {
  return (
    <section className="card w-8">
      <h2>Wallet Session</h2>
      <p>
        Account abstraction compatible. When wallet + contracts are configured, deposit/transfer/withdraw
        submit Starknet transactions and then sync local private notes through the indexer.
      </p>
      <article className={`mode-banner ${executionModeTone}`} aria-live="polite">
        <p className="mode-banner-title">
          Mode <span className={`pill ${executionModeTone === "ok" ? "ok" : "warn"}`}>{executionModeLabel}</span>
        </p>
        <p>{executionModeDescription}</p>
      </article>
      <div className="field">
        <label htmlFor="wallet-hint">Wallet Hint / Stealth Alias</label>
        <input
          id="wallet-hint"
          value={walletHint}
          onChange={(event) => onWalletHintChange(event.target.value)}
        />
      </div>
      <div className="actions">
        <button type="button" disabled={isBusy} onClick={onConnect}>
          {pendingAction === "connect"
            ? "Connecting Wallet..."
            : walletAddress
              ? "Wallet Connected"
              : "Connect Starknet Wallet"}
        </button>
        <button type="button" className="secondary" disabled={isBusy} onClick={onRefreshSnapshot}>
          Refresh Snapshot
        </button>
        <button type="button" className="secondary" disabled={false} onClick={onSyncPendingNotes}>
          {pendingAction === "sync-pending-notes" ? "Syncing Notes..." : "Sync Pending Notes"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={isBusy}
          onClick={onRefreshOnchainHealth}
        >
          Refresh Onchain Health
        </button>
        {pendingAction ? (
          <button type="button" className="secondary" onClick={onResetBusyState}>
            Reset Busy State
          </button>
        ) : null}
      </div>
      <p className="status" role="status" aria-live="polite" aria-atomic="true">
        Status: <code>{status}</code>
      </p>
      <div className="actions">
        <span className={`pill ${walletAddress ? "ok" : "warn"}`}>
          {walletAddress ? `Wallet ${walletAddressShort ?? walletAddress}` : "Demo-only mode"}
        </span>
        {pendingAction ? <span className="pill warn">Action in progress</span> : null}
        <span className="pill ok">Groth16 proof service wired</span>
        <span className={`pill ${hasLiveDeploymentConfig ? "ok" : "warn"}`}>
          {hasLiveDeploymentConfig ? "Live Sepolia contracts configured" : "Missing contract env vars"}
        </span>
        <span className={`pill ${onchainSubmissionEnabled ? "ok" : "warn"}`}>
          {onchainSubmissionEnabled ? "Onchain tx enabled" : "Local-only actions"}
        </span>
        <span className={`pill ${pendingDepositSyncCount > 0 ? "warn" : "ok"}`}>
          {pendingDepositSyncCount > 0 ? `${pendingDepositSyncCount} pending note sync` : "Notes synced"}
        </span>
      </div>
    </section>
  );
}

interface FlowStepLike {
  id: string;
  label: string;
  done: boolean;
  optional?: boolean;
  helper: string;
}

interface FlowGuideCardProps {
  completedFlowSteps: number;
  totalFlowSteps: number;
  nextFlowHint: string;
  flowSteps: FlowStepLike[];
}

export function FlowGuideCard({
  completedFlowSteps,
  totalFlowSteps,
  nextFlowHint,
  flowSteps,
}: FlowGuideCardProps) {
  return (
    <section className="card w-4">
      <h2>Flow Guide</h2>
      <p>
        <code>{completedFlowSteps}</code> / <code>{totalFlowSteps}</code> steps completed
      </p>
      <p>{nextFlowHint}</p>
      <ol className="step-list">
        {flowSteps.map((step, index) => (
          <li
            className={`step-item ${step.done ? "done" : ""} ${step.optional ? "optional" : ""}`}
            key={step.id}
          >
            <span className={`step-index ${step.done ? "done" : ""}`}>{step.done ? "✓" : index + 1}</span>
            <div className="step-copy">
              <p className="step-title">
                {step.label} {step.optional ? <span className="pill warn">Optional</span> : null}
              </p>
              <p className="step-helper">{step.helper}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface ActivityEntryLike {
  id: string;
  timestamp: string;
  tone: ActivityToneLike;
  category: ActivityCategoryLike;
  message: string;
}

interface ActivityGroupLike {
  category: ActivityCategoryLike;
  items: ActivityEntryLike[];
}

interface RecentActivityCardProps {
  activityFeed: ActivityEntryLike[];
  activityFilter: ActivityFilterLike;
  onActivityFilterChange: (value: ActivityFilterLike) => void;
  activityCategoryOrder: ActivityCategoryLike[];
  activityCategoryLabel: Record<ActivityCategoryLike, string>;
  activityCounts: Record<ActivityCategoryLike, number>;
  activeActivityCount: number;
  visibleActivityGroups: ActivityGroupLike[];
  nextFlowHint: string;
  formatTimestamp: (value: string | undefined) => string;
}

export function RecentActivityCard({
  activityFeed,
  activityFilter,
  onActivityFilterChange,
  activityCategoryOrder,
  activityCategoryLabel,
  activityCounts,
  activeActivityCount,
  visibleActivityGroups,
  nextFlowHint,
  formatTimestamp,
}: RecentActivityCardProps) {
  return (
    <section className="card">
      <h2>Recent Activity</h2>
      <p>Last wallet events and status changes, newest first.</p>
      <div className="timeline-toolbar" role="toolbar" aria-label="Filter activity categories">
        <button
          type="button"
          className={`chip-button ${activityFilter === "all" ? "active" : ""}`}
          aria-pressed={activityFilter === "all"}
          onClick={() => onActivityFilterChange("all")}
        >
          All <span className="chip-count">{activityFeed.length}</span>
        </button>
        {activityCategoryOrder.map((category) => (
          <button
            type="button"
            key={category}
            className={`chip-button ${activityFilter === category ? "active" : ""}`}
            aria-pressed={activityFilter === category}
            onClick={() => onActivityFilterChange(category)}
          >
            {activityCategoryLabel[category]} <span className="chip-count">{activityCounts[category]}</span>
          </button>
        ))}
      </div>
      {activityFeed.length === 0 ? (
        <article className="note empty-state">
          <p>
            <strong>No activity yet.</strong>
          </p>
          <p>{nextFlowHint}</p>
        </article>
      ) : activeActivityCount === 0 ? (
        <article className="note empty-state">
          <p>
            <strong>
              No {activityFilter === "all" ? "activity" : activityCategoryLabel[activityFilter]} events yet.
            </strong>
          </p>
          <p>Try another filter or continue the flow to generate events.</p>
        </article>
      ) : (
        <div className="timeline-groups">
          {visibleActivityGroups.map((group) => (
            <section className="timeline-group" key={group.category}>
              <div className="timeline-group-head">
                <h3>{activityCategoryLabel[group.category]}</h3>
                <span className="pill ok">{group.items.length}</span>
              </div>
              <ol className="timeline-list">
                {group.items.map((entry) => (
                  <li className="timeline-item" key={entry.id}>
                    <span className={`timeline-dot ${entry.tone}`} aria-hidden="true" />
                    <div className="timeline-copy">
                      <p>{entry.message}</p>
                      <p className="timeline-time">
                        <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

interface WalletNotesCardProps {
  snapshotError: unknown;
  availableNotes: ShieldedNote[];
  nextFlowHint: string;
  pendingDepositSyncCount: number;
  onchainSubmissionEnabled: boolean;
  isBusy: boolean;
  pendingAction: PendingActionLike;
  depositPendingLabel: string;
  depositIdleLabel: string;
  onSubmitDeposit: () => void;
  onSyncPendingNotes: () => void;
  short: (value: string, size?: number) => string;
  formatTimestamp: (value: string | undefined) => string;
}

export function WalletNotesCard({
  snapshotError,
  availableNotes,
  nextFlowHint,
  pendingDepositSyncCount,
  onchainSubmissionEnabled,
  isBusy,
  pendingAction,
  depositPendingLabel,
  depositIdleLabel,
  onSubmitDeposit,
  onSyncPendingNotes,
  short,
  formatTimestamp,
}: WalletNotesCardProps) {
  return (
    <section className="card w-8">
      <h2>Wallet Notes</h2>
      {snapshotError ? (
        <p>
          Wallet snapshot error:{" "}
          <code>{snapshotError instanceof Error ? snapshotError.message : "unknown error"}</code>
        </p>
      ) : null}
      <div className="stack">
        {availableNotes.length === 0 ? (
          <article className="note empty-state">
            <p>
              <strong>No private notes yet.</strong>
            </p>
            <p>{nextFlowHint}</p>
            {pendingDepositSyncCount > 0 ? (
              <p>
                You have <code>{pendingDepositSyncCount}</code> pending note sync item(s). Try syncing before
                recovery.
              </p>
            ) : (
              <p>
                {onchainSubmissionEnabled
                  ? "Start by depositing onchain, then the wallet will sync the private note locally."
                  : "Start by minting a demo note locally to practice the private flow."}
              </p>
            )}
            <div className="actions">
              <button type="button" className="accent" disabled={isBusy} onClick={onSubmitDeposit}>
                {pendingAction === "deposit" ? depositPendingLabel : depositIdleLabel}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={isBusy}
                onClick={onSyncPendingNotes}
              >
                {pendingAction === "sync-pending-notes" ? "Syncing Notes..." : "Sync Pending Notes"}
              </button>
            </div>
            <p className="empty-state-footnote">
              If an onchain deposit succeeded but notes still do not appear, use the recovery tools in the
              Deposit section.
            </p>
          </article>
        ) : (
          availableNotes.map((note) => (
            <article className="note" key={note.noteId}>
              <p>
                <strong>{note.asset}</strong> amount hidden onchain
              </p>
              <p>
                Commitment: <code>{short(note.commitment, 12)}</code>
              </p>
              <p>
                Amount (local decrypt): <code>{note.amount}</code>
              </p>
              <p>
                Created: <code>{formatTimestamp(note.createdAt)}</code>
              </p>
              <p>
                State:{" "}
                <span className={`pill ${note.spentAt ? "bad" : "ok"}`}>{note.spentAt ? "spent" : "spendable"}</span>
              </p>
              {note.spentAt ? (
                <p>
                  Spent at: <code>{formatTimestamp(note.spentAt)}</code>
                </p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

interface OnchainHealthLike {
  loading: boolean;
  adapterMockMode: boolean | null;
  adapterVerifierAddress: string | null;
  error: string | null;
}

interface DeploymentEntryLike {
  label: string;
  address: string | null;
}

interface DiagnosticsCardProps {
  rootData?: { root: string; commitmentCount: number };
  rootError: unknown;
  onchainHealth: OnchainHealthLike;
  digestRegistrationCapable: boolean;
  expectedVerifierAdmin: string | null;
  walletIsExpectedVerifierAdmin: boolean | null;
  adapterVerifierMismatch: boolean;
  network: string;
  defaultAsset: string;
  registerTestVectorDigests: boolean;
  deploymentEntries: DeploymentEntryLike[];
  xverseAddress: string;
  onXverseAddressChange: (value: string) => void;
  xverseLoading: boolean;
  xverseError: unknown;
  xverseData: unknown;
}

export function DiagnosticsCard({
  rootData,
  rootError,
  onchainHealth,
  digestRegistrationCapable,
  expectedVerifierAdmin,
  walletIsExpectedVerifierAdmin,
  adapterVerifierMismatch,
  network,
  defaultAsset,
  registerTestVectorDigests,
  deploymentEntries,
  xverseAddress,
  onXverseAddressChange,
  xverseLoading,
  xverseError,
  xverseData,
}: DiagnosticsCardProps) {
  return (
    <section className="card">
      <details className="diag-details">
        <summary className="diag-summary">
          <span>Advanced / Diagnostics</span>
          <span className={`pill ${rootError || onchainHealth.error ? "warn" : "ok"}`}>
            {rootError || onchainHealth.error ? "Attention needed" : "Healthy snapshot"}
          </span>
        </summary>
        <p className="diag-summary-copy">
          Operational state, contract configuration, and optional Xverse context for demo/debugging.
        </p>
        <div className="diag-grid">
          <section className="diag-section">
            <h3>Shielded Tree</h3>
            <p>
              Current root <code>{rootData?.root ?? "0x0"}</code>
            </p>
            <p>
              Commitments inserted <code>{rootData?.commitmentCount ?? 0}</code>
            </p>
            {rootError ? (
              <p>
                Root sync error: <code>{rootError instanceof Error ? rootError.message : "unknown error"}</code>
              </p>
            ) : null}
          </section>

          <section className="diag-section">
            <h3>Onchain Health</h3>
            <div className="actions">
              <span className={`pill ${onchainHealth.loading ? "warn" : "ok"}`}>
                {onchainHealth.loading ? "Checking adapter..." : "Health snapshot"}
              </span>
              <span className={`pill ${digestRegistrationCapable ? "ok" : "warn"}`}>
                {digestRegistrationCapable ? "Digest registration ready" : "Digest registration blocked"}
              </span>
            </div>
            <p>
              Adapter mock mode{" "}
              <code>
                {onchainHealth.adapterMockMode === null
                  ? "unknown"
                  : onchainHealth.adapterMockMode
                    ? "enabled"
                    : "disabled"}
              </code>
            </p>
            <p>
              Adapter verifier <code>{onchainHealth.adapterVerifierAddress ?? "unavailable (connect wallet)"}</code>
            </p>
            <p>
              Expected admin <code>{expectedVerifierAdmin ?? "not configured"}</code>
            </p>
            <p>
              Connected wallet admin check{" "}
              <code>
                {walletIsExpectedVerifierAdmin === null
                  ? "unknown"
                  : walletIsExpectedVerifierAdmin
                    ? "match"
                    : "mismatch"}
              </code>
            </p>
            {adapterVerifierMismatch ? (
              <p>
                <code>VerifierAdapter.get_verifier()</code> does not match{" "}
                <code>NEXT_PUBLIC_EXTERNAL_VERIFIER_ADDRESS</code>.
              </p>
            ) : null}
            {onchainHealth.error ? (
              <p>
                Adapter read error: <code>{onchainHealth.error}</code>
              </p>
            ) : null}
          </section>

          <section className="diag-section">
            <h3>Sepolia Contract Config</h3>
            <p>
              Network <code>{network}</code>
            </p>
            <p>
              Default asset <code>{defaultAsset}</code>
            </p>
            <p>
              Test-vector digest auto-register <code>{registerTestVectorDigests ? "enabled" : "disabled"}</code>
            </p>
            <p>
              Test-vector admin <code>{expectedVerifierAdmin ?? "not configured"}</code>
            </p>
            <div className="stack">
              {deploymentEntries.map((entry) => (
                <article className="note address" key={entry.label}>
                  <p>
                    <strong>{entry.label}</strong>
                  </p>
                  <p>
                    <code>{entry.address ?? "Not configured"}</code>
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="diag-section">
            <h3>Xverse BTC Context</h3>
            <p>Optional read integration for Bitcoin narrative and sponsor alignment.</p>
            <div className="field">
              <label htmlFor="xverse-address">Bitcoin Address</label>
              <input
                id="xverse-address"
                value={xverseAddress}
                spellCheck={false}
                onChange={(event) => onXverseAddressChange(event.target.value)}
                placeholder="bc1..."
              />
            </div>
            {xverseLoading ? <p>Loading...</p> : null}
            {xverseError ? (
              <p>
                Xverse lookup error:{" "}
                <code>{xverseError instanceof Error ? xverseError.message : "unknown error"}</code>
              </p>
            ) : null}
            {xverseData ? (
              <pre className="json-dump">{JSON.stringify(xverseData, null, 2)}</pre>
            ) : (
              <p>Add an address to load Xverse-derived context.</p>
            )}
          </section>
        </div>
      </details>
    </section>
  );
}

interface DepositCardProps {
  onchainSubmissionEnabled: boolean;
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  isBusy: boolean;
  pendingAction: PendingActionLike;
  depositPendingLabel: string;
  depositIdleLabel: string;
  onSubmitDeposit: () => void;
  recoveryTxHash: string;
  onRecoveryTxHashChange: (value: string) => void;
  recoveryAmount: string;
  onRecoveryAmountChange: (value: string) => void;
  onRecoverDeposit: () => void;
}

