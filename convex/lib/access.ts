import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";

// No accounts: the manager's browser holds a random owner key for its restaurant.
export async function ownedRestaurant(ctx: QueryCtx, ownerKey: string): Promise<Doc<"restaurants">> {
  if (ownerKey.length < 20 || ownerKey.length > 80) throw new ConvexError("Not found");
  const r = await ctx.db.query("restaurants").withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey)).unique();
  if (!r) throw new ConvexError("Not found");
  return r;
}

export async function ownedNight(ctx: QueryCtx, ownerKey: string, nightId: Id<"nights">) {
  const restaurant = await ownedRestaurant(ctx, ownerKey);
  const night = await ctx.db.get(nightId);
  if (!night || night.restaurantId !== restaurant._id) throw new ConvexError("Not found");
  return { restaurant, night };
}

export function randomToken(bytes = 18) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, bytes * 2);
}

/** Service date in Pacific time; a shift that ends at 1am belongs to the previous day. */
export function serviceDate(now = Date.now()) {
  const d = new Date(now - 4 * 3600_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export const firstName = (s: string) => s.trim().split(/\s+/)[0].toLowerCase();
