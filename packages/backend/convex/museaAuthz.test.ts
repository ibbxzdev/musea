import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.helpers";

/**
 * Authorization negatives for the Musea surface.
 *
 * Same discipline as authz.test.ts, applied to the ported artifacts/galleries model:
 * every case is "Bob tries to reach Alice's things" and asserts refusal. The happy paths
 * are asserted only where they are the control that makes a refusal meaningful — a test
 * that everything is hidden passes just as well on a backend that returns nothing at all.
 */

const ALICE = "auth|alice";
const BOB = "auth|bob";

async function seedTwoCurators(t: ReturnType<typeof convexTest>) {
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
    return { alice, bob };
  });
}

/** An artifact belonging to `userId`, inserted directly so the test controls the owner. */
async function seedArtifact(t: ReturnType<typeof convexTest>, userId: Id<"users">, title: string) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("artifacts", {
        userId,
        kind: "note",
        title,
        sourceType: "note",
        tags: [],
        status: "ready",
        searchText: title.toLowerCase(),
        createdAt: Date.now(),
      }),
  );
}

async function seedGallery(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
  { title, isPublic }: { title: string; isPublic: boolean },
) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("galleries", { ownerId, title, isPublic, createdAt: Date.now() }),
  );
}

const asAlice = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: ALICE });
const asBob = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: BOB });

describe("artifacts are scoped to their owner", () => {
  test("a signed-out caller cannot list or read anything", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedTwoCurators(t);
    const artifact = await seedArtifact(t, alice, "Alice's note");

    await expect(
      t.query(api.artifacts.list, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow(/not signed in/i);
    await expect(t.query(api.artifacts.get, { artifactId: artifact })).rejects.toThrow(
      /not signed in/i,
    );
  });

  test("Bob cannot read Alice's artifact, and gets the same answer as for one that is gone", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedTwoCurators(t);
    const artifact = await seedArtifact(t, alice, "Alice's note");

    // The control: it is genuinely there, and Alice can see it.
    expect(await asAlice(t).query(api.artifacts.get, { artifactId: artifact })).toMatchObject({
      title: "Alice's note",
    });

    // Null, not a throw with a distinguishable message — "not yours" and "not there" have
    // to be indistinguishable or this query answers "does id X exist?" for anyone.
    expect(await asBob(t).query(api.artifacts.get, { artifactId: artifact })).toBeNull();
  });

  test("Bob's library and search never contain Alice's saves", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedTwoCurators(t);
    await seedArtifact(t, alice, "Brutalist stairwell");
    await seedArtifact(t, bob, "Brutalist courtyard");

    const list = await asBob(t).query(api.artifacts.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(list.page.map((a) => a.title)).toEqual(["Brutalist courtyard"]);

    // The word matches both. Only Bob's comes back.
    const found = await asBob(t).query(api.artifacts.search, { query: "brutalist" });
    expect(found.map((a) => a.title)).toEqual(["Brutalist courtyard"]);
  });

  test("Bob cannot edit or delete Alice's artifact", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedTwoCurators(t);
    const artifact = await seedArtifact(t, alice, "Alice's note");

    await expect(
      asBob(t).mutation(api.artifacts.update, { artifactId: artifact, title: "Bob's now" }),
    ).rejects.toThrow(/not found/i);
    await expect(asBob(t).mutation(api.artifacts.remove, { artifactId: artifact })).rejects.toThrow(
      /not found/i,
    );

    // And it really is untouched, rather than the error arriving after a partial write.
    expect(await asAlice(t).query(api.artifacts.get, { artifactId: artifact })).toMatchObject({
      title: "Alice's note",
    });
  });
});

describe("galleries are private until their owner publishes them", () => {
  test("a private gallery is invisible to everyone but its owner", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedTwoCurators(t);
    const gallery = await seedGallery(t, alice, { title: "Drafts", isPublic: false });

    expect(await asAlice(t).query(api.galleries.get, { galleryId: gallery })).toMatchObject({
      title: "Drafts",
    });
    expect(await asBob(t).query(api.galleries.get, { galleryId: gallery })).toBeNull();
    expect(await t.query(api.galleries.get, { galleryId: gallery })).toBeNull();

    // Nor does it show up in the Community listing.
    expect(await t.query(api.galleries.listPublic, {})).toEqual([]);
  });

  test("a public gallery and its contents are readable signed out", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedTwoCurators(t);
    const gallery = await seedGallery(t, alice, { title: "Concrete", isPublic: true });
    const artifact = await seedArtifact(t, alice, "Barbican");
    await asAlice(t).mutation(api.galleryArtifacts.addToGallery, {
      galleryId: gallery,
      artifactIds: [artifact],
    });

    const listed = await t.query(api.galleries.listPublic, {});
    expect(listed.map((g) => g.title)).toEqual(["Concrete"]);
    // The curator is exposed by projection, so the auth subject must not ride along.
    expect(JSON.stringify(listed)).not.toContain(ALICE);

    const contents = await t.query(api.galleryArtifacts.listArtifacts, {
      galleryId: gallery,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(contents.page.map((a) => a.title)).toEqual(["Barbican"]);
  });

  test("Bob cannot rename, publish or delete Alice's gallery", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedTwoCurators(t);
    const gallery = await seedGallery(t, alice, { title: "Drafts", isPublic: false });

    await expect(
      asBob(t).mutation(api.galleries.update, { galleryId: gallery, isPublic: true }),
    ).rejects.toThrow(/not found/i);
    await expect(asBob(t).mutation(api.galleries.remove, { galleryId: gallery })).rejects.toThrow(
      /not found/i,
    );

    expect(await asAlice(t).query(api.galleries.get, { galleryId: gallery })).toMatchObject({
      isPublic: false,
    });
  });

  test("listMine returns only your own galleries", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedTwoCurators(t);
    await seedGallery(t, alice, { title: "Alice's", isPublic: true });
    await seedGallery(t, bob, { title: "Bob's", isPublic: false });

    const mine = await asBob(t).query(api.galleries.listMine, {});
    expect(mine.map((g) => g.title)).toEqual(["Bob's"]);
  });
});

describe("filing checks both ends, not just one", () => {
  test("Bob cannot file his own artifact into Alice's gallery", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedTwoCurators(t);
    const aliceGallery = await seedGallery(t, alice, { title: "Alice's", isPublic: true });
    const bobArtifact = await seedArtifact(t, bob, "Bob's note");

    // Owning the artifact is not permission to write into someone else's container.
    await expect(
      asBob(t).mutation(api.galleryArtifacts.addToGallery, {
        galleryId: aliceGallery,
        artifactIds: [bobArtifact],
      }),
    ).rejects.toThrow(/not found/i);

    const contents = await asAlice(t).query(api.galleryArtifacts.listArtifacts, {
      galleryId: aliceGallery,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(contents.page).toEqual([]);
  });

  test("Alice cannot file Bob's artifact into her own gallery", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedTwoCurators(t);
    const aliceGallery = await seedGallery(t, alice, { title: "Alice's", isPublic: true });
    const bobArtifact = await seedArtifact(t, bob, "Bob's note");

    // The mirror image: owning the gallery is not permission to file someone else's save
    // into it. This one skips rather than throws, because a batch add drops what it may
    // not touch and keeps the rest.
    await asAlice(t).mutation(api.galleryArtifacts.addToGallery, {
      galleryId: aliceGallery,
      artifactIds: [bobArtifact],
    });

    const contents = await asAlice(t).query(api.galleryArtifacts.listArtifacts, {
      galleryId: aliceGallery,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(contents.page).toEqual([]);
  });

  test("setGalleriesForArtifact silently drops galleries the caller does not own", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedTwoCurators(t);
    const aliceGallery = await seedGallery(t, alice, { title: "Alice's", isPublic: true });
    const bobGallery = await seedGallery(t, bob, { title: "Bob's", isPublic: false });
    const bobArtifact = await seedArtifact(t, bob, "Bob's note");

    const result = await asBob(t).mutation(api.galleryArtifacts.setGalleriesForArtifact, {
      artifactId: bobArtifact,
      galleryIds: [bobGallery, aliceGallery],
    });

    // One of the two was his.
    expect(result.added).toBe(1);
    const filedIn = await asBob(t).query(api.galleryArtifacts.listGalleriesForArtifact, {
      artifactId: bobArtifact,
    });
    expect(filedIn.map((g) => g.title)).toEqual(["Bob's"]);
  });

  test("a creating save cannot smuggle an artifact into someone else's gallery", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedTwoCurators(t);
    const aliceGallery = await seedGallery(t, alice, { title: "Alice's", isPublic: true });

    // `artifacts.create` takes gallery ids so the save and the filing are one transaction.
    // That argument is a parent reference, and it is checked like one.
    await asBob(t).mutation(api.artifacts.create, {
      title: "Bob's note",
      origin: "note",
      galleryIds: [aliceGallery],
    });

    const contents = await asAlice(t).query(api.galleryArtifacts.listArtifacts, {
      galleryId: aliceGallery,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(contents.page).toEqual([]);
  });
});

describe("uploads belong to whoever uploaded them", () => {
  test("an unclaimed storage id cannot be attached to an artifact", async () => {
    const t = convexTest(schema, modules);
    await seedTwoCurators(t);

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["not a real picture"])),
    );

    await expect(
      asBob(t).mutation(api.artifacts.create, { title: "Stolen", imageStorageId: storageId }),
    ).rejects.toThrow(/not found/i);
  });

  test("Bob cannot attach — or claim — a file Alice uploaded", async () => {
    const t = convexTest(schema, modules);
    await seedTwoCurators(t);

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["alice's picture"])),
    );
    await asAlice(t).mutation(api.files.claimUpload, { storageId });

    // Claiming is write-once, so Bob cannot take it over first and then attach it.
    await expect(asBob(t).mutation(api.files.claimUpload, { storageId })).rejects.toThrow(
      /not found/i,
    );
    await expect(
      asBob(t).mutation(api.artifacts.create, { title: "Stolen", imageStorageId: storageId }),
    ).rejects.toThrow(/not found/i);

    // Alice's own save of it still works — the control for all of the above.
    await expect(
      asAlice(t).mutation(api.artifacts.create, { title: "Mine", imageStorageId: storageId }),
    ).resolves.toBeDefined();
  });
});

describe("profile reads and writes are the caller's own", () => {
  test("stats and viewer require a session and never cross accounts", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedTwoCurators(t);
    await seedArtifact(t, alice, "Alice's note");

    await expect(t.query(api.users.stats, {})).rejects.toThrow(/not signed in/i);

    expect(await asAlice(t).query(api.users.stats, {})).toMatchObject({ saves: 1 });
    expect(await asBob(t).query(api.users.stats, {})).toMatchObject({ saves: 0 });
  });

  test("updateProfile writes to the caller's own row", async () => {
    const t = convexTest(schema, modules);
    await seedTwoCurators(t);

    await asBob(t).mutation(api.users.updateProfile, { name: "Robert" });

    expect(await asBob(t).query(api.users.viewer, {})).toMatchObject({ name: "Robert" });
    expect(await asAlice(t).query(api.users.viewer, {})).toMatchObject({ name: "Alice" });
  });
});
