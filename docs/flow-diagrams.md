# Flow Diagrams

This file contains project flow diagrams for Sssh BTC Wallet.

## 1. System Architecture Flow

```mermaid
flowchart LR
  User[User] --> Web[Next.js Wallet App]
  Wallet[Starknet Wallet] --> Web

  Web --> Indexer[Indexer API]
  Web --> Prover[Prover API]
  Web --> Xverse[Optional Xverse BTC Context\nRead-only]

  Prover --> Circuits[Circom Circuits]
  Prover --> Snarkjs[snarkjs Groth16]

  Web --> ShieldedPool[ShieldedPool Contract]
  Web --> Registry[PaymentRequestRegistry Contract]
  ShieldedPool --> VerifierAdapter[VerifierAdapter Contract]
  VerifierAdapter --> ExternalVerifier[External Verifier / TestVectorVerifier]
```

## 2. Private Transfer Flow (Demo Path)

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant W as Web App
  participant I as Indexer API
  participant P as Prover API
  participant S as ShieldedPool (Starknet)
  participant V as VerifierAdapter

  U->>W: Enter transfer details (recipient, amount, fee)
  W->>I: Fetch wallet snapshot + root
  I-->>W: Notes / root / nullifier state
  W->>P: POST /proof/transfer
  P-->>W: Groth16 proof bundle
  W->>S: submit private transfer
  S->>V: verify_proof(proof, public_inputs)
  V-->>S: valid / invalid
  S-->>W: tx hash / result
  W->>I: POST /transfers/private (sync indexed state)
  I-->>W: updated notes / nullifiers / commitments
```

## 3. Withdrawal Flow (Current Demo Semantics)

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant W as Web App
  participant I as Indexer API
  participant P as Prover API
  participant S as ShieldedPool (Starknet)
  participant T as Starknet ERC20 Asset

  Note over U,T: Current demo withdraw settles a Starknet BTC-like asset (not native Bitcoin L1)

  U->>W: Request withdraw amount
  W->>I: Fetch root + spendable notes
  I-->>W: Snapshot
  W->>P: POST /proof/withdraw
  P-->>W: Withdraw proof bundle
  W->>S: submit withdraw transaction
  S->>T: transfer(recipient, amount)
  T-->>S: success
  S-->>W: tx hash / result
  W->>I: POST /withdrawals/private (sync local/indexed state)
  I-->>W: spent note + updated snapshot
```

## 4. Optional Bitcoin Context (Read-only Xverse)

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant W as Web App
  participant API as Next.js API Route
  participant X as Xverse API

  U->>W: Enter Bitcoin address in Xverse context panel
  W->>API: GET /api/xverse-btc-context?address=...
  API->>X: Fetch balances/context (optional API key)
  X-->>API: JSON payload
  API-->>W: Read-only context response
  W-->>U: Display context (no signing, no settlement)
```
