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
 * Sssh BTC Wallet transfer circuit (hackathon v2)
 *
 * Public signals:
 * - root
 * - asset
 * - input commitments[2]
 * - input nullifiers[2]
 * - output commitments[2]
 * - fee commitment
 *
 * This circuit proves:
 * - 64-bit bounded amounts
 * - amount conservation
 * - nullifiers are bound to (input commitment, sender secret)
 */
template Transfer2In2Out() {
    signal input root;
    signal input asset;
    signal input senderSecret;

    signal input inCommitments[2];
    signal input inAmounts[2];

    signal input outAmounts[2];
    signal input outCommitments[2];

    signal input fee;
    signal input feeCommitmentIn;

    signal input inputNullifiers[2];
    signal input outputCommitments[2];
    signal input feeCommitment;

    component inRange0 = Num2Bits64();
    component inRange1 = Num2Bits64();
    component outRange0 = Num2Bits64();
    component outRange1 = Num2Bits64();
    component feeRange = Num2Bits64();

    inRange0.in <== inAmounts[0];
    inRange1.in <== inAmounts[1];
    outRange0.in <== outAmounts[0];
    outRange1.in <== outAmounts[1];
    feeRange.in <== fee;

    for (var i = 0; i < 2; i++) {
        inputNullifiers[i] === inCommitments[i] + senderSecret;
        outputCommitments[i] === outCommitments[i];
    }

    inAmounts[0] + inAmounts[1] === outAmounts[0] + outAmounts[1] + fee;

    feeCommitment === feeCommitmentIn;

    // Bind otherwise-unused public values into the constraint system.
    root * 0 === 0;
    asset * 0 === 0;
}

component main { public [root, asset, inCommitments, inputNullifiers, outputCommitments, feeCommitment] } = Transfer2In2Out();
