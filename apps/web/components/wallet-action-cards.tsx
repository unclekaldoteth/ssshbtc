type PendingActionLike = string | null;

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

export function DepositCard({
  onchainSubmissionEnabled,
  depositAmount,
  onDepositAmountChange,
  isBusy,
  pendingAction,
  depositPendingLabel,
  depositIdleLabel,
  onSubmitDeposit,
  recoveryTxHash,
  onRecoveryTxHashChange,
  recoveryAmount,
  onRecoveryAmountChange,
  onRecoverDeposit,
}: DepositCardProps) {
  return (
    <section className="card w-6">
      <h2>Deposit</h2>
      <p>
        {onchainSubmissionEnabled
          ? "This will submit `approve + deposit` to `ShieldedPool`, then sync the private note into your local wallet view."
          : "This mints a local demo note in the indexer (no Starknet transaction) so you can test the private flow end-to-end."}
      </p>
      <div className="field">
        <label htmlFor="deposit-amount">Amount (sats unit)</label>
        <input
          id="deposit-amount"
          value={depositAmount}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          onChange={(event) => onDepositAmountChange(event.target.value)}
        />
      </div>
      <button type="button" className="accent" disabled={isBusy} onClick={onSubmitDeposit}>
        {pendingAction === "deposit" ? depositPendingLabel : depositIdleLabel}
      </button>
      <p>
        If wallet notes stay empty after a successful onchain deposit, sync pending notes first. If that
        still fails, recover from transaction hash.
      </p>
      <div className="field">
        <label htmlFor="recover-tx-hash">Deposit Tx Hash (recovery)</label>
        <input
          id="recover-tx-hash"
          value={recoveryTxHash}
          onChange={(event) => onRecoveryTxHashChange(event.target.value)}
          spellCheck={false}
          placeholder="0x..."
        />
      </div>
      <div className="field">
        <label htmlFor="recover-amount">Recovered Amount (optional)</label>
        <input
          id="recover-amount"
          value={recoveryAmount}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          onChange={(event) => onRecoveryAmountChange(event.target.value)}
        />
      </div>
      <button type="button" className="secondary" disabled={false} onClick={onRecoverDeposit}>
        {pendingAction === "recover-deposit" ? "Recovering Deposit..." : "Recover Deposit from Tx Hash"}
      </button>
    </section>
  );
}

type CopyStateLike = "idle" | "copied" | "failed";

interface PendingRequestLike {
  requestHash: string;
  receiverStealthPubkey: string;
  expiry: number;
  memo?: string | null;
}

interface PaymentRequestCardProps {
  requestAmount: string;
  onRequestAmountChange: (value: string) => void;
  requestMemo: string;
  onRequestMemoChange: (value: string) => void;
  isBusy: boolean;
  pendingAction: PendingActionLike;
  onCreateRequest: () => void;
  requestShareHash: string;
  requestShareUrl: string;
  shareHashCopyState: CopyStateLike;
  shareLinkCopyState: CopyStateLike;
  onCopyRequestHash: () => void;
  onCopyShareLink: () => void;
  pendingRequests: ReadonlyArray<PendingRequestLike>;
  trimmedWalletHint: string;
  short: (value: string, size?: number) => string;
  formatUnixTimestampSeconds: (value: number | undefined) => string;
  onFillTransferFormFromRequest: (request: PendingRequestLike) => void;
  onLoadRequestStatus: (requestHash: string) => void;
}

export function PaymentRequestCard({
  requestAmount,
  onRequestAmountChange,
  requestMemo,
  onRequestMemoChange,
  isBusy,
  pendingAction,
  onCreateRequest,
  requestShareHash,
  requestShareUrl,
  shareHashCopyState,
  shareLinkCopyState,
  onCopyRequestHash,
  onCopyShareLink,
  pendingRequests,
  trimmedWalletHint,
  short,
  formatUnixTimestampSeconds,
  onFillTransferFormFromRequest,
  onLoadRequestStatus,
}: PaymentRequestCardProps) {
  return (
    <section className="card w-6">
      <h2>Private Payment Request</h2>
      <div className="field">
        <label htmlFor="request-amount">Requested Amount</label>
        <input
          id="request-amount"
          value={requestAmount}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          onChange={(event) => onRequestAmountChange(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="request-memo">Memo</label>
        <input id="request-memo" value={requestMemo} onChange={(event) => onRequestMemoChange(event.target.value)} />
      </div>
      <button type="button" disabled={isBusy} onClick={onCreateRequest}>
        {pendingAction === "create-request" ? "Creating Payment Request..." : "Create Private Payment Request"}
      </button>
      {requestShareHash ? (
        <div>
          <p>Request hash:</p>
          <div className="share-link-actions">
            <button type="button" className="secondary" onClick={onCopyRequestHash}>
              {shareHashCopyState === "copied" ? "Copied" : "Copy Hash"}
            </button>
            {shareHashCopyState === "copied" ? <span className="pill ok">Copied</span> : null}
            {shareHashCopyState === "failed" ? <span className="pill bad">Copy failed</span> : null}
          </div>
          <code className="share-link">{requestShareHash}</code>
        </div>
      ) : null}
      {requestShareUrl ? (
        <div>
          <p>Share link:</p>
          <div className="share-link-actions">
            <button type="button" className="secondary" onClick={onCopyShareLink}>
              {shareLinkCopyState === "copied" ? "Copied" : "Copy Link"}
            </button>
            {shareLinkCopyState === "copied" ? <span className="pill ok">Copied</span> : null}
            {shareLinkCopyState === "failed" ? <span className="pill bad">Copy failed</span> : null}
          </div>
          <code className="share-link">{requestShareUrl}</code>
        </div>
      ) : null}
      <div className="stack">
        <h3>Pending Requests for This Wallet</h3>
        {pendingRequests.length === 0 ? (
          <article className="note empty-state">
            <p>
              <strong>No pending requests for this wallet hint.</strong>
            </p>
            <p>
              Inbox filters by receiver = <code>{trimmedWalletHint || "n/a"}</code>.
            </p>
            <p>Create a private payment request above, or paste a request hash into the transfer form.</p>
          </article>
        ) : (
          pendingRequests.map((request) => (
            <article className="note" key={request.requestHash}>
              <p>
                Request <code>{short(request.requestHash, 12)}</code>
              </p>
              <p>
                Receiver <code>{request.receiverStealthPubkey}</code>
              </p>
              <p>
                Expires <code>{formatUnixTimestampSeconds(request.expiry)}</code>
              </p>
              {request.memo ? (
                <p>
                  Memo <code>{request.memo}</code>
                </p>
              ) : null}
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={isBusy}
                  onClick={() => onFillTransferFormFromRequest(request)}
                >
                  Fill Transfer Form
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={isBusy}
                  onClick={() => onLoadRequestStatus(request.requestHash)}
                >
                  Load Status
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

interface TransferFormLike {
  recipientHint: string;
  amount: string;
  fee: string;
  requestHash: string;
}

interface TransferProgressLike {
  stage: string;
  percent: number;
  message: string;
  txHash?: string | null;
  updatedAt?: string | null;
}

interface PrivateTransferCardProps {
  spendableCount: number;
  isBusy: boolean;
  depositIdleLabel: string;
  onStartDeposit: () => void;
  transfer: TransferFormLike;
  onRecipientHintChange: (value: string) => void;
  onTransferAmountChange: (value: string) => void;
  onTransferFeeChange: (value: string) => void;
  onTransferRequestHashChange: (value: string) => void;
  onNormalizeTransferRequestHash: () => void;
  onLoadAttachedRequestStatus: () => void;
  pendingAction: PendingActionLike;
  transferPendingLabel: string;
  transferIdleLabel: string;
  onSubmitTransfer: () => void;
  transferProgress: TransferProgressLike;
  onClearTransferProgress: () => void;
}

export function PrivateTransferCard({
  spendableCount,
  isBusy,
  depositIdleLabel,
  onStartDeposit,
  transfer,
  onRecipientHintChange,
  onTransferAmountChange,
  onTransferFeeChange,
  onTransferRequestHashChange,
  onNormalizeTransferRequestHash,
  onLoadAttachedRequestStatus,
  pendingAction,
  transferPendingLabel,
  transferIdleLabel,
  onSubmitTransfer,
  transferProgress,
  onClearTransferProgress,
}: PrivateTransferCardProps) {
  return (
    <section className="card w-6">
      <h2>Private Transfer</h2>
      {spendableCount === 0 ? (
        <article className="note empty-state">
          <p>
            <strong>No spendable notes yet.</strong>
          </p>
          <p>Start with a deposit so the prover has an input note for the transfer.</p>
          <div className="actions">
            <button type="button" className="secondary" disabled={isBusy} onClick={onStartDeposit}>
              {depositIdleLabel}
            </button>
          </div>
        </article>
      ) : null}
      <div className="field">
        <label htmlFor="recipient-hint">Recipient Wallet Hint</label>
        <input
          id="recipient-hint"
          value={transfer.recipientHint}
          onChange={(event) => onRecipientHintChange(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="transfer-amount">Amount</label>
        <input
          id="transfer-amount"
          value={transfer.amount}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          onChange={(event) => onTransferAmountChange(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="transfer-fee">Fee</label>
        <input
          id="transfer-fee"
          value={transfer.fee}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          onChange={(event) => onTransferFeeChange(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="transfer-request-hash">Attach Request Hash (optional)</label>
        <input
          id="transfer-request-hash"
          value={transfer.requestHash}
          onChange={(event) => onTransferRequestHashChange(event.target.value)}
          spellCheck={false}
          onBlur={onNormalizeTransferRequestHash}
        />
      </div>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={isBusy || transfer.requestHash.trim().length === 0}
          onClick={onLoadAttachedRequestStatus}
        >
          {pendingAction === "load-request" ? "Loading Request..." : "Load Request Status"}
        </button>
      </div>
      <button type="button" disabled={isBusy} onClick={onSubmitTransfer}>
        {pendingAction === "transfer" ? transferPendingLabel : transferIdleLabel}
      </button>
      <article className="note transfer-progress">
        <p>
          Transfer stage <code>{transferProgress.stage}</code>
        </p>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={transferProgress.percent}
        >
          <div
            className={`progress-fill ${transferProgress.stage === "failed" ? "error" : transferProgress.stage === "completed" ? "ok" : ""}`}
            style={{ width: `${Math.max(0, Math.min(100, transferProgress.percent))}%` }}
          />
        </div>
        <p>
          <code>{transferProgress.percent}%</code> {transferProgress.message}
        </p>
        {transferProgress.txHash ? (
          <p>
            Tx hash <code>{transferProgress.txHash}</code>
          </p>
        ) : null}
        {transferProgress.updatedAt ? (
          <p>
            Updated <code>{new Date(transferProgress.updatedAt).toLocaleTimeString()}</code>
          </p>
        ) : null}
        {transferProgress.stage !== "idle" ? (
          <button type="button" className="secondary" onClick={onClearTransferProgress}>
            Clear Transfer Progress
          </button>
        ) : null}
      </article>
    </section>
  );
}

interface PoolLiquidityLike {
  amount: string | null;
  loading: boolean;
  updatedAt?: string | null;
  error?: string | null;
}

interface WithdrawCardProps {
  withdrawAmount: string;
  onWithdrawAmountChange: (value: string) => void;
  withdrawFee: string;
  onWithdrawFeeChange: (value: string) => void;
  poolLiquidity: PoolLiquidityLike;
  withdrawPoolLiquidityExceeded: boolean;
  withdrawFeePreview: unknown | null;
  withdrawCandidateNotesCount: number;
  withdrawEffectiveValidAmountsCount: number;
  withdrawMinAmount: string | null;
  withdrawMaxAmount: string | null;
  withdrawValidAmountsPreview: string[];
  withdrawValidAmountsRemaining: number;
  withdrawExactMatchFilteredByLiquidity: boolean;
  withdrawExactMatchOnlyPreview: string[];
  withdrawValidAmountsCount: number;
  isBusy: boolean;
  pendingAction: PendingActionLike;
  onRefreshPoolLiquidity: () => void;
  onSubmitWithdraw: () => void;
  withdrawPendingLabel: string;
  withdrawIdleLabel: string;
  withdrawProgress: TransferProgressLike;
  onClearWithdrawProgress: () => void;
}

export function WithdrawCard({
  withdrawAmount,
  onWithdrawAmountChange,
  withdrawFee,
  onWithdrawFeeChange,
  poolLiquidity,
  withdrawPoolLiquidityExceeded,
  withdrawFeePreview,
  withdrawCandidateNotesCount,
  withdrawEffectiveValidAmountsCount,
  withdrawMinAmount,
  withdrawMaxAmount,
  withdrawValidAmountsPreview,
  withdrawValidAmountsRemaining,
  withdrawExactMatchFilteredByLiquidity,
  withdrawExactMatchOnlyPreview,
  withdrawValidAmountsCount,
  isBusy,
  pendingAction,
  onRefreshPoolLiquidity,
  onSubmitWithdraw,
  withdrawPendingLabel,
  withdrawIdleLabel,
  withdrawProgress,
  onClearWithdrawProgress,
}: WithdrawCardProps) {
  return (
    <section className="card w-6">
      <h2>Withdraw</h2>
      <p>
        Build and submit a private withdrawal proof from one spendable note. Current circuit requires exact
        match: <code>withdraw amount + fee = note amount</code>.
      </p>
      <div className="field">
        <label htmlFor="withdraw-amount">Withdraw Amount</label>
        <input
          id="withdraw-amount"
          value={withdrawAmount}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          onChange={(event) => onWithdrawAmountChange(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="withdraw-fee">Withdraw Fee</label>
        <input
          id="withdraw-fee"
          value={withdrawFee}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          onChange={(event) => onWithdrawFeeChange(event.target.value)}
        />
      </div>
      <article className="note withdraw-limits">
        <p>
          Withdraw limits for current fee <code>{withdrawFee.trim() || "0"}</code>:
        </p>
        <p>
          Pool liquidity (onchain):{" "}
          <code>{poolLiquidity.amount ?? (poolLiquidity.loading ? "loading..." : "unknown")}</code>
        </p>
        {poolLiquidity.updatedAt ? (
          <p>
            Liquidity updated <code>{new Date(poolLiquidity.updatedAt).toLocaleTimeString()}</code>
          </p>
        ) : null}
        {poolLiquidity.error ? (
          <p>
            Liquidity read error: <code>{poolLiquidity.error}</code>
          </p>
        ) : null}
        {withdrawPoolLiquidityExceeded ? (
          <p>
            <span className="pill bad">Requested withdraw amount exceeds pool liquidity.</span>
          </p>
        ) : null}
        {withdrawFeePreview === null ? (
          <>
            <p>Enter a whole-number fee to calculate valid withdraw amounts.</p>
            <p>
              Minimum amount: <code>N/A</code>
            </p>
            <p>
              Maximum amount: <code>N/A</code>
            </p>
            <p>
              Exact valid amounts: <code>none</code>
            </p>
          </>
        ) : withdrawCandidateNotesCount === 0 ? (
          <>
            <p>No spendable note is available yet. Deposit first, then refresh snapshot.</p>
            <p>
              Minimum amount: <code>N/A</code>
            </p>
            <p>
              Maximum amount: <code>N/A</code>
            </p>
            <p>
              Exact valid amounts: <code>none</code>
            </p>
          </>
        ) : withdrawEffectiveValidAmountsCount === 0 ? (
          <>
            <p>No valid withdraw amount for this fee. Lower fee or use another note amount.</p>
            <p>
              Minimum amount: <code>N/A</code>
            </p>
            <p>
              Maximum amount: <code>N/A</code>
            </p>
            <p>
              Exact valid amounts: <code>none</code>
            </p>
          </>
        ) : (
          <>
            <p>
              Minimum amount: <code>{withdrawMinAmount}</code>
            </p>
            <p>
              Maximum amount: <code>{withdrawMaxAmount}</code>
            </p>
            <p>
              Exact valid amounts: <code>{withdrawValidAmountsPreview.join(", ")}</code>
              {withdrawValidAmountsRemaining > 0 ? ` (+${withdrawValidAmountsRemaining} more)` : ""}
            </p>
          </>
        )}
        {withdrawExactMatchFilteredByLiquidity ? (
          <p>
            Exact note-match amounts before liquidity filter:{" "}
            <code>{withdrawExactMatchOnlyPreview.join(", ")}</code>
            {withdrawValidAmountsCount > withdrawExactMatchOnlyPreview.length
              ? ` (+${withdrawValidAmountsCount - withdrawExactMatchOnlyPreview.length} more)`
              : ""}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="secondary" disabled={isBusy} onClick={onRefreshPoolLiquidity}>
            {pendingAction === "refresh-liquidity" ? "Refreshing..." : "Refresh Pool Liquidity"}
          </button>
        </div>
      </article>
      <button type="button" className="secondary" disabled={isBusy} onClick={onSubmitWithdraw}>
        {pendingAction === "withdraw" ? withdrawPendingLabel : withdrawIdleLabel}
      </button>
      <article className="note transfer-progress">
        <p>
          Withdraw stage <code>{withdrawProgress.stage}</code>
        </p>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={withdrawProgress.percent}
        >
          <div
            className={`progress-fill ${withdrawProgress.stage === "failed" ? "error" : withdrawProgress.stage === "completed" ? "ok" : ""}`}
            style={{ width: `${Math.max(0, Math.min(100, withdrawProgress.percent))}%` }}
          />
        </div>
        <p>
          <code>{withdrawProgress.percent}%</code> {withdrawProgress.message}
        </p>
        {withdrawProgress.txHash ? (
          <p>
            Tx hash <code>{withdrawProgress.txHash}</code>
          </p>
        ) : null}
        {withdrawProgress.updatedAt ? (
          <p>
            Updated <code>{new Date(withdrawProgress.updatedAt).toLocaleTimeString()}</code>
          </p>
        ) : null}
        {withdrawProgress.stage !== "idle" ? (
          <button type="button" className="secondary" onClick={onClearWithdrawProgress}>
            Clear Withdraw Progress
          </button>
        ) : null}
      </article>
    </section>
  );
}
