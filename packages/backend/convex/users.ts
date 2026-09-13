import { query } from "./_generated/server";
import { getCurrentUser } from "./model/auth";

/**
 * The signed-in user's profile, or null.
 *
 * Note there is no `getUser({ userId })` here on purpose. A public query that returns a
 * user by a client-supplied id is how profile data leaks; if the UI needs another user's
 * public details, add a narrow query that returns only the public fields (name, handle,
 * image) and nothing else.
 */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      handle: user.handle,
      imageUrl: user.imageUrl,
    };
  },
});
