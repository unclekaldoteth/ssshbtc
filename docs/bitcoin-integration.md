# Bitcoin Integration Strategy

Sssh BTC Wallet focuses on BTC-denominated privacy flows on Starknet while avoiding bridge R&D risk during hackathon.

## Integration approach

1. Use existing Starknet BTC test asset (or fallback `tBTC` token contract) as settlement token for shielded balances.
2. Preserve Bitcoin narrative through denomination and BTC-oriented payment UX.
3. Add optional Xverse API read integration for BTC address context, balances, and ecosystem alignment.

## Why this is competitive for dual-track

- Privacy track: genuine confidential transfer/withdraw architecture.
- Bitcoin track: BTC-denominated wallet UX with clear extension path to bridge/atomic-swap integrations.

## Explicit future extension

- Swap settlement source from wrapped/test BTC to trust-minimized bridge asset when bridge maturity and audit support are available.
