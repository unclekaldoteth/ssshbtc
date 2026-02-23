# 3-Minute Demo Script

## 0:00 - 0:20 Intro

- Show title: "Sssh BTC Wallet 🤫 - Private BTC Wallet on Starknet".
- State thesis: amounts and balances are hidden, validity is enforced by ZK proofs.
- Clarify architecture in one line: "Starknet settlement + read-only Bitcoin context" (no native Bitcoin settlement in this demo).

## 0:20 - 0:50 Deposit

- Open wallet UI.
- Connect Starknet wallet (or show demo mode fallback).
- Mint demo confidential deposit note.
- Show root/commitment count update.

## 0:50 - 1:30 Payment request

- Create private payment request.
- Explain that amount is committed, not publicly shown onchain.
- Copy request hash into transfer form.

## 1:30 - 2:20 Private send + claim

- Execute private transfer.
- Show resulting nullifier and new commitments.
- Load recipient view to show received note.
- Mark payment request paid by commitment reference.

## 2:20 - 2:45 Withdraw

- Generate private withdraw proof.
- Show note marked spent and nullifier consumed, then note that withdraw settles a Starknet BTC-like asset from the shielded pool.

## 2:45 - 3:00 Bitcoin + closing

- Open Xverse BTC context panel and explicitly call it read-only context (no Bitcoin signing/settlement).
- Close with roadmap: full Poseidon Merkle proofs + production verifier deployment.
