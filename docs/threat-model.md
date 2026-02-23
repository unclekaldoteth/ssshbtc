# Threat Model (Hackathon Scope)

## Assets to protect

1. Confidentiality of transfer amounts and per-user spendable balances.
2. Integrity of note spending to prevent double-spend.
3. Availability of proofs and indexer sync for demo continuity.

## Threats and mitigations

1. Double-spend by note replay
   - Mitigation: nullifier uniqueness checks (contract + indexer).
2. Forged transfer updates
   - Mitigation: verifier adapter gate before `transact`/`withdraw` state updates.
3. Front-running around state roots/nullifiers
   - Mitigation: root binding and nullifier checks before state mutation.
4. Data leakage via server logs
   - Mitigation: avoid plaintext amount logging and keep encrypted note transport.
5. Availability failure (indexer/prover downtime)
   - Mitigation: explicit health endpoints and clear UI retry/error states.

## Residual risk

- Mock verifier mode is not cryptographically sufficient for production.
- Simplified root logic reduces anonymity guarantees compared with a full Merkle inclusion scheme.
