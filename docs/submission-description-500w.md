# Submission Description (<=500 words)

Sssh BTC Wallet is a Starknet-powered Bitcoin wallet prototype focused on confidential value transfer. The core challenge we tackle is simple: users should be able to transact BTC-denominated value without publicly revealing their wallet balances or exact transaction amounts.

Our system introduces a shielded pool model on Starknet. Users deposit a BTC-denominated token into the pool and receive private notes represented as commitments. A commitment binds `(owner, asset, amount, blinding)` and is recorded onchain without exposing the underlying amount. Spending a note generates a nullifier, which prevents replay and double-spend.

To validate private state transitions, Sssh BTC Wallet uses a Groth16-compatible proving workflow (Circom circuits plus verifier adapter). Transfer proofs enforce nullifier constraints and value conservation across inputs/outputs plus fee. Withdrawal proofs allow users to exit back to a public address while still preserving private transfer history inside the pool. For hackathon integration speed, we run the adapter against an external test-vector verifier contract today and keep the same interface boundary for cryptographic verifier replacement.

The project also includes a private payment request feature. Recipients create invoice-like requests with hidden amount commitments and expiry metadata. Payers can satisfy a request through a confidential transfer and link payment by commitment reference. This creates a realistic merchant/payment UX while keeping payment amounts confidential.

From a Bitcoin perspective, Sssh BTC Wallet is intentionally BTC-native in denomination and user story. We settle confidential balances with a BTC-denominated Starknet asset and provide optional read-only Xverse API integration to enrich Bitcoin account context in the wallet interface. This gives us a robust path for the Bitcoin track while avoiding bridge R&D risk in a two-week solo build window.

Architecture is split into three layers:

1. Cairo contracts (`ShieldedPool`, `VerifierAdapter`, `PaymentRequestRegistry`) on Starknet Sepolia.
2. Offchain proving/indexing services (`/proof/*`, `/tree/root`, `/notes/*`, `/payment-requests/*`).
3. A polished Next.js wallet app for deposit, private send, request creation, and withdraw flows.

Security controls include strict nullifier checks, root validation, minimal verifier adapter surface, and explicit prototype disclaimers. We also document current limits: Merkle root and some circuit relations are simplified for hackathon speed and should be upgraded to Poseidon-based inclusion/constraint checks before production.

Sssh BTC Wallet demonstrates a practical path to private Bitcoin-denominated finance on Starknet: usable UX today, clear privacy guarantees, and a direct technical roadmap to production-grade ZK confidentiality.
