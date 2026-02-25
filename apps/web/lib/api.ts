import type {
  NoteCiphertext,
  PaymentRequest,
  ProofBundle,
  PublicInputsTransfer,
  PublicInputsWithdraw,
  ShieldedNote,
  TransferExecutionRequest,
  TransferExecutionResult,
  TransferProofRequest,
  WalletStateSnapshot,
  WithdrawExecutionRequest,
  WithdrawExecutionResult,
  WithdrawProofRequest,
} from "@sssh-btc/shared";

function normalizeServiceBaseUrl(
  rawValue: string | undefined,
  fallback: string,
  envName: string
): string {
  const trimmed = rawValue?.trim();
  const candidate = trimmed
    ? /^(https?:)?\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    : fallback;

  try {
    const url = new URL(candidate);
    return url.origin;
  } catch {
    if (typeof window !== "undefined") {
      // Surface misconfigured env vars in the browser console without breaking local fallback.
      console.warn(`Invalid ${envName} value "${rawValue}". Falling back to ${fallback}.`);
    }
    return fallback;
  }
}

const INDEXER_URL = normalizeServiceBaseUrl(
  process.env.NEXT_PUBLIC_INDEXER_URL,
  "http://localhost:4100",
  "NEXT_PUBLIC_INDEXER_URL"
);
const PROVER_URL = normalizeServiceBaseUrl(
  process.env.NEXT_PUBLIC_PROVER_URL,
  "http://localhost:4200",
  "NEXT_PUBLIC_PROVER_URL"
);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error(
        `${response.status} ${response.statusText}: backend URL is misconfigured and returned HTML instead of JSON (${url})`
      );
    }
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  return (await response.json()) as T;
}

export function getIndexerUrl(path: string): string {
  return new URL(path, `${INDEXER_URL}/`).toString();
}

export function getProverUrl(path: string): string {
  return new URL(path, `${PROVER_URL}/`).toString();
}

export async function getTreeRoot(): Promise<{ root: string; commitmentCount: number }> {
  return request<{ root: string; commitmentCount: number }>(getIndexerUrl("/tree/root"));
}

export async function getWalletSnapshot(walletHint: string): Promise<WalletStateSnapshot> {
  return request<WalletStateSnapshot>(getIndexerUrl(`/wallet/${encodeURIComponent(walletHint)}/snapshot`));
}

export async function createMintedNote(input: {
  ownerHint: string;
  recipientHint: string;
  amount: string;
  asset: string;
}): Promise<{
  root: string;
  index: number;
  note: {
    commitment: string;
    amountCommitment: string;
    asset: string;
    amount: string;
    blinding: string;
    recipientHint: string;
  };
}> {
  return request<{
    root: string;
    index: number;
    note: {
      commitment: string;
      amountCommitment: string;
      asset: string;
      amount: string;
      blinding: string;
      recipientHint: string;
    };
  }>(getIndexerUrl("/demo/mint-note"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createTransferProof(
  input: TransferProofRequest
): Promise<
  ProofBundle<PublicInputsTransfer> & {
    derived: {
      outputBlindings: string[];
      outputCommitments: string[];
      inputNullifiers: string[];
    };
  }
> {
  return request<
    ProofBundle<PublicInputsTransfer> & {
      derived: {
        outputBlindings: string[];
        outputCommitments: string[];
        inputNullifiers: string[];
      };
    }
  >(getProverUrl("/proof/transfer"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createWithdrawProof(
  input: WithdrawProofRequest
): Promise<
  ProofBundle<PublicInputsWithdraw> & {
    derived: {
      amountCommitment: string;
      inputNullifiers: string[];
    };
  }
> {
  return request<
    ProofBundle<PublicInputsWithdraw> & {
      derived: {
        amountCommitment: string;
        inputNullifiers: string[];
      };
    }
  >(getProverUrl("/proof/withdraw"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function verifyProofBundle(
  proofBundle: ProofBundle<PublicInputsTransfer> | ProofBundle<PublicInputsWithdraw>
): Promise<{ valid: boolean; circuit: "transfer" | "withdraw" }> {
  return request<{ valid: boolean; circuit: "transfer" | "withdraw" }>(getProverUrl("/proof/verify"), {
    method: "POST",
    body: JSON.stringify({ proofBundle }),
  });
}

export async function executePrivateTransfer(
  input: TransferExecutionRequest
): Promise<TransferExecutionResult> {
  return request<TransferExecutionResult>(getIndexerUrl("/transfers/private"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function executePrivateWithdraw(
  input: WithdrawExecutionRequest
): Promise<WithdrawExecutionResult> {
  return request<WithdrawExecutionResult>(getIndexerUrl("/withdrawals/private"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function postNullifier(nullifier: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(getIndexerUrl("/nullifiers"), {
    method: "POST",
    body: JSON.stringify({ nullifier }),
  });
}

export async function ingestCommitment(input: unknown): Promise<{ root: string; index: number }> {
  return request<{ root: string; index: number }>(getIndexerUrl("/commitments"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface IngestCommitmentRequest {
  commitment: string;
  recipientHint: string;
  note: {
    ownerHint: string;
    asset: string;
    amount: string;
    blinding: string;
  };
  ciphertext: NoteCiphertext;
}

export async function ingestCommitmentTyped(
  input: IngestCommitmentRequest
): Promise<{ root: string; index: number }> {
  return request<{ root: string; index: number }>(getIndexerUrl("/commitments"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createPaymentRequest(
  input: Omit<PaymentRequest, "createdAt" | "paid" | "paidCommitmentRef">
): Promise<PaymentRequest> {
  return request<PaymentRequest>(getIndexerUrl("/payment-requests"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getPaymentRequest(requestHash: string): Promise<PaymentRequest> {
  return request<PaymentRequest>(getIndexerUrl(`/payment-requests/${encodeURIComponent(requestHash)}`));
}

export async function markPaymentRequestPaid(
  requestHash: string,
  commitmentRef: string
): Promise<PaymentRequest> {
  return request<PaymentRequest>(getIndexerUrl(`/payment-requests/${encodeURIComponent(requestHash)}/pay`), {
    method: "POST",
    body: JSON.stringify({ commitmentRef }),
  });
}

export async function markNoteSpent(
  walletHint: string,
  commitment: string,
  nullifier: string
): Promise<ShieldedNote> {
  return request<ShieldedNote>(getIndexerUrl("/notes/spend"), {
    method: "POST",
    body: JSON.stringify({ walletHint, commitment, nullifier }),
  });
}

export async function getXverseContext(address: string): Promise<unknown> {
  return request<unknown>(`/api/xverse-btc-context?address=${encodeURIComponent(address)}`);
}
