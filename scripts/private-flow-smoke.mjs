const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:4100";
const PROVER_URL = process.env.PROVER_URL ?? "http://localhost:4200";

async function req(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} :: ${await response.text()}`);
  }

  return response.json();
}

async function run() {
  const senderHint = "demo-alice";
  const recipientHint = "demo-bob";
  const senderSecret = "0xsmoke-secret";

  const minted = await req(`${INDEXER_URL}/demo/mint-note`, {
    method: "POST",
    body: JSON.stringify({
      ownerHint: senderHint,
      recipientHint: senderHint,
      asset: "tBTC",
      amount: "100",
    }),
  });

  const root = await req(`${INDEXER_URL}/tree/root`);
  const senderSnapshot = await req(`${INDEXER_URL}/wallet/${senderHint}/snapshot`);
  const source = senderSnapshot.knownNotes.find(
    (note) => !note.spentAt && note.commitment === minted.note.commitment
  );

  if (!source) {
    throw new Error("No spendable note found for smoke flow");
  }

  const outputNotes = [
    { ownerHint: recipientHint, amount: "30", blinding: "0xsmoke-bob" },
    { ownerHint: senderHint, amount: "65", blinding: "0xsmoke-change" },
  ];

  const transferProof = await req(`${PROVER_URL}/proof/transfer`, {
    method: "POST",
    body: JSON.stringify({
      root: root.root,
      inputNotes: [
        {
          commitment: source.commitment,
          amount: source.amount,
          blinding: source.blinding,
        },
      ],
      outputNotes,
      feeAmount: "5",
      asset: "tBTC",
      senderSecret,
    }),
  });

  const verification = await req(`${PROVER_URL}/proof/verify`, {
    method: "POST",
    body: JSON.stringify({ proofBundle: transferProof }),
  });

  if (!verification.valid) {
    throw new Error("Generated transfer proof failed verification");
  }

  const execution = await req(`${INDEXER_URL}/transfers/private`, {
    method: "POST",
    body: JSON.stringify({
      senderHint,
      root: root.root,
      asset: "tBTC",
      feeAmount: "5",
      inputNotes: [
        {
          commitment: source.commitment,
          amount: source.amount,
          blinding: source.blinding,
        },
      ],
      outputNotes,
      proofBundle: transferProof,
    }),
  });

  const senderAfter = await req(`${INDEXER_URL}/wallet/${senderHint}/snapshot`);
  const recipientAfter = await req(`${INDEXER_URL}/wallet/${recipientHint}/snapshot`);

  console.log(
    JSON.stringify(
      {
        verification,
        execution,
        senderSpendable: senderAfter.knownNotes.filter((note) => !note.spentAt).length,
        recipientSpendable: recipientAfter.knownNotes.filter((note) => !note.spentAt).length,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
