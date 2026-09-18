# Musea Curator Tips

One-tap **XLM tipping on Stellar** for Musea gallery curators, backed by a minimal Soroban
contract that records per-gallery and per-curator tip totals on-chain.

A reader who values a curated gallery can tip its curator with a single tap and a Face ID
prompt. There's no wallet to install, no browser extension, no seed phrase and no network
fee to pay, and the resulting tip is a publicly verifiable on-chain fact rather than a
number in our database.

> Stellar testnet only. No real value moves, and mainnet is out of scope for this
> engagement.

**Live:** [musea-tips.vercel.app](https://musea-tips.vercel.app) ·
**Evidence bundle:** [`docs/evidence.md`](./docs/evidence.md)

---

## Status

Shipped and proven on hardware. The contract is deployed, the passkey wallet works, and
tips have travelled the whole path: authorized by Face ID on a physical iPhone in Safari,
signed by a key that never left the device's Secure Enclave, and submitted without the user
holding a Stellar account or paying a fee.

| Area | State |
|---|---|
| Soroban TipJar contract | Deployed on testnet. 10/10 tests, clippy and fmt clean |
| Passkey smart accounts (WebAuthn, Face ID) | Working, verified on a real iPhone |
| Gasless submission via OpenZeppelin Channels | Working. The fee is paid by a sponsor account |
| Tip sheet, balance, live on-chain gallery totals | Working |
| Activity feed with Stellar Expert receipt links | Working, verified on a real iPhone |
| Demo video | Recorded, [`docs/demo1.mp4`](./docs/demo1.mp4) |

Every deployed address, transaction hash, screenshot and test output is in
[`docs/evidence.md`](./docs/evidence.md), with a link for each claim.

---

## How it works

```
┌────────────────────┐          ┌────────────────────────┐        ┌──────────────────┐
│   Next.js web app  │  calls   │  Convex actions (Node) │        │ Stellar testnet  │
│   no stellar-sdk   │ ───────▶ │  build/simulate/       │ ─────▶ │ Horizon + RPC    │
│   tip sheet        │          │  assemble/submit       │        │ TipJar contract  │
│   activity + toasts│ ◀─────── │  read contract state   │ ◀───── │ native XLM SAC   │
│   ↳ iPhone Safari  │  result  │  holds no keys         │        │                  │
└─────────┬──────────┘          └────────────────────────┘        └──────────────────┘
          │
          │  WebAuthn only, via navigator.credentials
          ▼
┌────────────────────┐
│   Secure Enclave   │  the signing key is generated here and never leaves
│   Face ID / Touch  │
└────────────────────┘
```

The browser never imports a Stellar package. Every Stellar operation, from build through
simulate, assemble and submit, happens server-side in a Convex Node action. That rule is
enforced by `no-restricted-imports` in `@musea/eslint-config/next` rather than by
convention.

The browser's only cryptographic role is WebAuthn. It receives a 32-byte challenge, prompts
for Face ID, and returns a signature. The transaction itself never leaves the server, so
there's no client-supplied envelope to validate.

A tip is a single `tip(from, to, gallery, amount)` invocation on the TipJar contract,
routed through the user's smart account. It moves XLM through the native Stellar Asset
Contract, adds to the gallery's and the curator's running totals in persistent storage, and
emits a `TipEvent`. The app then reads the gallery's total back from contract state, so the
number on screen is the number on chain.

Traced end to end in [`docs/tip-flow.md`](./docs/tip-flow.md).

---

## Key custody

Musea holds no key material, because there's nothing to hold. Each user's wallet is a
non-custodial Stellar smart account whose only signer is a passkey generated inside their
device's Secure Enclave by the WebAuthn platform authenticator. That key isn't extractable
by the browser, by this backend, or by anyone else.

What gets persisted per user is the smart account's contract address and the passkey's
credential id and public key, all three public by construction. Nothing is persisted that could be used to sign: no stored key material in any form, and no
code path that could sign on a user's behalf. A
total compromise of this backend can't move a single user's funds, and can't impersonate a
user either, since there's no password hash to steal.

Three consequences are design decisions rather than gaps:

- A lost device is a lost account. There's no recovery path, because every mechanism worth
  having (a second signer, social recovery, an account-level fallback) is out of scope here.
- A passkey is bound to one domain, so `localhost` and `musea-tips.vercel.app` hold
  permanently separate accounts. Development needs its own sign-up.
- Sign-in is passkey-only. Email and password are disabled, and no other credential is
  accepted.

---

## Quick start

Requires **Node 22+**, **pnpm**, and for the contract, **Rust** and the **Stellar CLI**.

```bash
pnpm install

# 1. Contract toolchain (skip if you are only touching the web app)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --locked stellar-cli

# 2. Create testnet identities and deploy the contract.
#    Prints the environment variables to paste into Convex.
./scripts/setup-testnet.sh

# 3. Backend — prints NEXT_PUBLIC_CONVEX_URL and generates convex/_generated/
pnpm --filter @musea/backend dev

# 4. Web — copy apps/web/.env.local.example to .env.local first
pnpm --filter @musea/web dev
```

`convex/_generated/` doesn't exist until step 3 runs. A wall of "cannot find module
'./_generated/server'" errors before then is expected, not a broken scaffold.

Two variables the setup script can't produce, because they aren't ours to deploy:

- `RELAYER_API_KEY`, an OpenZeppelin Channels key from
  [channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen).
  Server-side only, always. It authorizes spending someone else's XLM on fees, so a leaked
  key is an open relay.
- `WEBAUTHN_RP_ID`, the domain passkeys bind to. Use `localhost` in development and your
  deployed hostname in production. Decide this before anyone registers, since credentials
  created under one RP ID won't resolve under another.

See [`.env.example`](./.env.example) for every variable and which side it belongs on, and
[`docs/evidence.md`](./docs/evidence.md#32-environment-variables-and-setup) for the values
this deployment uses.

---

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js App Router app, Tailwind v4 + shadcn/ui. No Stellar imports, ever |
| `packages/backend` | Convex: schema, auth, and the `stellar/` actions |
| `packages/shared` | Stroop math, error mapping, Stellar Expert links |
| `contracts/tipjar` | The Soroban contract and its tests |
| `scripts` | Testnet bootstrap |
| `docs` | Architecture, contract reference, tip flow, evidence bundle |

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/architecture.md`](./docs/architecture.md) | The three rules the codebase is shaped around, and why every Stellar operation is server-side |
| [`docs/contract-reference.md`](./docs/contract-reference.md) | TipJar entrypoints, errors, storage keys, events, deployed address |
| [`docs/tip-flow.md`](./docs/tip-flow.md) | One tip traced end to end: tap, Convex, simulate, Face ID, submit, totals, receipt |
| [`docs/evidence.md`](./docs/evidence.md) | Every deployed address and transaction hash, with a link each |

---

## Commands

```bash
pnpm dev        # web + backend
pnpm check      # format + lint + typecheck + test, everywhere
pnpm build

pnpm --filter @musea/shared test        # stroop math
turbo run test --filter=@musea/tipjar   # cargo test
```

---

## Verifying a tip

Every tip in the Activity view links to its transaction on Stellar Expert. To check a
gallery's total independently:

```bash
stellar contract invoke --id <TIPJAR_CONTRACT_ID> \
  --source <any funded testnet account> --network testnet --send=no \
  -- gallery_total --gallery <sha256 of the gallery id, hex>
```

The contract's `gallery_total` is the source of truth. If the app's number and the
contract's number ever disagree, the app is wrong.

---

## Scope

**In:** testnet, XLM, one Soroban contract, non-custodial passkey smart accounts, gasless
submission, and a web app verified on iPhone Safari.

**Out:** mainnet, escrow, refunds, fee-splitting, third-party wallet adapters, signer
features beyond one device passkey (multisig, social recovery, spending policies), fiat on
and off-ramps, DeFi or anchor integrations, and native iOS or Android builds.

---

## License

MIT, see [LICENSE](./LICENSE).
