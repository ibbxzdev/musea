# Musea Curator Tips — agent guide

One-tap XLM tipping on **Stellar testnet**, backed by a Soroban contract that keeps
per-gallery tip totals on-chain. 30-day Instaward scope.

**Read before writing code:**

| Document | What it settles |
|---|---|
| `docs/Musea_Instawards_SOW.md` | What was promised, what is explicitly out of scope, the budget. **v3 — read the version banner** |
| `docs/Musea_Stellar_Implementation_Spec.md` | Reference implementation, file by file. Written against SOW v1 — §6 is being rewritten; the SOW wins on any disagreement |
| `docs/stories/` | The work, broken into ordered stories |
| `docs/Musea_App_Port.md` | The Musea app itself — what was ported from iOS, what was dropped, and six findings. Read before touching `convex/artifacts*`, `convex/galleries*` or `app/app/` |
| `docs/archive/` | Superseded SOW drafts, kept verbatim. Historical only — never build from these |

The SOW is a commitment to a funder. **Do not expand scope.** Mainnet, fiat, native apps,
wallet adapters beyond Freighter (LOBSTR, Stellar Wallets Kit, WalletConnect), and signer
features beyond one device passkey (multisig, social recovery, spending policies) are all
explicitly out of scope — if one seems necessary, say so and stop rather than building it.

> **Freighter is in scope, as an optional signer** (SOW §4.2a) — added at the project
> owner's direction, reversing v1/v2. It is additive: the built-in wallet is still
> provisioned for everyone and is still what gets demonstrated on iPhone Safari, because
> Freighter is a desktop extension with no iOS build. Do not let it become the primary
> path, and do not add a second adapter alongside it.

> **The custody model changed in SOW v3.** Wallets are **non-custodial passkey smart
> accounts** (WebAuthn / Face ID, secp256r1), not app-managed encrypted keys. Anything in
> this repo that generates a keypair, encrypts a secret, or signs server-side is **v1
> code awaiting removal** — do not extend it, and do not copy its shape into new work.
> See §4.2 of the SOW.

---

## The three rules that are not negotiable

**1. No blockchain code in the browser.** Every Stellar operation — build, simulate,
assemble, submit, poll — happens in a Convex action under
`packages/backend/convex/stellar/`. The web app calls Convex and renders the result.
Enforced by `no-restricted-imports` in `@musea/eslint-config/next`.

> The passkey model does **not** relax this. WebAuthn is a browser platform API
> (`navigator.credentials`), not a Stellar library. The browser receives an authorization
> payload, returns a signature, and imports no Stellar package to do it. If a change needs
> `@stellar/stellar-sdk` in `apps/web`, the design is wrong — move the work into the
> action. Some passkey kits are built to run client-side and will drag `stellar-base` into
> the bundle; wrap only their WebAuthn half.

**2. No `userId` arguments on user-scoped functions.** The caller is whoever
`ctx.auth.getUserIdentity()` says they are. A client-supplied `userId` lets anyone move
funds from anyone else's wallet. The spec's §6 code sketches take `userId` as an argument —
that was shorthand, do not copy it. Use the helpers in `convex/model/auth.ts`.

**3. Musea never holds key material.** Not in plaintext, not encrypted, not in memory. The
signing key is generated inside the device's Secure Enclave by the WebAuthn authenticator
and is not extractable — by us or by anyone. What may be persisted per user is the smart
account's contract address and the passkey credential id, both public by construction.

> This rule *replaced* v1's "secrets stay server-side," which governed
> `stellarWallets.encryptedSecret`. The new rule is strictly stronger: there is no secret
> to leak, so a total backend compromise cannot move a user's funds. If you find yourself
> writing envelope encryption, key rotation, or a `decrypt()` call, stop — that is v1.

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
| Smart wallet | `smart-account-kit` (WebAuthn half in the browser; rest server-side) | TBD — Story 2.1 |
| Gasless submission | OpenZeppelin Relayer / Stellar Channels — `https://channels.openzeppelin.com/testnet` (keys at `/gen`) | TBD — Story 2.2 |
| Contract | Rust + `soroban-sdk` | 27.0.6 |
| Runtime | Node | 22+ (built on 24) |

> **Smart Account Kit, not Passkey Kit.** They are sibling SDKs with *incompatible*
> on-chain authorization models — OpenZeppelin context rules + auth digest vs. a flat
> multi-signer map — not successive versions. The SOW names Smart Account Kit. Switching
> later is a redeploy of every user's account, not a dependency bump.

> **The OpenZeppelin Relayer replaced Launchtube.** Any tutorial that reaches for
> Launchtube is out of date.

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
  app/app/<section>/        one route per section — NOT tabs. See musea-shell.tsx
packages/backend/         Convex deployment
  convex/schema.ts          data model
  convex/model/auth.ts      authorization helpers — use these
  convex/model/artifacts.ts kind/sourceType/searchText derivation + the client projection
  convex/artifacts.ts       the library: create, list, search, update, remove
  convex/galleries.ts       galleries; `isPublic` is what a stranger may open
  convex/galleryArtifacts.ts  the artifact <-> gallery join
  convex/linkPreview.ts     "use node": oEmbed + Open Graph enrichment. No AI.
  convex/files.ts           uploads, and the record of who uploaded what
  convex/stellar/           "use node" actions: config, wallets, tips
  convex/stellar/crypto.ts  v1 envelope encryption — DELETE with Story 2.1, do not extend
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

The repo is mid-migration from SOW v1 (custodial) to v3 (passkey). Read this column
carefully — "Done" and "Done, v1 custody" mean very different things.

| Area | State |
|---|---|
| Monorepo, configs, lint rules, CI-able task graph | Done |
| `packages/shared` stroop math + error map | Done, tested. Error map needs passkey/relayer codes |
| Convex schema, auth guards, DB helpers, config validation | Done; codegen run, typechecks against a live dev deployment |
| `contracts/tipjar/` | **Done. Redeployed for the XLM cutover** — the token is a constructor arg, so only the binding changed. 10/10 tests, clippy clean, deployed `CCZPKSRP…` bound to the native SAC `CDLZFC3S…`, sample tip `762d5d84…`, and a zero-trustline recipient proved at `d0eb9b53…`. The old USDC deployment `CAIH6NCC…` is retired |
| `convex/auth.ts` + `auth.config.ts` Better Auth wiring | Done. Safari device pass outstanding |
| Musea app (artifacts, galleries, filing, profile) | Done and on a live dev deployment. Ported from the iOS repo; 34 backend tests, `convex-authz` clean |
| `convex/stellar/crypto.ts`, `walletsNode.ts` provisioning | **Done, v1 custody — to be removed.** Keypair + Friendbot + encrypted secret. Superseded by Story 2.1 |
| `convex/stellar/tipsNode.ts` | **Done, v1 custody — signing half to be replaced.** Build/simulate/assemble/submit survives; server-side signing does not |
| Passkey smart account, WebAuthn, relayer | **Not started.** Story 2.x |
| Tipping UI — tip sheet, balance chip, gallery total | **Done and working** (Stories 3.2/3.3/3.5), on the v1 custodial actions. `sendTip` returns a real tx hash and the badge reads contract state. Rewire for passkey, don't rebuild |
| Activity page, iPhone device pass, **deploy** | **Not started.** Stories 3.4 / 3.6 / 3.7. The deploy is what stands between this and a demo anyone else can open |

The contract has run against Stellar testnet and the v1 custodial actions have too — three
real tips. What has *not* run is anything passkey-shaped. Treat every "not started" above
as genuinely unproven.

**The v1 custodial path still works, and that is useful.** It is the fastest way to
exercise the contract end-to-end on any device while the passkey path is built. Keep it
runnable until Story 2.3 lands; see SOW §4.4 and Epic 5.

**The Musea app is a port, not a rewrite.** `github.com/ibo-najjar/Musea` is the iOS
original and is the reference for behaviour. What was deliberately left out, and must stay
out unless someone decides otherwise: the LLM enrichment and auto-filer (`ai.ts`,
`organize.ts`), embedding/vector search (`search.ts` — replaced by a Convex full-text
index), RevenueCat and the paywall, and everything native (share extension, secure store,
local drafts). Link enrichment survives because it is oEmbed and Open Graph, not AI.

**Tips move XLM, the native asset — there are no trustlines anywhere.** This reversed the
SOW's USDC commitment at the project owner's direction, after every curator who connected
a Freighter wallet hit `NO_TRUSTLINE`: the project minted its own test USDC, and only the
nine accounts `setup-testnet.sh` created had ever opted into it. XLM needs no opt-in, so
the only remaining precondition on either side is that the account exists on the network.

> **The SOW still says USDC** — project name, both deliverables, every weekly milestone,
> and the demo-video acceptance criteria. That gap is open and deliberate, not an
> oversight. See §4 and Deliverable 2; squaring it with the funder is the owner's call.

> The trustline machinery is gone, not disabled: no `changeTrust`, no asset issuance, no
> `mint`. If this ever moves back to an issued asset — Circle's real USDC on mainnet, say
> — the removed steps are in the git history of `scripts/setup-testnet.sh`, and the
> `NO_TRUSTLINE` code and its `Error(Contract, #13)` classifier were kept for exactly that
> reason.

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
through `@musea/shared` — `toStroops` / `fromStroops` / `formatXlm`. Never `amount * 1e7`.
Convex has no bigint type, so stroops are persisted as **strings**.

**Soroban lifecycle.** Contract calls are build → simulate → **assemble** → sign → send →
poll. Skipping `assemble` omits the resource fee and the transaction fails. Classic
payments are the shorter build → sign → submit — they are not the same thing.

Under the passkey model **only the sign step leaves the server**, and it crosses as bytes,
not as a transaction object:

```
Convex action   build → simulate → assemble → derive auth payload hash  ─┐
                                                                         ▼
browser                        navigator.credentials.get({ challenge })  → Face ID
                                                                         │
Convex action   attach assertion to the auth entry → send → poll  ◄──────┘
```

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

### WebAuthn on iOS Safari

The passkey is the deliverable, and Safari is stricter than Chrome about all of it:

- **One stable domain, decided before anyone registers.** A passkey is bound to its
  Relying Party ID. A credential created on a Vercel preview URL does not resolve on the
  next preview URL, on prod, or on `localhost`. Per-branch preview deploys and passkeys are
  fundamentally incompatible — pin the demo domain early. Expect dev and prod to hold
  separate credentials, permanently.
- **Call `navigator.credentials.*` inside the tap handler, synchronously.** Safari consumes
  user activation across an `await`. Fetching the challenge first and *then* calling
  `get()` is the common way to make the Face ID sheet silently never appear. Have the
  challenge in hand before the tap resolves.
- **Secure context required.** HTTPS everywhere; `localhost` is the only exempt origin.
- Platform authenticator, not a security key:
  `{ authenticatorAttachment: "platform", userVerification: "required", residentKey: "required" }`.
- **The signature is not over your payload.** WebAuthn signs
  `authenticatorData ‖ SHA256(clientDataJSON)`, with your challenge embedded in
  `clientDataJSON`. The assertion is DER-encoded and often high-S; Soroban's
  `secp256r1_verify` wants raw 64-byte `r‖s`, low-S normalized. This is the single most
  likely source of "valid signature, contract says no."
- Private browsing still has iCloud Keychain passkeys, but storage is harsher — test there.

---

## Testnet resets

Stellar testnet is wiped roughly quarterly: every account, asset, and contract disappears
and the app breaks with 404s. Recovery is `./scripts/setup-testnet.sh` plus updating the
Convex env vars. Do not hand-create testnet state that the script cannot reproduce.

---

## Definition of done for a story

- [ ] `pnpm check` clean
- [ ] `convex-authz` run if the story touched a Convex function
- [ ] No key material anywhere — not in a log line, error message, client payload, or table
- [ ] No new `@stellar/*` import in `apps/web` (rule 1)
- [ ] Touched UI verified at 390px wide
- [ ] Anything touching the passkey path verified on a real iPhone in Safari, not a simulator
- [ ] Anything on-chain has a testnet tx hash recorded in the story notes
