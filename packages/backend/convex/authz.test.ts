import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";
import { modules } from "./test.helpers";
import type { Id } from "./_generated/dataModel";

/**
 * Authorization negatives (Story 2.6).
 *
 * These are the tests that matter. A happy-path test proves the feature works; these prove
 * the thing docs/architecture.md calls rule 2 — the caller is whoever `ctx.auth` says, never an
 * argument — is actually enforced rather than merely intended.
 *
 * Every case here is written as "user B tries to reach user A's data" and asserts refusal.
 */

const ALICE = "auth|alice";
const BOB = "auth|bob";

async function seedTwoUsersAndATip(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const alice = await ctx.db.insert("users", {
      authSubject: ALICE,
      name: "Alice",
      handle: "alice",
      createdAt: Date.now(),
    });
    const bob = await ctx.db.insert("users", {
      authSubject: BOB,
      name: "Bob",
      handle: "bob",
      createdAt: Date.now(),
    });

    const gallery = await ctx.db.insert("galleries", {
      ownerId: bob,
      title: "Bob's gallery",
      // Public, because that is the case these tests are about: what a stranger can read
      // off a gallery they are allowed to open. A private gallery answers null to
      // everyone but its owner, which leaks nothing but also proves nothing.
      isPublic: true,
      createdAt: Date.now(),
    });

    // Alice has a deployed smart account; Bob deliberately does not. Every "can B see A's
    // wallet" case below depends on exactly one of them having one.
    await ctx.db.insert("smartAccounts", {
      userId: alice,
      contractAddress: "CALICE",
      credentialId: "cred-alice",
      publicKeyHex: "04aa",
      rpId: "musea-tips.vercel.app",
      status: "deployed",
      funded: true,
      createdAt: Date.now(),
    });

    const tip = await ctx.db.insert("tips", {
      fromUserId: alice,
      toUserId: bob,
      galleryId: gallery,
      fromPublicKey: "CALICE",
      toPublicKey: "CBOB",
      galleryHashHex: "deadbeef",
      amountStroops: "50000000",
      status: "failed",
      errorCode: "NO_TRUSTLINE",
      // The field that must never reach a browser.
      errorDetail: "raw horizon envelope_xdr AAAAAgAAAAB…",
      createdAt: Date.now(),
    });

    return { alice, bob, gallery, tip };
  });
}

describe("tip history is scoped to the caller", () => {
  test("a third party sees none of it", async () => {
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authSubject: "auth|carol",
        name: "Carol",
        handle: "carol",
        createdAt: Date.now(),
      });
    });

    const asCarol = t.withIdentity({ subject: "auth|carol" });
    expect(await asCarol.query(api.tips.listMyTips, {})).toEqual([]);
  });

  test("both parties to a tip see it, from their own side", async () => {
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    const sent = await t.withIdentity({ subject: ALICE }).query(api.tips.listMyTips, {});
    const received = await t.withIdentity({ subject: BOB }).query(api.tips.listMyTips, {});

    expect(sent).toHaveLength(1);
    expect(received).toHaveLength(1);
    expect(sent[0]?.direction).toBe("sent");
    expect(received[0]?.direction).toBe("received");
  });

  test("signed out is an empty feed, not an error", async () => {
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);
    expect(await t.query(api.tips.listMyTips, {})).toEqual([]);
  });

  test("errorDetail never leaves the backend", async () => {
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    const rows = await t.withIdentity({ subject: ALICE }).query(api.tips.listMyTips, {});

    expect(rows[0]?.errorCode).toBe("NO_TRUSTLINE");
    // Asserted on the serialized row rather than a named property, so that adding a field
    // to the shape cannot reintroduce the leak without failing here.
    expect(JSON.stringify(rows)).not.toContain("envelope_xdr");
  });

  /**
   * A dismissed Face ID prompt is not history.
   *
   * `cancelPreparedTip` writes the abandoned attempt as failed/SIGNATURE_REJECTED only to
   * release the double-submit guard — nothing was built, signed or submitted. The pairing
   * with the assertion above is the point of this test: a *real* failure stays in the feed,
   * so the filter cannot quietly widen into "hide anything that did not succeed".
   */
  test("an attempt abandoned at Face ID is not a history row, but a real failure is", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, gallery } = await seedTwoUsersAndATip(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("tips", {
        fromUserId: alice,
        toUserId: bob,
        galleryId: gallery,
        fromPublicKey: "CALICE",
        toPublicKey: "CBOB",
        galleryHashHex: "deadbeef",
        amountStroops: "10000000",
        status: "failed",
        errorCode: "SIGNATURE_REJECTED",
        createdAt: Date.now() + 1,
      });
    });

    const sent = await t.withIdentity({ subject: ALICE }).query(api.tips.listMyTips, {});
    const received = await t.withIdentity({ subject: BOB }).query(api.tips.listMyTips, {});

    // The cancelled attempt is the newer of the two rows, so a broken filter shows up here
    // as a length of 2 rather than as a subtly wrong ordering.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.errorCode).toBe("NO_TRUSTLINE");
    expect(received).toHaveLength(1);
    expect(received[0]?.errorCode).toBe("NO_TRUSTLINE");
  });
});

describe("tip entry points require a session", () => {
  test("prepareTip refuses an anonymous caller", async () => {
    const t = convexTest(schema, modules);
    const { gallery } = await seedTwoUsersAndATip(t);

    await expect(
      t.action(api.stellar.tips.prepareTip, { galleryId: gallery, amount: "5" }),
    ).rejects.toThrow("Not signed in.");
  });

  test("submitTip refuses an anonymous caller", async () => {
    const t = convexTest(schema, modules);
    const { tip } = await seedTwoUsersAndATip(t);

    await expect(
      t.action(api.stellar.tips.submitTip, { tipId: tip, assertion: {} }),
    ).rejects.toThrow("Not signed in.");
  });

  test("startRegistration refuses an anonymous caller", async () => {
    // Provisioning spends treasury funds and mints an account bound to a user. An
    // anonymous caller reaching it would create wallets nobody owns.
    const t = convexTest(schema, modules);

    await expect(t.action(api.stellar.passkey.startRegistration, {})).rejects.toThrow(
      "Not signed in.",
    );
  });

  test("finishRegistration refuses an anonymous caller", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.stellar.passkey.finishRegistration, { registrationResponse: {} }),
    ).rejects.toThrow("Not signed in.");
  });

  test("a Better Auth session with no profile row is still refused", async () => {
    // The failure mode that would otherwise be invisible: a valid token whose subject
    // matches no users row. It must refuse, not fall through to some default identity.
    const t = convexTest(schema, modules);
    const { gallery } = await seedTwoUsersAndATip(t);
    const stranger = t.withIdentity({ subject: "auth|no-profile" });

    await expect(
      stranger.action(api.stellar.tips.prepareTip, { galleryId: gallery, amount: "5" }),
    ).rejects.toThrow("Not signed in.");
  });
});

describe("getMyWallet exposes only the caller's own smart account", () => {
  test("the caller sees their own account", async () => {
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    const wallet = await t
      .withIdentity({ subject: ALICE })
      .query(api.stellar.passkey.getMyWallet, {});

    expect(wallet?.contractAddress).toBe("CALICE");
  });

  test("a second user does not see the first user's account", async () => {
    // Bob has no wallet. The answer must be "you have none", never Alice's.
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    expect(await t.withIdentity({ subject: BOB }).query(api.stellar.passkey.getMyWallet, {})).toBe(
      null,
    );
  });

  test("signed out is null, not an error", async () => {
    // It renders inside the /app shell, which public pages also use — throwing here would
    // take a signed-out visitor's whole page down with it.
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    expect(await t.query(api.stellar.passkey.getMyWallet, {})).toBe(null);
  });

  test("no credential id is ever serialized to the client", async () => {
    // The credential id is public by construction, but it is also the handle a device uses
    // to select a passkey. Nothing in the UI needs it outside a signing round trip, so the
    // projection deliberately omits it — asserted here so a later spread cannot add it back.
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    const wallet = await t
      .withIdentity({ subject: ALICE })
      .query(api.stellar.passkey.getMyWallet, {});

    expect(JSON.stringify(wallet)).not.toContain("cred-alice");
  });
});

describe("a prepared tip can only be cancelled by the user it belongs to", () => {
  test("a stranger cannot cancel someone else's pending tip", async () => {
    // cancelPreparedTip takes a client-supplied tipId by necessity — the browser holds it
    // across the signing step. Without the ownership re-check it would let anyone drive
    // anyone else's tip to a terminal state.
    const t = convexTest(schema, modules);
    const { alice, bob, gallery } = await seedTwoUsersAndATip(t);

    const pending = await t.run(async (ctx) =>
      ctx.db.insert("tips", {
        fromUserId: alice,
        toUserId: bob,
        galleryId: gallery,
        fromPublicKey: "GALICE",
        toPublicKey: "GBOB",
        galleryHashHex: "deadbeef",
        amountStroops: "50000000",
        status: "pending",
        createdAt: Date.now(),
      }),
    );

    await t.withIdentity({ subject: BOB }).mutation(api.stellar.tips.cancelPreparedTip, {
      tipId: pending,
    });

    // Silently ignored rather than thrown, but the row must be untouched either way.
    const after = await t.run(async (ctx) => ctx.db.get(pending));
    expect(after?.status).toBe("pending");
  });

  test("the owner can cancel their own pending tip", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, gallery } = await seedTwoUsersAndATip(t);

    const pending = await t.run(async (ctx) =>
      ctx.db.insert("tips", {
        fromUserId: alice,
        toUserId: bob,
        galleryId: gallery,
        fromPublicKey: "GALICE",
        toPublicKey: "GBOB",
        galleryHashHex: "deadbeef",
        amountStroops: "50000000",
        status: "pending",
        createdAt: Date.now(),
      }),
    );

    await t.withIdentity({ subject: ALICE }).mutation(api.stellar.tips.cancelPreparedTip, {
      tipId: pending,
    });

    const after = await t.run(async (ctx) => ctx.db.get(pending));
    expect(after?.status).toBe("failed");
  });
});

describe("prepareTip takes no caller-supplied identity", () => {
  test("passing a fromUserId is rejected by the validator", async () => {
    // The impersonation shape, asserted structurally. If someone ever adds `fromUserId`
    // to the public action's args to make a test easier, this fails.
    const t = convexTest(schema, modules);
    const { gallery, bob } = await seedTwoUsersAndATip(t);

    await expect(
      t.withIdentity({ subject: ALICE }).action(api.stellar.tips.prepareTip, {
        galleryId: gallery,
        amount: "5",
        fromUserId: bob,
      } as unknown as { galleryId: Id<"galleries">; amount: string }),
    ).rejects.toThrow(/fromUserId|Object contains extra field/i);
  });
});

describe("public reads do not leak private user fields", () => {
  test("a gallery's owner is exposed without authSubject", async () => {
    const t = convexTest(schema, modules);
    const { gallery } = await seedTwoUsersAndATip(t);

    const result = await t.query(api.galleries.get, { galleryId: gallery });

    expect(result?.owner?.handle).toBe("bob");
    expect(JSON.stringify(result)).not.toContain("auth|bob");
  });

  test("viewer returns the caller's row and nothing when signed out", async () => {
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    expect(await t.query(api.users.viewer, {})).toBeNull();
    expect(await t.withIdentity({ subject: ALICE }).query(api.users.viewer, {})).toMatchObject({
      handle: "alice",
    });
  });
});

describe("double-submit guard", () => {
  test("a second pending tip to the same gallery is refused", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, gallery } = await seedTwoUsersAndATip(t);

    const args = {
      fromUserId: alice,
      toUserId: bob,
      galleryId: gallery,
      fromPublicKey: "GALICE",
      toPublicKey: "GBOB",
      galleryHashHex: "deadbeef",
      amountStroops: "50000000",
    };

    await t.mutation(internal.stellar.internal.recordTipPending, args);
    await expect(t.mutation(internal.stellar.internal.recordTipPending, args)).rejects.toThrow(
      "DUPLICATE_PENDING_TIP",
    );
  });

  test("a different gallery is not blocked", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, gallery } = await seedTwoUsersAndATip(t);

    const other = await t.run(
      async (ctx) =>
        await ctx.db.insert("galleries", {
          ownerId: bob,
          title: "Another",
          createdAt: Date.now(),
        }),
    );

    const base = {
      fromUserId: alice,
      toUserId: bob,
      fromPublicKey: "GALICE",
      toPublicKey: "GBOB",
      galleryHashHex: "deadbeef",
      amountStroops: "50000000",
    };

    await t.mutation(internal.stellar.internal.recordTipPending, { ...base, galleryId: gallery });
    await expect(
      t.mutation(internal.stellar.internal.recordTipPending, { ...base, galleryId: other }),
    ).resolves.toBeDefined();
  });

  test("a settled tip does not block the next one", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, gallery } = await seedTwoUsersAndATip(t);

    const args = {
      fromUserId: alice,
      toUserId: bob,
      galleryId: gallery,
      fromPublicKey: "GALICE",
      toPublicKey: "GBOB",
      galleryHashHex: "deadbeef",
      amountStroops: "50000000",
    };

    const first = await t.mutation(internal.stellar.internal.recordTipPending, args);
    await t.mutation(internal.stellar.internal.markTipSuccess, { tipId: first, txHash: "abc" });

    // The guard is about in-flight tips, not a cooldown. Tipping the same gallery twice is
    // a thing people legitimately do.
    await expect(
      t.mutation(internal.stellar.internal.recordTipPending, args),
    ).resolves.toBeDefined();
  });
});

/**
 * Passkey sign-in (`model/passkeyAuth.ts`, `passkeys.ts`).
 *
 * Email and password are gone, so a passkey credential is now the *only* thing standing
 * between a stranger and someone's account — and between a stranger and their wallet,
 * since the same credential authorizes tips. These are the negatives that matter.
 */
describe("passkey credentials are write-once and never reachable from a client", () => {
  test("a credential that already has an owner cannot be re-pointed at another user", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedTwoUsersAndATip(t);

    const credential = {
      credentialId: "cred-shared",
      publicKey: "BASE64URL_PUBLIC_KEY",
      rpId: "musea-tips.vercel.app",
      counter: 0,
    };

    const first = await t.mutation(internal.passkeys.recordCredential, {
      authSubject: ALICE,
      ...credential,
    });
    expect(first.ok).toBe(true);

    // A credential id is a public handle, not a secret. If registering an id that already
    // exists re-pointed it at the caller, replaying someone else's public identifier would
    // be a complete account takeover — of their profile *and* their smart account.
    const second = await t.mutation(internal.passkeys.recordCredential, {
      authSubject: BOB,
      ...credential,
    });
    expect(second.ok).toBe(false);

    const stored = await t.query(internal.passkeys.getCredential, {
      credentialId: "cred-shared",
    });
    expect(stored?.userId).not.toBe(bob);
  });

  test("deleting an account frees its credential, so the same device can sign up again", async () => {
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    await t.mutation(internal.passkeys.recordCredential, {
      authSubject: ALICE,
      credentialId: "cred-reuse",
      publicKey: "BASE64URL_PUBLIC_KEY",
      rpId: "musea-tips.vercel.app",
      counter: 0,
    });

    // Delete the rows the way deleteAccount does. Without this sweep the write-once rule
    // above would permanently lock the user's own phone out of making a new account.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("passkeyCredentials")
        .withIndex("by_credentialId", (q) => q.eq("credentialId", "cred-reuse"))
        .unique();
      if (row) await ctx.db.delete(row._id);
    });

    const again = await t.mutation(internal.passkeys.recordCredential, {
      authSubject: BOB,
      credentialId: "cred-reuse",
      publicKey: "BASE64URL_PUBLIC_KEY",
      rpId: "musea-tips.vercel.app",
      counter: 0,
    });
    expect(again.ok).toBe(true);
  });

  test("a credential for an unknown subject is refused rather than orphaned", async () => {
    const t = convexTest(schema, modules);
    await seedTwoUsersAndATip(t);

    const result = await t.mutation(internal.passkeys.recordCredential, {
      authSubject: "auth|nobody",
      credentialId: "cred-orphan",
      publicKey: "BASE64URL_PUBLIC_KEY",
      rpId: "musea-tips.vercel.app",
      counter: 0,
    });
    expect(result.ok).toBe(false);
  });

  test("none of the passkey surface is publicly callable", () => {
    /**
     * Enforced by the typechecker rather than at runtime, because that is where Convex
     * actually enforces it: `api` is a lazy Proxy that answers to any property name, so
     * `expect(api.passkeys).toBeUndefined()` can never fail. The real boundary is the type
     * — `api` is `FilterApi<…, "public">`, so an `internalMutation` has no callable member
     * there at all.
     *
     * If anyone promotes `recordCredential` to a public `mutation`, this line stops being
     * an error, `@ts-expect-error` becomes unused, and `tsc --noEmit` fails the build. That
     * matters: a public mutation able to write `passkeyCredentials` would let anyone
     * register their own device against someone else's account and sign in as them — with
     * email gone, it is the whole authentication system.
     */
    // @ts-expect-error - recordCredential is internal and must never appear on `api`.
    void api.passkeys.recordCredential;
    expect(true).toBe(true);
  });
});
