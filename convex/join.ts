import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { firstName } from "./lib/access";
import { parseReceiver } from "./restaurants";
import { canonicalRole } from "./lib/split";

/** Staff join page: only the restaurant's name. The token is the only key, and the manager can reset it. */
export const page = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (token.length < 10 || token.length > 40) return null;
    const r = await ctx.db.query("restaurants").withIndex("by_join", (q) => q.eq("joinToken", token)).unique();
    if (!r) return null;
    return { name: r.name, demo: r.demo };
  },
});

/** A worker adds (or updates) their own payout details. Matches an existing name on the staff list first. */
export const add = mutation({
  args: { token: v.string(), name: v.string(), role: v.string(), wallet: v.union(v.literal("PAYPAL"), v.literal("VENMO")), receiver: v.string() },
  handler: async (ctx, a) => {
    const r = await ctx.db.query("restaurants").withIndex("by_join", (q) => q.eq("joinToken", a.token)).unique();
    if (!r) throw new ConvexError("This staff link has expired. Ask your manager for a new one.");
    const name = a.name.trim().replace(/\s+/g, " ").slice(0, 60);
    const role = canonicalRole(a.role).slice(0, 30) || "server";
    if (name.length < 2) throw new ConvexError("Add your name as it appears on the schedule.");
    const pay = parseReceiver(a.wallet, a.receiver);
    const workers = await ctx.db.query("workers").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id)).collect();
    const exact = workers.find((w) => w.name.toLowerCase() === name.toLowerCase());
    // A first-name match only counts if it's unambiguous and the record has no payout details yet.
    const firsts = workers.filter((w) => firstName(w.name) === firstName(name));
    const match = exact ?? (firsts.length === 1 && !firsts[0].receiver ? firsts[0] : undefined);
    if (match) {
      if (match.receiver && match.receiver !== pay.receiver && match.addedBy === "self")
        throw new ConvexError("Someone with this name already added their details. Ask your manager to update them.");
      await ctx.db.patch(match._id, { ...pay, name: match.name.length >= name.length ? match.name : name, role: match.role || role });
      return { matched: true };
    }
    if (workers.length >= 80) throw new ConvexError("This staff list is full. Ask your manager.");
    await ctx.db.insert("workers", { restaurantId: r._id, name, role, ...pay, addedBy: "self" });
    return { matched: false };
  },
});
