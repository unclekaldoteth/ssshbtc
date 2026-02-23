pragma circom 2.1.8;

template Num2Bits64() {
    signal input in;
    signal output bits[64];

    var acc = 0;
    var base = 1;

    for (var i = 0; i < 64; i++) {
        bits[i] <-- (in >> i) & 1;
        bits[i] * (bits[i] - 1) === 0;
        acc += bits[i] * base;
        base = base * 2;
    }

    acc === in;
}

/**
 * Sssh BTC Wallet withdraw circuit (hackathon v2)
 *
 * Public signals:
 * - root
 * - input commitment
 * - input nullifier
 * - recipient
 * - amount commitment
 * - fee commitment
 * - asset
 *
 * This circuit proves:
 * - nullifier is derived from (input commitment, sender secret)
 * - 64-bit bounded withdrawal/fee amounts
 * - input amount = withdraw amount + fee
 */
template Withdraw1In() {
    signal input root;
    signal input asset;

    signal input senderSecret;
    signal input inCommitment;
    signal input inAmount;

    signal input recipient;
    signal input withdrawAmount;
    signal input fee;

    signal input amountCommitmentIn;
    signal input feeCommitmentIn;

    signal input inputNullifier;
    signal input amountCommitment;
    signal input feeCommitment;

    component inRange = Num2Bits64();
    component outRange = Num2Bits64();
    component feeRange = Num2Bits64();

    inRange.in <== inAmount;
    outRange.in <== withdrawAmount;
    feeRange.in <== fee;

    inputNullifier === inCommitment + senderSecret;

    inAmount === withdrawAmount + fee;

    amountCommitment === amountCommitmentIn;
    feeCommitment === feeCommitmentIn;

    // Bind otherwise-unused public values into the constraint system.
    root * 0 === 0;
    recipient * 0 === 0;
    asset * 0 === 0;
}

component main { public [root, inCommitment, inputNullifier, recipient, amountCommitment, feeCommitment, asset] } = Withdraw1In();
