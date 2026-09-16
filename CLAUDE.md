# Musea Curator Tips — agent guide

One-tap XLM tipping on **Stellar testnet**, backed by a Soroban contract that keeps
per-gallery tip totals on-chain. 30-day Instaward scope.

**Read before writing code:**

| Document | What it settles |
|---|---|
| `docs/Musea_Instawards_SOW.md` | What was promised, what is explicitly out of scope, the budget. **v3 — read the version banner** |
| `docs/Musea_Stellar_Implementation_Spec.md` | Reference implementation, file by file. Written against SOW v1 — §6 is being rewritten; the SOW wins on any disagreement |
| `docs/stories/` | The work, broken into ordered stories |
| `docs/evidence.md` | **Every deployed address and transaction hash, with a link each.** The canonical list — CLAUDE.md and the story docs abbreviate, this does not. Read off the chain, not the database |
| `docs/Musea_App_Port.md` | The Musea app itself — what was ported from iOS, what was dropped, and six findings. Read before touching `convex/artifacts*`, `convex/galleries*` or `app/app/` |
| `docs/archive/` | Superseded SOW drafts, kept verbatim. Historical only — never build from these |

The SOW is a commitment to a funder. **Do not expand scope.** Mainnet, fiat, native apps,
wallet adapters (Freighter, LOBSTR, Stellar Wallets Kit, WalletConnect), and signer
features beyond one device passkey (multisig, social recovery, spending policies) are all
explicitly out of scope — if one seems necessary, say so and stop rather than building it.

> **Freighter is gone.** It was briefly in scope as an optional signer (SOW §4.2a); the
> project owner then removed it. A desktop extension with no iOS build could never be the
> thing demonstrated on an iPhone, and keeping a second signer alive doubled every code
> path for a user nobody would film. There is now exactly one way to hold value and one
> way to authorize a tip. If a second signer is ever wanted again, the seams are
> `resolveCuratorAddress` in `stellar/tipsNode.ts` and the `smartAccounts` table — but
> that is a decision to take deliberately, not a refactor to slip in.

> **Wallets are non-custodial passkey smart accounts** (WebAuthn / Face ID, secp256r1),
> not app-managed encrypted keys — SOW v3 §4.2. The v1 custodial code is **deleted**:
> `stellar/crypto.ts`, `walletsNode.ts`, `stellarWallets.encryptedSecret` and the rows
> that held it are all gone. If you find yourself writing envelope encryption, key
> rotation, or a `decrypt()` call, stop — that was v1 and it is not coming back.

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
| Stellar SDK | `@stellar/stellar-sdk` (backend only) | **16.3.0 — pinned, see below** |
| Smart wallet | `smart-account-kit` (WebAuthn half in the browser; rest server-side) | 0.8.0 |
| WebAuthn (browser) | `@simplewebauthn/browser` | 13.x |
| WebAuthn (server, sign-in only) | `@simplewebauthn/server` | **13.3.3 — keep in step with the browser half** |
| Gasless submission | OpenZeppelin Relayer / Stellar Channels — `https://channels.openzeppelin.com/testnet` (keys at `/gen`) | live |
| Contract | Rust + `soroban-sdk` | 27.0.6 |
| Runtime | Node | 22+ (built on 24) |

> **Smart Account Kit, not Passkey Kit.** They are sibling SDKs with *incompatible*
> on-chain authorization models — OpenZeppelin context rules + auth digest vs. a flat
> multi-signer map — not successive versions. The SOW names Smart Account Kit. Switching
> later is a redeploy of every user's account, not a dependency bump.

> **The OpenZeppelin Relayer replaced Launchtube.** Any tutorial that reaches for
> Launchtube is out of date.

> **Do not upgrade `@stellar/stellar-sdk` to 17.x.** `smart-account-kit@0.8.0` reads
> `simulationData.result.auth` expecting decoded XDR objects; SDK 17 returns base64
> strings, and the kit fails with `discoveredAuth[0].rootInvocation is not a function`.
> A pnpm `overrides` entry does **not** fix this — the SDK is a *peer* dependency of the
> kit, so it resolves from the importer, which is why the backend itself is pinned.

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
  convex/model/passkeyAuth.ts   Better Auth plugin: the four /passkey/* sign-in endpoints
  convex/passkeys.ts            credential DB helpers + scheduled wallet provisioning
  convex/stellar/passkeyAuthNode.ts "use node": @simplewebauthn/server — the ONLY thing
                                standing between a stranger and an account. Not the same
                                job as passkeyNode.ts, which verifies nothing
  convex/stellar/passkey.ts     auth-guarded surface: getMyWallet, start/finishRegistration
  convex/stellar/passkeyNode.ts "use node": Smart Account Kit, provisioning, funding, balance
  convex/stellar/tips.ts        auth-guarded surface: prepareTip, submitTip, totals
  convex/stellar/tipsNode.ts    "use node": build/simulate/assemble, auth digest, submit
  convex/stellar/relayer.ts     OpenZeppelin Channels client (holds the API key)
  convex/stellar/diagnostics.ts error unwrapping + the DEBUG_ERRORS switch
  convex/stellar/config.ts      env validation — every Stellar env var is read here
  convex/stellar/internal.ts    default-runtime DB helpers (actions cannot write)
  convex/tips.ts                `listMyTips` — the Activity feed. A reactive query, not an
                                action; the only DB-sourced tip surface in the app
apps/web/lib/musea/passkey.ts   the browser's entire crypto role. No Stellar imports.
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

The v1 → v3 migration is **complete**. There is no custodial code left anywhere, and no
second signer.

| Area | State |
|---|---|
| Monorepo, configs, lint rules, CI-able task graph | Done |
| `packages/shared` stroop math + error map | Done, tested. Carries the passkey and relayer codes |
| Convex schema, auth guards, DB helpers, config validation | Done; codegen run, typechecks against a live dev deployment |
| `contracts/tipjar/` | **Done. Redeployed for the XLM cutover** — the token is a constructor arg, so only the binding changed. 10/10 tests, clippy clean, deployed `CCZPKSRPIFDHH4L33WQS3JF2GS5OS4FASCDXHSNGDRDCDTZXFB7DPZAP` bound to the native SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, sample tip `762d5d84…`, and a zero-trustline recipient proved at `d0eb9b53…`. The old USDC deployment `CAIH6NCC…` is retired. **Full hashes: [`docs/evidence.md`](docs/evidence.md)** |
| `convex/auth.ts` + `auth.config.ts` Better Auth wiring | Done. **Passkey sign-in is the only way in — email and password are disabled.** `convex/model/passkeyAuth.ts` is a hand-written Better Auth plugin (the official `passkey` plugin needs a table the Convex component's fixed schema does not have) |
| Musea app (artifacts, galleries, filing, profile) | Done and on a live dev deployment. Ported from the iOS repo; 41 backend tests, `convex-authz` clean |
| Passkey smart account, WebAuthn, relayer | **Done and proven on a real iPhone.** Deployed gaslessly through OpenZeppelin Channels, funded through the native SAC. See Epic 2B below |
| `convex/stellar/tipsNode.ts` | **Done.** prepare → device signs → submit, all gasless. The transaction never leaves the server; only a 32-byte challenge does |
| Tipping UI — tip sheet, balance chip, gallery total | **Done and working** (Stories 3.2/3.3/3.5), rewired onto the passkey actions. The badge reads contract state and links to the contract |
| Activity page, iPhone device pass, **deploy** | All **done**. Activity (3.4) at `/app/activity` — receipts linked to Stellar Expert, led by the on-chain `curator_total`. Device pass done for the passkey path; `/app/activity` itself has not been opened on a device. Deployed on Vercel at `musea-tips.vercel.app` |
| Evidence bundle | **Done** — [`docs/evidence.md`](docs/evidence.md). Every address and hash, read off the chain via `getEvents` rather than out of the `tips` table |

**Deliverable 2 is proven end to end on hardware.** A passkey-signed tip of 5 XLM landed
at `182571fe…baab6ab`, from smart account `CATDEQEY…` to `CAR7AU4R…`, authorized by Face
ID on an iPhone in Safari and submitted gaslessly — the user paid no fee and holds no
classic account. Both ends are `C…` contracts.

What is *not* proven: the Activity page **on a device** (it is built, typechecks and
prerenders, but nobody has opened `/app/activity` on a physical iPhone), the demo video
(not recorded), and anything on mainnet (out of scope, permanently).

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

## The passkey wallet

**One Face ID enrolment, two jobs.** The same credential signs you in and authorizes tips.
There is no password anywhere in the product.

**Signing in** is WebAuthn, via `convex/model/passkeyAuth.ts` — a hand-written Better Auth
plugin. Email and password are disabled in `convex/auth.ts` and are not coming back;
`e32deb4` said email had to stay "until something deliberately replaces it", and this is
that replacement. Three things follow that are **design, not bugs**:

- **A lost device is a lost account.** No recovery path exists, because every mechanism
  worth having — a second signer, social recovery, an email fallback — is either out of
  scope in SOW §4.1 or is the password this replaces.
- **`localhost` and `musea-tips.vercel.app` hold separate accounts, permanently.** A
  passkey is bound to its Relying Party ID. Development needs its own sign-up.
- **Every pre-existing email account is unreachable.** Nothing migrates them; there is no
  credential to migrate to.

**Holding value and authorizing a tip** is a passkey smart account: an OpenZeppelin smart
account contract on Soroban whose only signer is that same secp256r1 key, generated in the
device's Secure Enclave. Musea never sees it. A total backend compromise cannot move a
user's funds — and now cannot impersonate them either, since there is no password hash to
steal.

> **The two credential records are deliberately separate rows.** `passkeyCredentials` is
> the authenticator (written the instant an attestation verifies); `smartAccounts` is the
> wallet (written once four network round trips have landed). Same physical passkey,
> different lifecycles: if identity lived in `smartAccounts`, a user whose deployment
> failed could not sign back in to retry it, and `forgetWallet` would delete their account.
>
> **Identity resolves through Better Auth's `account` table, through neither of them.**
> That table is written only after a signature verifies; the other two hold key material
> used to *check* a signature. Collapsing the authenticator and the identity store into one
> row would make a single bad write both a forged key and a forged identity.

> **Sign-up does not wait for the wallet.** The session is minted as soon as the attestation
> verifies, and provisioning is scheduled (`passkeys.provisionWalletForSubject`). Holding
> the response open for four network round trips would present a relayer hiccup as
> "sign-up failed" for an account that was in fact created. The wallet card renders the
> `pending` state and already knows how to resume.

### The constraint everything is shaped around

**A Convex action cannot call the browser.** WebAuthn lives on the device, so every passkey
operation is two actions with the browser in the middle:

```
Convex action   build → simulate → assemble → derive the auth digest   ─┐
                                                                        ▼
browser                        navigator.credentials.get({ challenge })  → Face ID
                                                                        │
Convex action   attach the assertion → re-simulate → submit gaslessly  ◄┘
```

Smart Account Kit is written for a browser, where that round trip is one `await`. It works
server-side only because it takes its WebAuthn implementation as an injected dependency and
never verifies the challenge it generated — so each half can hand it a function that
*already has the answer*. `buildKit` in `stellar/passkeyNode.ts` is where that injection
happens.

### Five things that are load-bearing

- **Never recompute the auth digest by hand.** It binds the *context rule ids*, and a `tip`
  has **two** auth contexts — the call, and the SAC transfer nested inside it. Hardcoding
  `[0]` yields contract error 10000. `prepareTip` gets the challenge by running the kit's
  real signing path and aborting it the instant it reaches for the device, so both halves
  derive the digest from identical code.
- **A stored credential needs all four birth fields**, or it cannot be connected
  server-side: `birthWasmHash`, `creationTransactionHash`, `creationLedger`, and
  `birthConstructorArgsHash`. The first three keep the kit off the public indexer, which
  lags the network and does not serve the claim it wants. The fourth marks the credential
  *locally approved* — and **only a locally approved credential connects without a fresh
  WebAuthn assertion**, which a Convex action has no authenticator to produce. Take all
  four from the kit's own storage after `createWallet`; do not reconstruct them.
  `connectStoredWallet` refuses an incomplete set rather than falling through.
- **The transaction never leaves the server.** The browser holds an opaque tip id and 32
  bytes to sign. There is no client-supplied envelope to validate, which is a whole class
  of bug that does not exist here — the Freighter path needed `preparedTxHash` for exactly
  that, and the field is now dead weight kept only so old rows still validate.
- **Re-simulate after signing.** A WebAuthn signature is far larger than the placeholder
  used at first simulation, so the assembled resource fee is wrong until the transaction is
  simulated again. `signAndSubmitAdmin` does this; skipping it fails *after* Face ID.
- **Never call Horizon on a `C…` address.** A smart account has no classic account and no
  trustline — the SAC keeps its balance in contract storage — so `loadAccount` 404s
  forever. `readSacBalance` is the only balance read correct for both address kinds.

### Gasless submission

A contract cannot be a transaction's source or pay its fee, so OpenZeppelin Channels
supplies the source, sequence number and fee. `stellar/relayer.ts` is a hand-rolled client
because the kit's own `RelayerClient` sends no `Authorization` header — it is written for a
browser talking to a proxy that holds the key. We submit from an action, so the key is
already server-side and a proxy would buy nothing; `buildKit` overrides `kit.relayer.send`
to keep the kit's submission path with our header.

> **The relayer API key must never reach the client.** It authorises spending someone
> else's XLM on fees. A leaked key is an open relay, not a data leak. This is also why
> there is no Convex `httpAction` proxy — that would put an internet-facing endpoint in
> front of it.

### Debugging it

`DEBUG_ERRORS=true` in the Convex environment attaches the full error — `cause` chain,
stack frames, the fields these errors hide outside `message` — to the `ConvexError` the
browser receives, where the profile and tip sheet render it in a copyable panel. Server-side
logging is unconditional; grep the Convex logs for `[musea]`.

Keep it **off** for the demo. And note that **Vercel's logs are always empty for this** —
the browser talks to Convex directly, so nothing in this flow runs on Vercel at all.

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

> **A software authenticator will not catch everything, and it hid a real bug here.** The
> Story 2B.0 spike proved the cryptography headlessly with a WebCrypto P-256 authenticator,
> which happily answered *any* WebAuthn call the kit made — including the one
> `connectWallet` makes to verify credential ownership. Server-side that call can never be
> answered, and the failure only appeared on a real device. A software authenticator proves
> the signature path; it cannot prove that the server never needs an authenticator at all.

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
