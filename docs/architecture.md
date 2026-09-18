# Architecture

How Musea Curator Tips is put together, and why.

This document covers the shape of the system. For the contract's interface see
[`contract-reference.md`](./contract-reference.md), and for one tip traced end to end see
[`tip-flow.md`](./tip-flow.md).

---

## The shape of it

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  apps/web — Next.js App Router, React 19                                      │
│                                                                               │
│    Gallery page ──▶ Tip sheet ──▶ Face ID ──▶ toast                           │
│    Profile: wallet card, balance chip      Activity: receipts                 │
│                                                                               │
│    Imports: convex/react, @musea/shared, @simplewebauthn/browser              │
│    Does NOT import: @stellar/stellar-sdk, smart-account-kit  ← enforced       │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  Convex client (queries, mutations, actions)
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  packages/backend — Convex                                                    │
│                                                                               │
│   default runtime                      "use node" runtime                     │
│   ─────────────────                    ──────────────────                     │
│   auth guards        ───────────────▶  stellar/tipsNode.ts    build/simulate  │
│   schema.ts                            stellar/passkeyNode.ts  smart accounts │
│   tips.ts (queries)                    stellar/passkeyAuthNode.ts  verify     │
│   stellar/tips.ts                      stellar/relayer.ts     gasless submit  │
│   stellar/passkey.ts                   stellar/config.ts      env validation  │
│   stellar/internal.ts  (DB writes)                                            │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  Horizon · Soroban RPC · OpenZeppelin Channels
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Stellar testnet                                                              │
│                                                                               │
│   TipJar contract  ──calls──▶  native XLM SAC                                 │
│   user smart accounts (OpenZeppelin, secp256r1 passkey signer)                │
│   on-chain WebAuthn verifier                                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

`packages/shared` sits beside all of this. It's pure TypeScript used by both sides for
stroop arithmetic, error classification and Stellar Expert links. It exports `.ts` source
directly and Next transpiles it, so there's no build step and no build ordering to worry
about.

---

## The three rules

Everything else follows from these.

### 1. No blockchain code in the browser

Every Stellar operation, from build through simulate, assemble, submit and poll, happens in
a Convex action under `packages/backend/convex/stellar/`. The web app calls Convex and
renders the result.

This is enforced by `no-restricted-imports` in `@musea/eslint-config/next` rather than left
to reviewer discipline. If a change appears to need `@stellar/stellar-sdk` in `apps/web`,
the design is wrong; move the work into the action.

Three reasons, in order of how much they cost when ignored:

- **Correctness.** The Soroban lifecycle is build, simulate, assemble, sign, send, poll.
  Skipping `assemble` omits the resource fee and the transaction fails. Keeping that
  sequence in one place, on one runtime, means one implementation to get right.
- **Bundle size.** The Stellar SDK is large and the target device is an iPhone on a mobile
  connection.
- **Trust boundary.** The server decides what transaction gets built. There's no path where
  a client hands us an envelope and asks us to submit it.

The passkey model doesn't relax any of this. WebAuthn is a browser platform API
(`navigator.credentials`), not a Stellar library: the browser receives an authorization
payload, returns a signature, and imports no Stellar package to do it. Some passkey SDKs
are written to run client-side and will drag `stellar-base` into the bundle, so wrap only
their WebAuthn half. The whole of the browser's cryptographic role is
[`apps/web/lib/musea/passkey.ts`](../apps/web/lib/musea/passkey.ts), 152 lines with no
Stellar import.

### 2. No `userId` arguments on user-scoped functions

The caller is whoever `ctx.auth.getUserIdentity()` says they are. A client-supplied
`userId` lets anyone move funds from anyone else's wallet, and it's an easy shape to
introduce by accident, because it makes functions convenient to test.

Authorization helpers live in
[`convex/model/auth.ts`](../packages/backend/convex/model/auth.ts), and every user-scoped
function goes through them.

There's one necessary exception. `submitTip` has to take a `tipId`, because the browser
holds it across the Face ID prompt and hands it back. So `submitTip` re-derives server-side
that the tip belongs to this caller and is still pending, via `getOwnedPendingTip`, before
touching it.

### 3. Musea never holds key material

Not in plaintext, not encrypted, not in memory. The signing key is generated inside the
device's Secure Enclave by the WebAuthn authenticator and isn't extractable, by us or by
anyone else.

What may be persisted per user is the smart account's contract address and the passkey
credential id and public key, all public by construction. A total compromise of this
backend can't move a single user's funds.

There is no code anywhere in this repository that stores, wraps or unwraps key material,
and there should never be. If you find yourself writing envelope encryption, key rotation,
or a `decrypt()` call, stop and reread this rule.

---

## The constraint the passkey design is shaped around

A Convex action can't call the browser, and WebAuthn lives on the device. So every passkey
operation is two actions with the browser in the middle:

```
  Convex action    build → simulate → assemble → derive the auth digest   ─┐
                                                                           ▼
  browser                        navigator.credentials.get({ challenge })  → Face ID
                                                                           │
  Convex action    attach the assertion → re-simulate → submit gaslessly  ◄┘
```

Smart Account Kit is written for a browser, where that round trip is a single `await`. It
works server-side only because it takes its WebAuthn implementation as an injected
dependency and never verifies the challenge it generated, so each half can hand it a
function that already has the answer. `buildKit` in
[`stellar/passkeyNode.ts`](../packages/backend/convex/stellar/passkeyNode.ts) is where that
injection happens, and anything the kit calls that wasn't injected throws loudly rather
than silently falling back.

### Five things that are load-bearing

- **Never recompute the auth digest by hand.** It binds the context rule ids, and a `tip`
  has two auth contexts: the call, and the SAC transfer nested inside it. Hardcoding one
  yields an opaque contract error. `prepareTip` obtains the challenge by running the kit's
  real signing path and aborting it the instant it reaches for the device, so both halves
  derive the digest from identical code.
- **A stored credential needs all four birth fields:** `birthWasmHash`,
  `creationTransactionHash`, `creationLedger` and `birthConstructorArgsHash`. Without them
  it can't be connected server-side. The first three keep the kit off the public indexer,
  which lags the network. The fourth marks the credential locally approved, and only a
  locally approved credential connects without a fresh WebAuthn assertion, which a Convex
  action has no authenticator to produce.
- **The transaction never leaves the server.** The browser holds an opaque tip id and 32
  bytes. There's no client-supplied envelope to validate, which removes a whole class of
  bug rather than defending against it.
- **Re-simulate after signing.** A WebAuthn signature is far larger than the placeholder
  used at first simulation, so the assembled resource fee is wrong until the transaction is
  simulated again. Skipping this fails after Face ID, which is the worst possible moment.
- **Never call Horizon on a `C…` address.** A smart account has no classic account and no
  trustline, since the SAC keeps its balance in contract storage, so `loadAccount` 404s
  forever. `readSacBalance` is the only balance read correct for both address kinds.

---

## Gasless submission

A contract can't be a transaction's source or pay its fee, so OpenZeppelin Channels
supplies the source account, the sequence number and the fee.

[`stellar/relayer.ts`](../packages/backend/convex/stellar/relayer.ts) is a hand-rolled
client because the kit's own `RelayerClient` sends no `Authorization` header; it's written
for a browser talking to a proxy that holds the key. We submit from an action, so the key
is already server-side and a proxy would buy nothing. `buildKit` overrides
`kit.relayer.send` to keep the kit's submission path while adding our header.

The relayer API key must never reach the client. It authorizes spending someone else's XLM
on fees, so a leaked key is an open relay rather than a data leak. That's also why there's
no Convex `httpAction` proxy in front of it, which would put an internet-facing endpoint
between the internet and the key.

The result is visible on-chain: on every passkey tip, the transaction's `fee_account` is
the sponsor, not the tipper. See
[`evidence.md`, section 2.3](./evidence.md#the-gasless-claim-from-the-ledger).

---

## Authentication

One Face ID enrolment does two jobs: it signs you in, and it authorizes tips. There's no
password anywhere in the product.

Sign-in is WebAuthn through
[`convex/model/passkeyAuth.ts`](../packages/backend/convex/model/passkeyAuth.ts), a
hand-written Better Auth plugin exposing four `/passkey/*` endpoints. The official
`passkey` plugin needs a table the Convex component's fixed schema doesn't have. Assertions
are verified in
[`stellar/passkeyAuthNode.ts`](../packages/backend/convex/stellar/passkeyAuthNode.ts) with
`@simplewebauthn/server`, which is the only thing standing between a stranger and an
account.

Three tables, deliberately separate:

| Table | Holds | Written when |
|---|---|---|
| `passkeyCredentials` | the authenticator's public key and handle | the instant an attestation verifies |
| `smartAccounts` | the wallet: contract address, birth provenance | once four network round trips have landed |
| Better Auth `account` | identity | only after a signature verifies |

Same physical passkey, different lifecycles. If identity lived in `smartAccounts`, a user
whose deployment failed couldn't sign back in to retry it, and forgetting a wallet would
delete their account. Collapsing the authenticator into the identity store would make a
single bad write both a forged key and a forged identity: the first two tables hold key
material used to check a signature, while the third records that one passed.

Sign-up doesn't wait for the wallet. The session is minted as soon as the attestation
verifies, and provisioning is scheduled. Holding the response open for four network round
trips would present a relayer hiccup as "sign-up failed" for an account that was in fact
created. The wallet card renders the `pending` state and knows how to resume.

---

## Data and money

Stroops are authoritative. A stroop is 1/10,000,000 XLM. Amounts are `bigint` stroops
everywhere they're computed, and display strings are derived from them, never the other way
round. Always go through `@musea/shared`: `toStroops`, `fromStroops`, `formatXlm`. Never
`amount * 1e7`, which is a float and will eventually be wrong by one stroop.

Convex has no bigint type, so stroops are persisted as strings.

The contract keys totals by `BytesN<32>` = `sha256(galleryId)`, computed in the Convex
action by the single function `galleryHash`. There must be exactly one definition: hash the
id differently in two places, trimmed or lowercased or prefixed, and the totals silently
split across two contract keys that each look perfectly plausible.

On-chain numbers come from the chain. A gallery's "total tipped" is read from contract
state via `gallery_total`, and a curator's lifetime received via `curator_total`. Neither
is summed from the `tips` table. If either rendered from our database, the product would be
asserting something it hadn't proven.

The `tips` table still exists and is still shown, as the Activity feed. It's the receipt
book sitting next to the ledger, labelled as such, so a divergence between the two would be
visible instead of hidden.

Errors are classified with `classifyStellarError`, the code is persisted, and the UI shows
`userMessageFor(code)`. Raw Horizon and RPC errors never reach the UI. Full detail goes to
`tips.errorDetail`, server-side only.

---

## iPhone Safari

The verification target, and stricter than desktop Chrome about all of it.

- Use `dvh`, never `vh`. Safari's URL bar collapses and `100vh` overflows.
- Inputs need a computed font-size of at least 16px or Safari zooms on focus and never
  returns.
- `viewport-fit=cover` is what makes `env(safe-area-inset-*)` work, and bottom-pinned
  controls need `.pb-safe` to clear the home indicator.
- Tap targets should be at least 44x44.
- Keep auth same-origin. ITP is stricter than Chrome about cross-site cookies, and stricter
  again in a private window.

For WebAuthn specifically:

- **One stable domain, decided before anyone registers.** A credential created on a Vercel
  preview URL won't resolve on the next preview URL, on production, or on `localhost`.
  Per-branch preview deploys and passkeys are fundamentally incompatible.
- **Call `navigator.credentials.*` inside the tap handler, synchronously.** Safari consumes
  user activation across an `await`. Fetching the challenge and then calling `get()` is the
  common way to make the Face ID sheet silently never appear, so have the challenge in hand
  before the tap resolves.
- **Secure context required.** HTTPS everywhere; `localhost` is the only exempt origin.
- **The signature isn't over your payload.** WebAuthn signs
  `authenticatorData ‖ SHA256(clientDataJSON)`, with the challenge embedded in
  `clientDataJSON`. The assertion is DER-encoded and often high-S, while Soroban's
  `secp256r1_verify` wants raw 64-byte `r‖s`, low-S normalized. This is the most likely
  source of "valid signature, contract says no."

A software authenticator won't catch everything. An early spike proved the cryptography
headlessly with a WebCrypto P-256 authenticator, which happily answered any WebAuthn call
the kit made, including one that can never be answered server-side. That failure only
appeared on a real device. A software authenticator proves the signature path, but it can't
prove that the server never needs an authenticator at all.

---

## Testnet resets

Stellar testnet is wiped roughly every quarter. Every account, asset and contract
disappears, and the app starts returning 404s. Recovery is `./scripts/setup-testnet.sh`
plus updating the Convex environment variables, then regenerating
[`evidence.md`](./evidence.md).

Don't hand-create testnet state that the script can't reproduce.
