# Sssh BTC Wallet Circuits

Circuits in this folder:

- `transfer.circom`: 2-input/2-output confidential transfer with nullifiers and amount conservation.
- `withdraw.circom`: private withdrawal from a single input note.
- `request_claim.circom`: optional payment request claim binding.

## Tooling

Expected toolchain:

- `circom >= 2.1.8`
- `snarkjs`
- `circomlib`

## Build

```bash
cd circuits
npm install
npm run compile
```

Artifacts are generated in `circuits/build`.

## Groth16 setup

After compiling, generate proving/verification artifacts:

```bash
cd circuits
npm run setup
```

Expected files for prover integration:

- `build/transfer_js/transfer.wasm`
- `build/transfer_final.zkey`
- `build/transfer_verification_key.json`
- `build/withdraw_js/withdraw.wasm`
- `build/withdraw_final.zkey`
- `build/withdraw_verification_key.json`

## Security note

Current root constraints are simplified for hackathon speed and must be upgraded to a real Poseidon Merkle inclusion proof for production readiness.
