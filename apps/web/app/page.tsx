/**
 * Scaffold home page.
 *
 * Intentionally a build-status page, not a fake product screen. Story 3.1 replaces this
 * with the real gallery grid. Shipping a mocked-up tip button here would make the app look
 * further along than it is, which is exactly the confusion this project can least afford —
 * the deliverable is judged on a demo being genuinely on-chain.
 */

const deliverables = [
  {
    id: "1",
    title: "Soroban TipJar contract",
    detail: "Rust contract moving USDC via the SAC, recording per-gallery totals on-chain.",
    path: "contracts/tipjar",
    state: "scaffolded" as const,
  },
  {
    id: "2",
    title: "Wallet + one-tap tip flow",
    detail: "Custodial wallet provisioning and the server-side tip action, in Convex.",
    path: "packages/backend/convex/stellar",
    state: "scaffolded" as const,
  },
  {
    id: "3",
    title: "Receipts, totals, demo & docs",
    detail: "Activity page with Stellar Expert receipts and live on-chain gallery totals.",
    path: "apps/web",
    state: "not-started" as const,
  },
];

const STATE_LABEL = {
  scaffolded: "Scaffolded",
  "not-started": "Not started",
  done: "Done",
} as const;

export default function Home() {
  return (
    <main className="mx-auto min-h-screen-safe w-full max-w-2xl px-5 pt-safe pb-safe">
      <header className="py-10">
        <p className="text-sm font-medium text-stellar">Musea × Stellar</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">Curator Tips</h1>
        <p className="mt-3 text-muted-foreground text-pretty">
          One-tap USDC tipping on Stellar testnet, backed by a Soroban contract that keeps
          per-gallery tip totals on-chain.
        </p>
      </header>

      <section aria-labelledby="status" className="rounded-xl border p-5">
        <h2 id="status" className="text-sm font-medium">
          Build status
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This is the scaffold. Nothing below is wired to the network yet.
        </p>

        <ul className="mt-4 space-y-4">
          {deliverables.map((d) => (
            <li key={d.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium">
                  Deliverable {d.id} — {d.title}
                </span>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {STATE_LABEL[d.state]}
                </span>
              </div>
              <p className="text-sm text-muted-foreground text-pretty">{d.detail}</p>
              <code className="text-xs text-muted-foreground">{d.path}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-xl border p-5">
        <h2 className="text-sm font-medium">Start here</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Read <code>CLAUDE.md</code> at the repo root — conventions and the rules that are not
            negotiable.
          </li>
          <li>
            Read <code>docs/Musea_Stellar_Implementation_Spec.md</code> for the reference
            implementation.
          </li>
          <li>
            Pick up <code>docs/stories/</code> in order, starting with Epic 0.
          </li>
        </ol>
      </section>

      <footer className="py-10 text-sm text-muted-foreground">
        Stellar testnet — no real value.
      </footer>
    </main>
  );
}
