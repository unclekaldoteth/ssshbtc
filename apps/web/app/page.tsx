import { WalletApp } from "../components/wallet-app";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-layout">
          <div className="hero-copy">
            <div className="hero-topline">
              <p className="hero-brand">Sssh BTC Wallet 🤫</p>
              <p className="hero-badge">Hackathon Prototype</p>
            </div>
            <p className="hero-kicker">Privacy + Bitcoin on Starknet</p>
            <h1>
              Private <span className="hero-accent">BTC-value</span> transfers
              <br />
              on Starknet
            </h1>
            <p className="hero-lead">
              Move BTC-value on Starknet without exposing balances or exact amounts. ZK
              proofs enforce validity, nullifier safety, and value conservation across
              private wallet flows using a BTC-like Starknet asset.
            </p>
            <ul className="hero-signals" aria-label="Core product signals">
              <li>BTC-value UX on Starknet</li>
              <li>ZK proof-verified transfers</li>
              <li>Shielded Pool architecture</li>
            </ul>
          </div>

          <aside className="hero-panel" aria-label="What this demo includes">
            <p className="hero-panel-label">Demo scope</p>
            <ul className="hero-panel-list">
              <li>
                <strong>Private deposits and sends</strong>
                <span>Confidential notes, nullifiers, and root updates</span>
              </li>
              <li>
                <strong>Payment request flow</strong>
                <span>Committed amount metadata for private payment UX</span>
              </li>
              <li>
                <strong>Withdraw path</strong>
                <span>Private history preserved inside the pool before exit</span>
              </li>
              <li>
                <strong>Optional Bitcoin context</strong>
                <span>Read-only Xverse context (no Bitcoin settlement or signing)</span>
              </li>
            </ul>
          </aside>
        </div>
      </section>
      <WalletApp />
    </main>
  );
}
