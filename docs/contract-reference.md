# TipJar contract reference

The Soroban contract behind every tip. Rust, `soroban-sdk` 27.0.6, MIT.

Source: [`contracts/tipjar/src/lib.rs`](../contracts/tipjar/src/lib.rs) ·
Tests: [`contracts/tipjar/src/test.rs`](../contracts/tipjar/src/test.rs)

---

## Deployed

| | |
|---|---|
| Network | Stellar testnet |
| Contract id | `CCZPKSRPIFDHH4L33WQS3JF2GS5OS4FASCDXHSNGDRDCDTZXFB7DPZAP` |
| Explorer | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCZPKSRPIFDHH4L33WQS3JF2GS5OS4FASCDXHSNGDRDCDTZXFB7DPZAP) |
| Bound token | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, the native XLM Stellar Asset Contract |

The token is fixed at construction and isn't a call parameter. See
[Why the token is a constructor argument](#why-the-token-is-a-constructor-argument).

---

## Entrypoints

### `__constructor(token: Address)`

Runs once at deploy time. Stores `token`, the Stellar Asset Contract this TipJar moves, in
instance storage. There's no setter and no upgrade path.

```bash
stellar contract deploy --wasm tipjar.wasm --source <deployer> --network testnet \
  -- --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

---

### `tip(from, to, gallery, amount) -> Result<(), Error>`

The only state-changing entrypoint.

| Parameter | Type | Meaning |
|---|---|---|
| `from` | `Address` | The tipper. Must authorize the call |
| `to` | `Address` | The curator being tipped |
| `gallery` | `BytesN<32>` | `sha256(galleryId)`, the gallery key |
| `amount` | `i128` | Stroops, not XLM. 1 XLM = 10,000,000 |

Both `from` and `to` can be a classic `G…` account or a `C…` contract. The contract doesn't
distinguish, which is why Deliverable 1 could be proven from the CLI before any wallet
layer existed.

What it does, in order:

1. `from.require_auth()`. Under the passkey model this dispatches to the smart account's
   `__check_auth`, which verifies the WebAuthn assertion against the on-chain secp256r1
   verifier.
2. Reject `amount <= 0` (`InvalidAmount`) and `from == to` (`SelfTip`).
3. Read the bound token from instance storage (`NotInitialized` if absent).
4. Transfer the money first, via `TokenClient::transfer(from, to, amount)`.
5. Add `amount` to `GalleryTotal(gallery)`, using `checked_add`.
6. Add `amount` to `CuratorTotal(to)`, using `checked_add`.
7. Extend the TTL on both persistent entries and on instance storage.
8. Emit a `TipEvent`.

The ordering in step 4 is load-bearing. If the transfer traps, whether from insufficient
balance, a missing trustline on an issued asset, or a frozen account, the whole invocation
reverts and no total is written. Totals can never describe a transfer that didn't happen,
and the test `failed_transfer_records_no_total` pins that.

Note `checked_add` rather than `+`. An overflow that silently wrapped would make a
gallery's headline number wrong forever, and persistent storage has no undo.

---

### `gallery_total(gallery: BytesN<32>) -> i128`

Total ever tipped to a gallery, in stroops. Read-only. Returns `0` for a gallery the
contract has never seen, since a gallery with no tips and an unknown gallery are the same
answer as far as the app is concerned.

```bash
stellar contract invoke --id CCZPKSRPIFDHH4L33WQS3JF2GS5OS4FASCDXHSNGDRDCDTZXFB7DPZAP \
  --source <any funded account> --network testnet --send=no \
  -- gallery_total --gallery ca32c7705de03b51fb241509bb18774a160bc89cbc9be740ae50b82ecfb7c98e
```

This is what the gallery badge in the app renders. It's never summed from the database.

---

### `curator_total(curator: Address) -> i128`

Total a curator has ever received across all galleries, in stroops. Read-only. Returns `0`
for an unknown address.

```bash
stellar contract invoke --id CCZPKSRPIFDHH4L33WQS3JF2GS5OS4FASCDXHSNGDRDCDTZXFB7DPZAP \
  --source <any funded account> --network testnet --send=no \
  -- curator_total --curator CAR7AU4RO6DQKLMM6RT5FZXJJ7BW35RGEVCFAINHSZ4RNKJAXJGMSV6H
```

This is the "Received, all time" figure on the Activity page.

---

### `token() -> Result<Address, Error>`

The Stellar Asset Contract this TipJar is bound to. Exposed so the backend can assert at
startup that it's pointed at the token it thinks it is, and so a reviewer can verify the
binding without trusting documentation.

---

## Errors

`#[contracterror]`, `#[repr(u32)]`. On-chain these surface as `Error(Contract, #N)`.

| # | Variant | Raised when |
|---|---|---|
| 1 | `NotInitialized` | Instance storage has no token. Only reachable if the constructor never ran |
| 2 | `InvalidAmount` | `amount <= 0` |
| 3 | `SelfTip` | `from == to` |
| 4 | `Overflow` | A running total would exceed `i128::MAX` |

Errors from the token contract pass through unchanged. They belong to the SAC rather than
to TipJar, and they're the ones you'll actually see in practice, most often insufficient
balance. The backend classifies both kinds through `classifyStellarError` in
`@musea/shared` and shows the user a sentence rather than a code.

`Error(Contract, #13)` from a SAC is the classic "no trustline" failure. It can't occur on
this deployment, because XLM needs no trustline, but the classifier for it was kept
deliberately, for the day this moves to an issued asset.

---

## Storage

| Key | Kind | Value |
|---|---|---|
| `DataKey::Token` | instance | `Address` of the bound SAC |
| `DataKey::GalleryTotal(BytesN<32>)` | persistent | `i128` stroops |
| `DataKey::CuratorTotal(Address)` | persistent | `i128` stroops |

### TTL

```rust
const TTL_THRESHOLD: u32 = 100;
const TTL_EXTEND_TO:  u32 = 518_400;   // ~30 days of ledgers
```

Both persistent entries are bumped on every write, so an actively tipped gallery never
expires. A dormant one can be restored rather than lost, since archived Soroban state is
recoverable.

### The gallery key

`BytesN<32>` = `sha256(galleryId)`, where `galleryId` is the Convex document id as a plain
UTF-8 string, with no trimming, lowercasing or prefix.

It's computed in exactly one place on the app side, `galleryHash` in
[`stellar/tipsNode.ts`](../packages/backend/convex/stellar/tipsNode.ts), because two
slightly different hashings would split a gallery's total across two contract keys that
each look perfectly plausible on their own.

```bash
# Reproduce a gallery key
printf '%s' 'j57cs46j33nn04h7x6e9enra358eesme' | sha256sum
```

---

## Events

```rust
#[contractevent(topics = ["tip"])]
pub struct TipEvent {
    pub from:    Address,
    pub to:      Address,
    pub gallery: BytesN<32>,
    pub amount:  i128,
}
```

One event per successful tip. Read them from RPC:

```bash
curl -s https://soroban-testnet.stellar.org -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"getEvents","params":{
    "startLedger": <recent ledger>,
    "filters":[{"type":"contract",
      "contractIds":["CCZPKSRPIFDHH4L33WQS3JF2GS5OS4FASCDXHSNGDRDCDTZXFB7DPZAP"]}],
    "pagination":{"limit":200}}}'
```

Stellar RPC retains only a few days of events. Contract state persists and can be read at
any time, but the event log can't, which is why every transaction hash is written down in
[`evidence.md`](./evidence.md) rather than left to be rediscovered.

---

## Design decisions

### Why the token is a constructor argument

If callers could pass the token address, anyone could invoke `tip` with a worthless token
they minted themselves and inflate a gallery's total for free. Fixing it at construction
makes the contract's own storage the allowlist, and `token()` makes that allowlist publicly
auditable.

It also means retargeting the contract at a different token is a redeploy with a different
constructor argument rather than a contract change. Not one line of `lib.rs` moves.

### What the totals are, and are not

The totals are honest about what was transferred. They aren't a reputation score resistant
to collusion: nothing in the contract prevents two accounts from tipping each other back
and forth to inflate their own numbers. That's a known and accepted limitation at this
scope, recorded here so the documentation doesn't claim otherwise.

### Why there is no withdraw, escrow or admin

The contract is deliberately minimal. Money moves through it and is never held by it, so
there's no balance to withdraw, no admin key to compromise and no upgrade path to misuse.
Escrow, refunds, fee-splitting and upgradeability are all out of scope.

---

## Building and testing

```bash
cargo test   --manifest-path contracts/tipjar/Cargo.toml
cargo clippy --manifest-path contracts/tipjar/Cargo.toml --all-targets -- -D warnings
cargo fmt    --manifest-path contracts/tipjar/Cargo.toml --all -- --check

# or, through the task graph
turbo run test --filter=@musea/tipjar
```

### The test suite

Ten tests. Each name is a claim someone can re-run, and the latest output is in
[`evidence.md`, section 1.4](./evidence.md#14-test-suite-lints-and-formatting).

| Test | Claim |
|---|---|
| `tip_moves_xlm_and_records_totals` | The happy path moves money and writes both totals |
| `totals_accumulate_across_tips_and_tippers` | Totals add up across repeat tips and different tippers |
| `totals_are_scoped_per_gallery` | One gallery's tips don't leak into another's total |
| `tip_requires_tipper_auth` | Without the tipper's authorization, the call fails |
| `rejects_self_tip` | `from == to` is refused |
| `rejects_zero_and_negative_amounts` | `amount <= 0` is refused |
| `failed_transfer_records_no_total` | A trapped transfer writes no total |
| `unknown_gallery_reads_zero` | An unseen gallery reads `0`, not an error |
| `emits_tip_event` | A successful tip emits `TipEvent` with the right fields |
| `token_address_is_fixed_at_construction` | The bound token is what the constructor was given |

`tip_requires_tipper_auth` was checked by deleting the `require_auth` call and confirming
the test then fails. A test that still passes against a contract with no authorization at
all isn't proving anything.
