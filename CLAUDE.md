# Musea Curator Tips — agent guide

One-tap USDC tipping on **Stellar testnet**, backed by a Soroban contract that keeps
per-gallery tip totals on-chain. 30-day Instaward scope.

**Read before writing code:**

| Document | What it settles |
|---|---|
| `docs/Musea_Instawards_SOW.md` | What was promised, what is explicitly out of scope, the budget |
| `docs/Musea_Stellar_Implementation_Spec.md` | Reference implementation, file by file |
| `docs/stories/` | The work, broken into ordered stories |

The SOW is a commitment to a funder. **Do not expand scope.** Passkeys, mainnet, Freighter,
fiat, and native apps are all explicitly out of scope — if one seems necessary, say so and
stop rather than building it.

---

## The three rules that are not negotiable

**1. No blockchain code in the browser.** Every Stellar operation happens in a Convex
action under `packages/backend/convex/stellar/`. The web app calls Convex and renders the
result. Enforced by `no-restricted-imports` in `@musea/eslint-config/next`.

**2. No `userId` arguments on user-scoped functions.** The caller is whoever
`ctx.auth.getUserIdentity()` says they are. A client-supplied `userId` lets anyone move
funds from anyone else's wallet. The spec's §6 code sketches take `userId` as an argument —
that was shorthand, do not copy it. Use the helpers in `convex/model/auth.ts`.

**3. Secrets stay server-side.** Decrypted keys exist only as locals inside an action.
Never returned, never persisted in plaintext, never logged — including inside a `catch`.
`stellarWallets.encryptedSecret` must never leave the backend.

---

## Stack

| Layer | Choice | Version |
|---|---|---|
| Package manager | pnpm workspaces | 12.x |
| Build orchestration | Turborepo | 2.10.x |
| Formatting | Biome (formatter only; ESLint still lints) | 2.5.13 |
| Web | Next.js App Router, React 19 | 16.x / 19.x |
| Styling | Tailwind CSS v4 + shadcn/ui (new-york, neutral) | 4.3.x |
| Bottom sheet / toasts | Vaul / Sonner | 1.1.x / 2.0.x |
| Backend | Convex | 1.45.x |
| Auth | Better Auth + `@convex-dev/better-auth` | **1.6.31** / 0.12.5 |
| Stellar SDK | `@stellar/stellar-sdk` (backend only) | 17.x |
| Contract | Rust + `soroban-sdk` | 27.0.6 |
| Runtime | Node | 22+ (built on 24) |

> **Do not upgrade `better-auth` past 1.6.x.** `@convex-dev/better-auth@0.12.5` declares
> `better-auth >=1.6.11 <1.7.0`. 1.7.x is published and will install cleanly with
> `auto-install-peers`, then fail at runtime. Bump the component first, together.

> **TypeScript is pinned to 5.9.3**, not the 7.x line, because Convex codegen and the
> ESLint toolchain have not been verified against it here. Revisit deliberately, not
> incidentally.

---

## Layout

```
apps/web/                 Next.js app. No Stellar imports, ever.
packages/backend/         Convex deployment
  convex/schema.ts          data model
  convex/model/auth.ts      authorization helpers — use these
  convex/stellar/           "use node" actions: crypto, config, wallets, tips
  convex/stellar/internal.* default-runtime DB helpers (actions cannot write)
packages/shared/          Pure TS used by both sides: stroop math, error map, links
packages/typescript-config/, packages/eslint-config/
contracts/tipjar/         Rust Soroban contract + tests
scripts/setup-testnet.sh  Regenerates all testnet state after a testnet reset
```

Internal packages are **just-in-time**: they export `.ts` source directly and Next
transpiles them. There is no build step for `@musea/shared`, so no build ordering to think
about.

---

## Commands

```bash
pnpm install

pnpm --filter @musea/backend dev     # Convex dev; prints NEXT_PUBLIC_CONVEX_URL, runs codegen
pnpm --filter @musea/web dev         # Next.js on :3000
pnpm dev                             # both, via turbo

pnpm format                          # Biome, repo-wide; ESLint does the linting
pnpm check                           # format + lint + typecheck + test across the repo
pnpm --filter @musea/shared test     # the stroop math tests
turbo run test --filter=@musea/tipjar  # cargo test
```

**`convex/_generated/` does not exist until Convex codegen runs.** A fresh clone will show
a wall of "cannot find module './_generated/server'" errors. Run
`pnpm --filter @musea/backend dev` (or `convex codegen`) once — that is expected, not a
broken scaffold.

---

## State of the repo

This is a **scaffold**. What is real vs. what is a stub:

| Area | State |
|---|---|
| Monorepo, configs, lint rules, CI-able task graph | Done |
| `packages/shared` stroop math + error map | Done, tested |
| Convex schema, auth guards, DB helpers, crypto, config validation | Done; codegen run, typechecks against a live dev deployment |
| `convex/stellar/wallets.ts`, `convex/stellar/tips.ts` | **Stubs that throw.** Story 2.x |
| `convex/auth.ts` + `auth.config.ts` Better Auth wiring | Compiles; providers/trustedOrigins/JWKS still to do. Story 0.3 |
| `contracts/tipjar/` | Compiles; 10/10 tests pass, clippy clean. Deployed and tipped on testnet under throwaway identities — real deploy still to do. Story 1.3 |
| Web UI beyond the shell | Not started. Story 3.x |

The contract has run against Stellar testnet; nothing else has. Treat every remaining
"unverified" marker as real.

**Trustline before balance, always.** A SAC `mint` or `transfer` to an account with no
trustline for the asset fails with `Error(Contract, #13)`. `mint` does not create one.
This bit `setup-testnet.sh` and it will bite `provisionWallet` (Story 2.1) the same way.

---

## Skills

Installed and worth invoking:

| Task | Skill |
|---|---|
| Anything under `convex/` | `convex`, `convex-expert` |
| Auth review / "can user A read user B's data" | `convex-authz` — run before shipping |
| Convex tests | `convex-test`, `convex-verify` |
| Soroban contract work | `smart-contracts` (development / testing / security) |
| Stellar SDK, tx build/sign/submit | `dapp`, `data` |
| Trustlines, SAC, asset issuance | `assets` |
| Better Auth config and hardening | `better-auth-best-practices`, `better-auth-security-best-practices` |
| shadcn components | `shadcn` |
| turbo.json, filters, caching | `turborepo` |
| React/Next performance | `vercel-react-best-practices` |
| Pre-submission review | `code-review`, `security-review` |

---

## Conventions

**Money.** Stroops (`bigint`) are authoritative; display strings are derived. Always go
through `@musea/shared` — `toStroops` / `fromStroops` / `formatUsdc`. Never `amount * 1e7`.
Convex has no bigint type, so stroops are persisted as **strings**.

**Soroban lifecycle.** Contract calls are build → simulate → **assemble** → sign → send →
poll. Skipping `assemble` omits the resource fee and the transaction fails. Classic
payments are the shorter build → sign → submit — they are not the same thing.

**Errors.** Classify with `classifyStellarError`, persist the code, show
`userMessageFor(code)`. Raw Horizon/RPC errors never reach the UI. Full detail goes to
`tips.errorDetail`, server-side only.

**Gallery ids on-chain.** The contract keys totals by `BytesN<32>` = `sha256(galleryId)`,
computed in the Convex action. Same hash function on both sides or totals silently split
across two keys.

**On-chain numbers come from the chain.** A gallery's "total tipped" is read from contract
state, not summed from the `tips` table. If it ever renders from our database, the demo is
claiming something it has not proven — which is the one thing this deliverable is judged on.

---

## iPhone Safari

The verification target. Desktop Chrome will not catch these:

- `dvh`, never `vh` — Safari's URL bar collapses and `100vh` overflows.
- Inputs need a computed font-size ≥ 16px or Safari zooms on focus and never returns.
  Enforced globally in `globals.css`.
- `viewport-fit=cover` (set in `layout.tsx`) is what makes `env(safe-area-inset-*)` work.
  Bottom-pinned controls need `.pb-safe` to clear the home indicator.
- Tap targets ≥ 44×44 (`.tap-target`).
- Keep auth same-origin. ITP is stricter than Chrome about cross-site cookies, and stricter
  again in a private window — test there.

Full checklist: spec §7.5.

---

## Testnet resets

Stellar testnet is wiped roughly quarterly: every account, asset, and contract disappears
and the app breaks with 404s. Recovery is `./scripts/setup-testnet.sh` plus updating the
Convex env vars. Do not hand-create testnet state that the script cannot reproduce.

---

## Definition of done for a story

- [ ] `pnpm check` clean
- [ ] `convex-authz` run if the story touched a Convex function
- [ ] No secret in a log line, error message, or client payload
- [ ] Touched UI verified at 390px wide
- [ ] Anything on-chain has a testnet tx hash recorded in the story notes
