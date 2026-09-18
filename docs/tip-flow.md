# One tip, end to end

A single 5 XLM tip traced from the tap to the updated on-chain total, naming the file that
does each thing.

If you read one document to understand this codebase, read this one.

---

## The whole thing in one diagram

```
 ┌─ browser ────────────────────┐   ┌─ Convex ───────────────┐   ┌─ Stellar ──────────┐
 │                              │   │                        │   │                    │
 │ 1  sheet opens               │   │                        │   │                    │
 │      └──────────────────────────▶│ 2  prepareTip          │   │                    │
 │                              │   │      build             │──▶│  simulate (RPC)    │
 │                              │   │      simulate          │◀──│                    │
 │                              │   │      assemble          │   │                    │
 │                              │   │      derive digest     │   │                    │
 │ 3  challenge in hand    ◀────────│      record `pending`  │   │                    │
 │                              │   │                        │   │                    │
 │ 4  user taps Send            │   │                        │   │                    │
 │      navigator.credentials   │   │                        │   │                    │
 │      .get({ challenge })     │   │                        │   │                    │
 │      → Face ID               │   │                        │   │                    │
 │      → assertion             │   │                        │   │                    │
 │      └──────────────────────────▶│ 5  submitTip           │   │                    │
 │                              │   │      check ownership   │   │                    │
 │                              │   │      check challenge   │   │                    │
 │                              │   │      attach assertion  │   │                    │
 │                              │   │      RE-SIMULATE       │──▶│  simulate          │
 │                              │   │      submit ───────────────│─▶ relayer ─▶ ledger│
 │ 6  toast + tx hash      ◀────────│      mark `success`    │◀──│  poll              │
 │                              │   │                        │   │                    │
 │ 7  totals refresh       ◀────────│ getGalleryTotal ───────────│─▶ gallery_total    │
 └──────────────────────────────┘   └────────────────────────┘   └────────────────────┘
```

Two round trips, because a Convex action can't call a browser. WebAuthn lives on the
device, so the one step that has to happen there, signing, splits the flow in half. Steps 2
and 5 are two separate Convex actions.

---

## 0. Before the tap

The user already has a smart account: an OpenZeppelin contract on Soroban whose only signer
is a passkey in their device's Secure Enclave, created at sign-up and funded with test XLM.
Its address is a `C…`, not a `G…`. They hold no classic Stellar account and no XLM for
fees.

The gallery page shows the curator's gallery and its total tipped, read live from the
contract's `gallery_total` in `components/musea/gallery-total.tsx`.

---

## 1. The sheet opens

`components/musea/tip-sheet.tsx`, a Vaul bottom sheet with preset amounts.

---

## 2. prepareTip, everything except the signature

This runs as soon as the sheet opens, and again whenever the amount changes, rather than
when Send is tapped. It's the load-bearing detail of the whole iPhone flow, and
[step 4](#4-the-tap) explains why.

`convex/stellar/tips.ts` holds `prepareTip`, the auth-guarded surface. It takes no
`userId`; the tipper is whoever the session says is calling. It resolves that, then hands
off to `convex/stellar/tipsNode.ts`, which does the Stellar work in the Node runtime.

Each step is tagged so a failure can name where it got to:

| Step | What | Fails as |
|---|---|---|
| `load-account` | Find the caller's smart account | `PASSKEY_NOT_REGISTERED` |
| `resolve-curator` | Load the gallery, refuse self-tips, resolve the curator's address | `SELF_TIP`, `CURATOR_NOT_CONNECTED` |
| `parse-amount` | `"5"` → `50000000n` stroops via `@musea/shared` | `INVALID_AMOUNT` |
| `connect-kit` | Connect the smart account, verifying its on-chain birth | `PASSKEY_AUTH_REJECTED` |
| `read-balance` | Check the balance covers it, before asking for a face | `INSUFFICIENT_BALANCE` |
| `build-simulate` | Build, simulate and assemble the `tip` call | `SIMULATION_FAILED` |
| `latest-ledger` | Pin a signature expiry, 720 ledgers (about an hour) out | — |
| `derive-challenge` | Obtain the 32-byte auth digest | `UNKNOWN` |
| `record` | Write the `tips` row as `pending` | — |

Three of these are worth dwelling on.

### The balance is checked before Face ID

Simulation would catch an overdraft anyway, but only as a SAC error surfacing after the
user has already authenticated. Asking someone for their face and then telling them they
have insufficient funds is the wrong order.

### The call is routed through the smart account's execute

```ts
const tx = await kit.execute(cfg.tipjarContractId, "tip", [
  Address.fromString(connected.contractAddress).toScVal(),  // from: the smart account
  Address.fromString(toAddress).toScVal(),                  // to:   the curator
  xdr.ScVal.scvBytes(galleryHash(galleryId)),               // sha256(galleryId)
  nativeToScVal(stroops, { type: "i128" }),                 // amount in stroops
]);
```

The smart account is the caller and therefore `from`, which is what makes TipJar's
`require_auth` dispatch into the account's `__check_auth`, where the WebAuthn signature is
actually verified against the on-chain secp256r1 verifier.

### The challenge is derived by running the real signing path and aborting it

This is the single most important line of defence in the codebase.

The auth digest binds the context rule ids, and a `tip` has two auth contexts: the call
itself, and the SAC `transfer` nested inside it. Computing the digest independently means
reimplementing private context-rule resolution, and getting it subtly wrong produces a
signature the contract rejects for reasons that read as entirely unrelated.

So `captureAuthChallenge` doesn't reimplement anything. It temporarily replaces the kit's
injected `startAuthentication` with a function that records the challenge and throws a
sentinel, runs the kit's real `signAndSubmitAdmin`, and catches the sentinel:

```ts
kitWithShim.webAuthn.startAuthentication = (args) => {
  challenge = args.optionsJSON.challenge;
  throw ABORT;
};
```

Both halves of the flow therefore derive the digest from identical code. Nothing is
submitted, since the throw happens inside signing, well before the submit step.

### What comes back to the browser

```ts
{ tipId, challenge, credentialId, rpId }
```

That's all of it. The transaction never leaves the server; the browser holds an opaque id
and 32 bytes to sign. There's no client-supplied envelope to validate, which removes a
whole class of bug rather than defending against it.

The `tips` row is written before anything is signed, so nothing can be submitted without a
row to reconcile against. It also arms the double-submit guard.

---

## 3. Waiting

The Send button stays disabled until the challenge has arrived. It's gated on
`prepared !== null` precisely so that Send is never the thing that goes and fetches it.

---

## 4. The tap

```ts
const assertion = await signTipChallenge(prepared);   // lib/musea/passkey.ts
```

`apps/web/lib/musea/passkey.ts` is the browser's entire cryptographic role: 152 lines
wrapping `@simplewebauthn/browser`, importing no Stellar package. The device is handed 32
bytes and returns a signature over them. It never learns what those bytes mean, never
builds a transaction, and never sees an address.

**Why step 2 runs on sheet-open.** Safari consumes user activation across an `await`. If
Send were to fetch the challenge and then call `navigator.credentials.get()`, that call
would happen outside the tap gesture, and the Face ID sheet silently never appears. No
error, no exception, nothing to catch. Having the challenge in hand before the user commits
is what makes the `get()` call synchronous inside the tap handler, and the two-action
backend split exists to make that possible.

Face ID prompts. The Secure Enclave signs `authenticatorData ‖ SHA256(clientDataJSON)`,
not the challenge directly; the challenge is embedded inside `clientDataJSON`.

If the user dismisses the sheet, the client fires `cancelPreparedTip`, which marks the row
`SIGNATURE_REJECTED` purely to release the double-submit guard. Nothing was built, signed
or submitted, so those rows are filtered out of the Activity feed rather than displayed as
failures.

---

## 5. submitTip, attach, re-simulate, send

`convex/stellar/tips.ts` holds `submitTip`, which re-derives the caller from the session
and then hands off to `tipsNode.ts`.

### Ownership is re-checked server-side

`tipId` is client-supplied out of necessity, since the browser held it across the Face ID
prompt. So `getOwnedPendingTip` re-derives that the tip belongs to this caller and is still
pending. That's rule 2 applied to an id which has no choice but to round-trip.

### The assertion must answer the challenge this tip issued

```ts
const answered = clientDataChallenge(assertion);   // decode clientDataJSON
if (answered !== tip.authChallenge) throw new TipError("CHALLENGE_MISMATCH", …);
```

The kit recomputes the digest and would fail anyway on a mismatch, but it fails deep inside
signing with a message about context rules. Checking here turns the most likely passkey bug
into a named error instead of a puzzle.

### The transaction is rehydrated, not rebuilt

`rehydrate()` reconstructs the `AssembledTransaction` from the stored XDR. It must not be
rebuilt: the digest the passkey signed was derived from exactly this transaction and this
expiration ledger. Rebuild either one and the digest moves, and `__check_auth` rejects a
signature that's otherwise perfectly valid.

### Re-simulate, then submit

```ts
const result = await kit.signAndSubmitAdmin(rehydrated, {
  credentialId: account?.credentialId,
  expiration:   tip.signatureExpirationLedger,
  forceMethod:  "relayer",
});
```

A WebAuthn signature is far larger than the placeholder used at first simulation, so the
assembled resource fee is wrong until the transaction is simulated again with the real
signature in place. `signAndSubmitAdmin` does this. Skipping it fails on submit, after Face
ID, which is the worst possible moment.

### Gasless submission

A contract can't be a transaction's source or pay its fee. `forceMethod: "relayer"` routes
through `convex/stellar/relayer.ts` to OpenZeppelin Channels, which supplies the source
account, the sequence number and the fee.

The result is visible on-chain. On
[`182571fe…`](./evidence.md#23-the-headline-transaction):

| Field | Value |
|---|---|
| tipper | `CATDEQEY…`, a contract, which can't pay a fee |
| `source_account` | `GCDKGBSZ…`, a relayer channel account |
| `fee_account` | `GCNJB6V5…`, the sponsor who actually paid |

---

## 6. On-chain

The contract, in order: `require_auth`, validate, transfer the XLM, add to `GalleryTotal`,
add to `CuratorTotal`, extend TTLs, emit `TipEvent`.

The transfer happens first so that a failed transfer can never leave a total behind. See
[`contract-reference.md`](./contract-reference.md#tipfrom-to-gallery-amount---result-error).

---

## 7. Back in the browser

The row is marked `success` with its `txHash`, and a toast appears with a link to Stellar
Expert.

Two things then update, from two different sources, on purpose:

| What | Where it reads from |
|---|---|
| The gallery's total tipped | `gallery_total`, contract state |
| The Activity feed row | the `tips` table, our database, via a reactive Convex query |

The Activity page leads with `curator_total`, also from the chain, above a list that's
database-sourced. They sit side by side deliberately, so a divergence between what the
chain says and what we recorded would be visible instead of hidden.

`convex/tips.ts` holds `listMyTips`, a reactive `query` rather than an action, so a pending
tip flipping to success updates the list with no polling in the UI. It takes no `userId`,
and it projects rows field by field rather than spreading the document, so the server-only
`errorDetail` column can't leak when someone later adds a field.

---

## When it goes wrong

Every failure is classified into a `TipErrorCode`, persisted, and shown as a sentence. Raw
Horizon and RPC errors never reach the UI; full detail goes to `tips.errorDetail`,
server-side only.

| The user sees | Because |
|---|---|
| "Not enough balance." | Checked before Face ID, so this never appears after authenticating |
| "You can't tip your own gallery." | Refused at prepare time |
| "This curator hasn't connected a wallet yet…" | The curator has no deployed smart account |
| "Tip cancelled." | The Face ID sheet was dismissed, and nothing was submitted |
| "That tip expired before it was signed." | `CHALLENGE_MISMATCH`: the assertion answers a different challenge |
| "That signature wasn't accepted." | The on-chain verifier rejected it |
| "Can't reach the network right now." | The relayer is at capacity or unreachable |
| "That tip is already going through…" | The double-submit guard |

Setting `DEBUG_ERRORS=true` in the Convex environment attaches the full error, including
the cause chain, stack frames and the fields these errors hide outside `message`, to the
`ConvexError` the browser receives, where the tip sheet renders it in a copyable panel.
Keep it off for a demo. Server-side logging is unconditional either way: grep the Convex
logs for `[musea]`.

Vercel's logs are always empty for this flow, since the browser talks to Convex directly
and nothing in a tip runs on Vercel at all.
