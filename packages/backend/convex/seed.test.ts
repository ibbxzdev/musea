import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.helpers";

/**
 * Seed idempotency (Story 0.4).
 *
 * The bar the story sets is "running it twice produces the same state, not duplicates" —
 * because this is the recovery path after a testnet reset, and a seed that duplicates on
 * the second run is worse than no seed at all.
 */

async function counts(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    users: (await ctx.db.query("users").collect()).length,
    galleries: (await ctx.db.query("galleries").collect()).length,
    artifacts: (await ctx.db.query("artifacts").collect()).length,
    items: (await ctx.db.query("galleryArtifacts").collect()).length,
  }));
}

describe("seed:run", () => {
  test("is idempotent across repeated runs", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.run, {});
    const first = await counts(t);

    await t.mutation(internal.seed.run, {});
    await t.mutation(internal.seed.run, {});
    const third = await counts(t);

    expect(first.galleries).toBe(2);
    expect(first.items).toBe(6);
    expect(third).toEqual(first);
  });

  test("attaches galleries to a real user when given a handle", async () => {
    const t = convexTest(schema, modules);

    const curator = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          authSubject: "auth|real-curator",
          name: "Real Curator",
          handle: "realcurator",
          createdAt: Date.now(),
        }),
    );

    const result = await t.mutation(internal.seed.run, { ownerHandle: "realcurator" });

    expect(result.ownerId).toBe(curator);
    // No placeholder invented alongside the real owner.
    expect((await counts(t)).users).toBe(1);
  });

  test("refuses an unknown handle rather than quietly using a placeholder", async () => {
    // Silently attaching the demo galleries to an account nobody can sign into is the kind
    // of thing that is only discovered while recording.
    const t = convexTest(schema, modules);

    await expect(t.mutation(internal.seed.run, { ownerHandle: "nobody" })).rejects.toThrow(
      /No user with handle "nobody"/,
    );
  });

  test("never writes a client-supplied authSubject", async () => {
    // There is no argument that could set one, so this is a guard against a future edit
    // adding one for convenience. A seed that can mint an arbitrary identity is a worse
    // hole than the impersonation shape rule 2 exists to close.
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.run, {});

    const subjects = await t.run(async (ctx) =>
      (await ctx.db.query("users").collect()).map((u) => u.authSubject),
    );
    expect(subjects.every((s) => s.startsWith("seed:"))).toBe(true);
  });
});
