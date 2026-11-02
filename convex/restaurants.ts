import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { ownedRestaurant, randomToken, serviceDate } from "./lib/access";
import { dailyLimit, demoLimit, fail } from "./lib/problems";
import { DEMO_CARD_TIPS_CENTS, DEMO_NAME, DEMO_PAYPAL_TIPS, DEMO_POLICY, demoWorkers } from "./lib/demo";

/** A fresh copy of Rosa's for whoever clicks "Close out a demo night". */
export const createDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerKey = randomToken(16);
    const restaurantId = await ctx.db.insert("restaurants", {
      name: DEMO_NAME,
      slug: `rosas-${randomToken(4)}`,
      ownerKey,
      policyText: DEMO_POLICY,
      demo: true,
      aiCalls: 0,
    });
    for (const w of demoWorkers()) await ctx.db.insert("workers", { restaurantId, ...w });
    const nightId = await ctx.db.insert("nights", {
      restaurantId,
      date: serviceDate(),
      status: "open",
      extraTipsCents: DEMO_CARD_TIPS_CENTS,
      shifts: [],
      flags: [],
    });
    for (const cents of DEMO_PAYPAL_TIPS)
      await ctx.db.insert("tips", { restaurantId, nightId, amountCents: cents, paypalOrderId: `demo-${randomToken(6)}`, status: "captured", simulated: true });
    await ctx.scheduler.runAfter(0, internal.ai.parsePolicy, { restaurantId });
    return { ownerKey, nightId };
  },
});

export const mine = query({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    const r = await ownedRestaurant(ctx, ownerKey).catch(() => null);
    if (!r) return null;
    const workers = await ctx.db.query("workers").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id)).collect();
    const nights = await ctx.db.query("nights").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id)).order("desc").take(60);
    const { ownerKey: _k, ...restaurant } = r;
    return { restaurant, workers, nights: nights.map((n) => ({ _id: n._id, date: n.date, status: n.status })) };
  },
});

export const setPolicy = mutation({
  args: { ownerKey: v.string(), text: v.string() },
  handler: async (ctx, { ownerKey, text }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const t = text.trim();
    if (t.length < 10 || t.length > 1500) throw new ConvexError("Write the policy in 10 to 1,500 characters.");
    await ctx.db.patch(r._id, { policyText: t, rules: undefined, rulesSummary: undefined, policyProblem: undefined });
    await ctx.scheduler.runAfter(0, internal.ai.parsePolicy, { restaurantId: r._id });
  },
});

export const retryPolicy = mutation({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    await ctx.db.patch(r._id, { policyProblem: undefined, rulesSummary: undefined });
    await ctx.scheduler.runAfter(0, internal.ai.parsePolicy, { restaurantId: r._id });
  },
});

export const upsertWorker = mutation({
  args: {
    ownerKey: v.string(),
    workerId: v.optional(v.id("workers")),
    name: v.string(),
    role: v.string(),
    wallet: v.union(v.literal("PAYPAL"), v.literal("VENMO")),
    receiver: v.string(),
  },
  handler: async (ctx, a) => {
    const r = await ownedRestaurant(ctx, a.ownerKey);
    const name = a.name.trim(), role = a.role.trim().toLowerCase(), receiver = a.receiver.trim();
    if (!name || name.length > 60 || !role || role.length > 30) throw new ConvexError("Name and role are required.");
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiver);
    const digits = receiver.replace(/\D/g, "");
    if (!isEmail && digits.length !== 10) throw new ConvexError("Use a PayPal email or a 10-digit US phone number.");
    if (a.wallet === "VENMO" && isEmail) throw new ConvexError("Venmo payouts go to a phone number.");
    const doc = { restaurantId: r._id, name, role, wallet: a.wallet, recipientType: isEmail ? ("EMAIL" as const) : ("PHONE" as const), receiver: isEmail ? receiver : digits };
    if (a.workerId) {
      const w = await ctx.db.get(a.workerId);
      if (!w || w.restaurantId !== r._id) throw new ConvexError("Not found");
      await ctx.db.patch(a.workerId, doc);
      return a.workerId;
    }
    return ctx.db.insert("workers", doc);
  },
});

export const startNight = mutation({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const date = serviceDate();
    const existing = await ctx.db.query("nights").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id).eq("date", date)).first();
    if (existing && existing.status !== "paid") return existing._id;
    return ctx.db.insert("nights", { restaurantId: r._id, date, status: "open", extraTipsCents: 0, shifts: [], flags: [] });
  },
});

// ---- AI spend cap: per restaurant and per day ----
const PER_RESTAURANT = 30;
const PER_DAY = 600;

export const takeAiCall = internalMutation({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    const r = await ctx.db.get(restaurantId);
    if (!r) throw new ConvexError("Not found");
    if (r.aiCalls >= PER_RESTAURANT) throw fail(demoLimit());
    const day = new Date().toISOString().slice(0, 10);
    const u = await ctx.db.query("usage").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if (u && u.aiCalls >= PER_DAY) throw fail(dailyLimit());
    if (u) await ctx.db.patch(u._id, { aiCalls: u.aiCalls + 1 });
    else await ctx.db.insert("usage", { day, aiCalls: 1 });
    await ctx.db.patch(restaurantId, { aiCalls: r.aiCalls + 1 });
  },
});
