pragma circom 2.1.8;

/**
 * Optional circuit: prove payment request claim consistency.
 */
template RequestClaim() {
    signal input requestHash;
    signal input receiverStealthPubkey;
    signal input amountCommitment;
    signal input expiry;

    signal input claimCommitment;

    claimCommitment === requestHash + receiverStealthPubkey + amountCommitment + expiry;
}

component main { public [requestHash, claimCommitment] } = RequestClaim();
