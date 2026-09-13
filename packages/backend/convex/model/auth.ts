import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { api } from "../_generated/api";

/**
 * Authorization helpers.
 *
 * The single most important rule in this codebase:
 *
 *   **Never take a `userId` as a function argument and trust it.**
 *
 * Every public wallet/tip entry point derives the caller from `ctx.auth`. A client-supplied
 * `userId` is an impersonation hole — it would let anyone move funds out of anyone else's
 * wallet by passing a different id. The `convex-authz` skill scans for exactly this shape;
 * run it before shipping.
 *
 * The spec's §6 code sketches take `userId: v.id("users")` as an argument. That was
 * shorthand. Do not implement it that way.
 */

type AnyCtx = QueryCtx | MutationCtx;

/** The authenticated caller's subject, or null when signed out. */
export async function getAuthSubject(ctx: AnyCtx | ActionCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

/** Throws when signed out. Use in anything that reads or writes user-scoped data. */
export async function requireAuthSubject(ctx: AnyCtx | ActionCtx): Promise<string> {
  const subject = await getAuthSubject(ctx);
  if (!subject) throw new Error("Not signed in.");
  return subject;
}

/** The signed-in user's profile row, or null when signed out / not yet provisioned. */
export async function getCurrentUser(ctx: AnyCtx): Promise<Doc<"users"> | null> {
  const subject = await getAuthSubject(ctx);
  if (!subject) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_authSubject", (q) => q.eq("authSubject", subject))
    .unique();
}

/** The signed-in user's profile row. Throws when signed out. */
export async function requireCurrentUser(ctx: AnyCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not signed in.");
  return user;
}

/**
 * The signed-in user's id, resolved from inside an action.
 *
 * Actions have no `ctx.db`, so they go through a query. This is the only sanctioned way
 * for a Stellar action to learn who is calling it.
 */
export async function requireCurrentUserIdFromAction(ctx: ActionCtx): Promise<Id<"users">> {
  await requireAuthSubject(ctx);
  const user = await ctx.runQuery(api.users.viewer, {});
  if (!user) throw new Error("Not signed in.");
  return user._id;
}

/** Assert the caller owns `doc`. Use before any mutation of a user-owned row. */
export function assertOwns(
  user: Doc<"users">,
  doc: { ownerId?: Id<"users">; userId?: Id<"users"> },
): void {
  const owner = doc.ownerId ?? doc.userId;
  if (owner !== user._id) {
    // Deliberately vague: do not confirm the row exists to someone who cannot see it.
    throw new Error("Not found.");
  }
}
