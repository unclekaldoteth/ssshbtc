# Sssh BTC Wallet Cairo Contracts

Contracts included:

- `ShieldedPool`: manages deposits, private transfers, withdrawals, nullifiers, and rolling roots.
- `VerifierAdapter`: abstraction for Groth16 verifier integration with a `mock_mode` for hackathon velocity.
- `TestVectorVerifier`: non-mock external verifier for deterministic proof-vector allowlisting.
- `PaymentRequestRegistry`: onchain registry for private payment request metadata.

## Notes

- `ShieldedPool` intentionally accepts hashed/encrypted note references (`encrypted_note`) instead of plaintext note data.
- The root update currently uses a deterministic rolling hash (`old_root + commitment + index`) and should be replaced with an incremental Poseidon Merkle tree before mainnet usage.
- `VerifierAdapter` can switch from mock verification to a real verifier contract once deployed.
- `TestVectorVerifier` is a hackathon bridge step for onchain adapter integration; replace with a cryptographic verifier for production.
