# Protocol and API Specification

## Contract entrypoints

### ShieldedPool

- `deposit(asset, amount, commitment, encrypted_note)`
- `transact(proof, public_inputs, new_commitments, new_encrypted_notes, nullifiers, merkle_root, fee_asset, fee_amount_commitment)`
- `withdraw(proof, public_inputs, nullifiers, recipient_l2_or_l1, amount, amount_commitment, asset, merkle_root)`
- `register_view_key(pubkey)`
- `whitelist_asset(asset, enabled)`

### PaymentRequestRegistry

- `create_payment_request(request_hash, receiver_stealth_pubkey, expiry)`
- `mark_request_paid(request_hash, tx_commitment_ref)`

### VerifierAdapter

- `verify_proof(proof, public_inputs)`
- `set_verifier(verifier)`
- `set_mock_mode(enabled)`

### TestVectorVerifier

- `verify(proof, public_inputs)`
- `register_digest(digest)`
- `revoke_digest(digest)`
- `is_digest_allowed(digest)`

## Offchain API

### Prover service (`:4200`)

- `POST /proof/transfer`
- `POST /proof/withdraw`
- `POST /proof/verify`
- `GET /health`

### Indexer service (`:4100`)

- `GET /tree/root`
- `GET /wallet/:walletHint/snapshot`
- `GET /notes/:walletHint`
- `POST /commitments`
- `POST /nullifiers`
- `GET /nullifiers/:nullifier`
- `POST /notes/spend`
- `POST /transfers/private`
- `POST /withdrawals/private`
- `POST /payment-requests`
- `GET /payment-requests/:id`
- `POST /payment-requests/:id/pay`
- `POST /demo/mint-note`
- `GET /health`

## Atomic private execution

- `POST /transfers/private` validates root, proof bundle shape (and mock checksum when `mock=true`), note witnesses, nullifier uniqueness, and value conservation before mutating state.
- `POST /withdrawals/private` validates withdrawal proofs and handles optional change-note insertion in one call.

## TypeScript interfaces

Defined in `/packages/shared/src/types.ts`:

- `ShieldedNote`
- `NoteCiphertext`
- `PublicInputsTransfer`
- `PublicInputsWithdraw`
- `ProofBundle`
- `PaymentRequest`
- `WalletStateSnapshot`
