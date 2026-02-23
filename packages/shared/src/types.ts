export type FeltLike = string;

export interface ShieldedNote {
  noteId: string;
  ownerHint: string;
  asset: string;
  amount: string;
  blinding: string;
  commitment: FeltLike;
  nullifier?: FeltLike;
  createdAt: string;
  spentAt?: string;
}

export interface NoteCiphertext {
  commitment: FeltLike;
  recipientHint: string;
  ephemeralPubKey: string;
  ciphertext: string;
  nonce: string;
}

export interface PublicInputsTransfer {
  root: FeltLike;
  inputCommitments: FeltLike[];
  inputNullifiers: FeltLike[];
  outputCommitments: FeltLike[];
  feeCommitment: FeltLike;
  asset: FeltLike;
}

export interface PublicInputsWithdraw {
  root: FeltLike;
  inputCommitments: FeltLike[];
  inputNullifiers: FeltLike[];
  recipient: FeltLike;
  amountCommitment: FeltLike;
  feeCommitment: FeltLike;
  asset: FeltLike;
}

export interface ProofBundle<TPublicInputs> {
  proof: string[];
  publicInputs: TPublicInputs;
  scheme: "groth16";
  circuit: "transfer" | "withdraw";
  mock: boolean;
  proofData?: Record<string, unknown>;
  publicSignals?: string[];
}

export interface PaymentRequest {
  requestHash: FeltLike;
  receiverStealthPubkey: FeltLike;
  expiry: number;
  memo?: string;
  asset: FeltLike;
  amountCommitment: FeltLike;
  createdAt: string;
  paid: boolean;
  paidCommitmentRef?: FeltLike;
}

export interface WalletStateSnapshot {
  root: FeltLike;
  totalCommitments: number;
  knownNotes: ShieldedNote[];
  pendingRequests: PaymentRequest[];
  nullifierCount: number;
  lastSyncedAt: string;
}

export interface TransferProofRequest {
  root: FeltLike;
  inputNotes: Array<Pick<ShieldedNote, "commitment" | "amount" | "blinding">>;
  outputNotes: Array<Pick<ShieldedNote, "ownerHint" | "amount" | "blinding">>;
  feeAmount: string;
  asset: FeltLike;
  senderSecret: string;
}

export interface WithdrawProofRequest {
  root: FeltLike;
  inputNotes: Array<Pick<ShieldedNote, "commitment" | "amount" | "blinding">>;
  recipient: FeltLike;
  amount: string;
  feeAmount: string;
  asset: FeltLike;
  senderSecret: string;
}

export interface TransferExecutionRequest {
  senderHint: string;
  root: FeltLike;
  asset: FeltLike;
  feeAmount: string;
  inputNotes: Array<Pick<ShieldedNote, "commitment" | "amount" | "blinding">>;
  outputNotes: Array<Pick<ShieldedNote, "ownerHint" | "amount" | "blinding">>;
  proofBundle: ProofBundle<PublicInputsTransfer>;
  requestHash?: FeltLike;
}

export interface TransferExecutionResult {
  newRoot: FeltLike;
  nullifiers: FeltLike[];
  spentCommitments: FeltLike[];
  outputCommitments: FeltLike[];
  insertedCommitments: Array<{
    commitment: FeltLike;
    ownerHint: string;
    index: number;
  }>;
  paidRequestHash?: FeltLike;
}

export interface WithdrawExecutionRequest {
  senderHint: string;
  root: FeltLike;
  asset: FeltLike;
  recipient: FeltLike;
  withdrawAmount: string;
  feeAmount: string;
  inputNotes: Array<Pick<ShieldedNote, "commitment" | "amount" | "blinding">>;
  changeBlinding?: string;
  proofBundle: ProofBundle<PublicInputsWithdraw>;
}

export interface WithdrawExecutionResult {
  newRoot: FeltLike;
  nullifiers: FeltLike[];
  spentCommitments: FeltLike[];
  amountCommitment: FeltLike;
  changeCommitment?: FeltLike;
  recipient: FeltLike;
  withdrawAmount: string;
}
