# Privacy Guarantees and Limits

## Guarantees in this prototype

1. Onchain payloads avoid plaintext amounts and balances.
2. Spend authorization uses note ownership witness + nullifier anti-replay logic.
3. Payment requests can carry hidden amount commitments instead of clear invoice values.
4. Frontend decrypts note amounts locally from offchain note context.

## Important limits (explicit for judges)

1. Current Merkle root binding is simplified for hackathon speed and must be upgraded to full Poseidon inclusion proofs.
2. Current circuit nullifier relation and request-claim binding are simplified; they must be upgraded to Poseidon-based relations before final security claims.
3. Onchain verifier integration currently supports deterministic test-vector allowlisting (`TestVectorVerifier`) for adapter wiring; production mode requires a cryptographic Groth16 verifier contract.
4. Indexer stores note metadata for UX; while plaintext amounts are not intended for server storage, test/demo utilities can expose values locally.
5. Network-level metadata (timing, sender account) is still observable.

## Upgrade deadline for this hackathon sprint

1. Target: complete circuit hardening before the Feb 21 end-to-end demo milestone.
2. Absolute latest: before Feb 26 security hardening, otherwise claims should remain "prototype privacy" only.

## Planned post-hackathon hardening

1. Replace rolling root with sparse/incremental Poseidon tree and inclusion proofs.
2. Run MPC ceremony-backed proving keys and deterministic verifier integration.
3. Add encrypted memo channel and optional viewing-key permissions.
4. Add relayer fee abstraction and privacy-preserving gas sponsorship.
