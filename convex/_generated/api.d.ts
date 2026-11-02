/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as disputes from "../disputes.js";
import type * as http from "../http.js";
import type * as join from "../join.js";
import type * as ledger from "../ledger.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_ai from "../lib/ai.js";
import type * as lib_demo from "../lib/demo.js";
import type * as lib_paypal from "../lib/paypal.js";
import type * as lib_preview from "../lib/preview.js";
import type * as lib_problems from "../lib/problems.js";
import type * as lib_split from "../lib/split.js";
import type * as nights from "../nights.js";
import type * as payouts from "../payouts.js";
import type * as restaurants from "../restaurants.js";
import type * as tips from "../tips.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  disputes: typeof disputes;
  http: typeof http;
  join: typeof join;
  ledger: typeof ledger;
  "lib/access": typeof lib_access;
  "lib/ai": typeof lib_ai;
  "lib/demo": typeof lib_demo;
  "lib/paypal": typeof lib_paypal;
  "lib/preview": typeof lib_preview;
  "lib/problems": typeof lib_problems;
  "lib/split": typeof lib_split;
  nights: typeof nights;
  payouts: typeof payouts;
  restaurants: typeof restaurants;
  tips: typeof tips;
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

export declare const components: {};
