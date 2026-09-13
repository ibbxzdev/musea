# Musea Curator Tips

One-tap **USDC tipping on Stellar** for Musea gallery curators, backed by a minimal Soroban
contract that records per-gallery and per-curator tip totals on-chain.

A reader who values a curated gallery can send its curator $1 with a single tap. No wallet
to install, no seed phrase, no 3–30% payment-processor cut — and the resulting tip is a
publicly verifiable on-chain fact rather than a number in our database.

> **Stellar testnet only. No real value.** Wallets are app-managed (custodial) for this
> scope. See [custody](#custody) before drawing conclusions about the security model.

---

## Status

**Scaffold.** The repository, toolchain, data model, and conventions are in place; the
Stellar flows are stubs. Nothing here has run against testnet yet. See
[CLAUDE.md](./CLAUDE.md#state-of-the-repo) for the per-area breakdown and
[docs/stories/](./docs/stories/) for the work queue.

---

## How it works

```
┌──────────────────┐        ┌────────────────────────┐        ┌──────────────────┐
│  Next.js web app │ calls  │  Convex actions (Node) │        │ Stellar testnet  │
│  no stellar-sdk  │ ─────▶ │  encrypted keys        │ ─────▶ │ Horizon + RPC    │
│  tip sheet       │        │  build/sign/submit     │        │ TipJar contract  │
│  activity + toasts│ ◀──── │  read contract state   │ ◀───── │ USDC SAC         │
│  ↳ iPhone Safari │ result │                        │        │                  │
└──────────────────┘        └────────────────────────┘        └──────────────────┘
```

The browser never imports a Stellar package. Every key operation happens server-side in a
Convex Node action, which is what lets the app stay a plain Convex client and keeps key
material away from the client entirely.

A tip is a single `tip(from, to, gallery, amount)` invocation on the **TipJar** contract.
It moves USDC through the Stellar Asset Contract, adds to the gallery's and the curator's
running totals in persistent storage, and emits a `TipEvent`. The app then reads the
gallery's total back **from contract state**, so the number on screen is the number on
chain.

---

## Quick start

Requires **Node 22+**, **pnpm**, and — for the contract — **Rust** and the **Stellar CLI**.

```bash
pnpm install

# 1. Contract toolchain (skip if you are only touching the web app)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --locked stellar-cli

# 2. Create testnet identities, issue test USDC, deploy the contract.
#    Prints the environment variables to paste into Convex.
./scripts/setup-testnet.sh

# 3. Backend — prints NEXT_PUBLIC_CONVEX_URL and generates convex/_generated/
pnpm --filter @musea/backend dev

# 4. Web — copy apps/web/.env.local.example to .env.local first
pnpm --filter @musea/web dev
```

`convex/_generated/` does not exist until step 3 runs. Type errors before then are expected.

See [`.env.example`](./.env.example) for every variable and which side it belongs on.

---

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js App Router app, Tailwind v4 + shadcn/ui |
| `packages/backend` | Convex: schema, auth, and the `stellar/` actions |
| `packages/shared` | Stroop math, error mapping, Stellar Expert links |
| `contracts/tipjar` | The Soroban contract and its tests |
| `scripts` | Testnet bootstrap |
| `docs` | SOW, implementation spec, story backlog |

---

## Commands

```bash
pnpm dev        # web + backend
pnpm check      # lint + typecheck + test, everywhere
pnpm build
```

---

## Custody

Wallets are **app-managed** for this scope. Each user's Stellar secret key is encrypted at
rest with AES-256-GCM; the master key lives only in Convex environment variables and is
never in the database, the client, or a log line. Decryption happens in memory inside a
Convex action at signing time and is discarded.

This is testnet with no real-value assets, so a compromise would expose only worthless test
USDC — but the hygiene is production-shaped deliberately. Real custody (KMS/HSM-backed keys,
rotation) and the move to non-custodial signing so users hold their own keys are the
follow-on SCF Build Award phase. The signing layer is isolated so that migration swaps a
module rather than rewriting the app.

---

## Verifying a tip

Every tip in the Activity view links to its transaction on Stellar Expert. To check a
gallery's total independently:

```
https://stellar.expert/explorer/testnet/contract/<TIPJAR_CONTRACT_ID>
```

The contract's `gallery_total` is the source of truth. If the app's number and the
contract's number ever disagree, the app is wrong.

---

## Scope

In: testnet, USDC, one contract, custodial wallets, web (verified on iPhone Safari).

Out: mainnet, escrow/refunds/fee-splitting, external wallets and passkeys, fiat on/off-ramp,
DeFi or anchor integrations, native iOS/Android builds. See
[the SOW](./docs/Musea_Instawards_SOW.md#out-of-scope-explicitly-not-included).

---

## License

MIT — see [LICENSE](./LICENSE).
