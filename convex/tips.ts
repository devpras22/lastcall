import { v, ConvexError } from "convex/values";
import { action, query, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import * as paypal from "./lib/paypal";
import { randomToken } from "./lib/access";
import { fail, fromPayPal } from "./lib/problems";

/** Public tip page: just the restaurant name and whether tonight is still open. */
export const page = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const r = await ctx.db.query("restaurants").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!r) return null;
    const night = await openNightFor(ctx, r._id);
    return { name: r.name, open: !!night, paypalClientId: process.env.PAYPAL_CLIENT_ID ?? null };
  },
});

async function openNightFor(ctx: QueryCtx, restaurantId: Id<"restaurants">) {
  const nights = await ctx.db.query("nights").withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId)).order("desc").take(3);
  return nights.find((n) => n.status !== "paying" && n.status !== "paid") ?? null;
}

export const target = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const r = await ctx.db.query("restaurants").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!r) return null;
    const night = await openNightFor(ctx, r._id);
    return night ? { restaurantId: r._id, restaurant: r.name, nightId: night._id } : null;
  },
});

export const createOrder = action({
  args: { slug: v.string(), cents: v.number() },
  handler: async (ctx, { slug, cents }) => {
    if (!Number.isInteger(cents) || cents < 100 || cents > 50_000) throw new ConvexError("Tips are $1 to $500.");
    const t = await ctx.runQuery(internal.tips.target, { slug });
    if (!t) throw new ConvexError("This restaurant isn't taking tips right now.");
    let order: { id: string };
    try {
      order = await paypal.createTipOrder({ cents, nightId: t.nightId, restaurant: t.restaurant, requestId: `tip-${randomToken(8)}` });
    } catch (e) {
      console.error("createOrder", slug, e);
      throw fail(fromPayPal(e, "tip"));
    }
    await ctx.runMutation(internal.tips.record, { restaurantId: t.restaurantId, nightId: t.nightId, orderId: order.id, cents, status: "created" });
    return order.id;
  },
});

export const captureOrder = action({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    if (!/^[A-Z0-9]{10,30}$/.test(orderId)) throw new ConvexError("Bad order id.");
    const tip = await ctx.runQuery(internal.tips.byOrder, { orderId });
    if (!tip) throw new ConvexError("Unknown order.");
    if (tip.status === "captured") return { ok: true };
    let res: Awaited<ReturnType<typeof paypal.captureOrder>>;
    try {
      res = await paypal.captureOrder(orderId);
    } catch (e) {
      console.error("captureOrder", orderId, e);
      throw fail(fromPayPal(e, "capture"));
    }
    const cap = res.purchase_units[0]?.payments?.captures?.[0];
    if (res.status !== "COMPLETED" || !cap) throw new ConvexError("PayPal didn't complete that payment.");
    const cents = Math.round(Number(cap.amount.value) * 100);
    await ctx.runMutation(internal.tips.record, { restaurantId: tip.restaurantId, nightId: tip.nightId, orderId, cents, status: "captured", payer: res.payer?.name?.given_name });
    return { ok: true };
  },
});

export const byOrder = internalQuery({
  args: { orderId: v.string() },
  handler: (ctx, { orderId }) => ctx.db.query("tips").withIndex("by_order", (q) => q.eq("paypalOrderId", orderId)).unique(),
});

/** Idempotent by PayPal order id. */
export const record = internalMutation({
  args: {
    restaurantId: v.id("restaurants"),
    nightId: v.id("nights"),
    orderId: v.string(),
    cents: v.number(),
    status: v.union(v.literal("created"), v.literal("captured")),
    payer: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("tips").withIndex("by_order", (q) => q.eq("paypalOrderId", a.orderId)).unique();
    if (existing) {
      if (existing.status !== "captured" && a.status === "captured") await ctx.db.patch(existing._id, { status: "captured", amountCents: a.cents, payer: a.payer });
      return;
    }
    await ctx.db.insert("tips", { restaurantId: a.restaurantId, nightId: a.nightId, amountCents: a.cents, paypalOrderId: a.orderId, status: a.status, payer: a.payer });
  },
});
