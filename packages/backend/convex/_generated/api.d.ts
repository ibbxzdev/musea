/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as galleries from "../galleries.js";
import type * as model_auth from "../model/auth.js";
import type * as stellar_config from "../stellar/config.js";
import type * as stellar_crypto from "../stellar/crypto.js";
import type * as stellar_internal from "../stellar/internal.js";
import type * as stellar_tips from "../stellar/tips.js";
import type * as stellar_wallets from "../stellar/wallets.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  galleries: typeof galleries;
  "model/auth": typeof model_auth;
  "stellar/config": typeof stellar_config;
  "stellar/crypto": typeof stellar_crypto;
  "stellar/internal": typeof stellar_internal;
  "stellar/tips": typeof stellar_tips;
  "stellar/wallets": typeof stellar_wallets;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
