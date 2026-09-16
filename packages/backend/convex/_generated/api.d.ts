/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as files from "../files.js";
import type * as galleries from "../galleries.js";
import type * as galleryArtifacts from "../galleryArtifacts.js";
import type * as http from "../http.js";
import type * as linkPreview from "../linkPreview.js";
import type * as model_artifacts from "../model/artifacts.js";
import type * as model_auth from "../model/auth.js";
import type * as model_passkeyAuth from "../model/passkeyAuth.js";
import type * as passkeys from "../passkeys.js";
import type * as seed from "../seed.js";
import type * as stellar_config from "../stellar/config.js";
import type * as stellar_diagnostics from "../stellar/diagnostics.js";
import type * as stellar_internal from "../stellar/internal.js";
import type * as stellar_passkey from "../stellar/passkey.js";
import type * as stellar_passkeyAuthNode from "../stellar/passkeyAuthNode.js";
import type * as stellar_passkeyNode from "../stellar/passkeyNode.js";
import type * as stellar_relayer from "../stellar/relayer.js";
import type * as stellar_tips from "../stellar/tips.js";
import type * as stellar_tipsNode from "../stellar/tipsNode.js";
import type * as tips from "../tips.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  artifacts: typeof artifacts;
  auth: typeof auth;
  files: typeof files;
  galleries: typeof galleries;
  galleryArtifacts: typeof galleryArtifacts;
  http: typeof http;
  linkPreview: typeof linkPreview;
  "model/artifacts": typeof model_artifacts;
  "model/auth": typeof model_auth;
  "model/passkeyAuth": typeof model_passkeyAuth;
  passkeys: typeof passkeys;
  seed: typeof seed;
  "stellar/config": typeof stellar_config;
  "stellar/diagnostics": typeof stellar_diagnostics;
  "stellar/internal": typeof stellar_internal;
  "stellar/passkey": typeof stellar_passkey;
  "stellar/passkeyAuthNode": typeof stellar_passkeyAuthNode;
  "stellar/passkeyNode": typeof stellar_passkeyNode;
  "stellar/relayer": typeof stellar_relayer;
  "stellar/tips": typeof stellar_tips;
  "stellar/tipsNode": typeof stellar_tipsNode;
  tips: typeof tips;
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
