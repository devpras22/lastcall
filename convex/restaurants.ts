import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { ownedRestaurant, randomToken, serviceDate } from "./lib/access";
import { dailyLimit, demoLimit, fail } from "./lib/problems";
import { canonicalRole } from "./lib/split";
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
      joinToken: randomToken(10),
    });
    for (const w of demoWorkers()) await ctx.db.insert("workers", { restaurantId, ...w, addedBy: "demo" });
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

const MAX_STAFF = 80;
const MAX_NEW_RESTAURANTS_PER_DAY = 400;

/** Payout details from a free-text field: a PayPal email, or a 10-digit US phone for Venmo/PayPal. */
export function parseReceiver(wallet: "PAYPAL" | "VENMO", raw: string) {
  const receiver = raw.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiver) && receiver.length <= 120;
  const digits = receiver.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (wallet === "VENMO") {
    if (digits.length !== 10) throw new ConvexError("Venmo payouts go to a 10-digit US phone number.");
    return { wallet, recipientType: "PHONE" as const, receiver: digits };
  }
  if (isEmail) return { wallet, recipientType: "EMAIL" as const, receiver: receiver.toLowerCase() };
  if (digits.length === 10) return { wallet, recipientType: "PHONE" as const, receiver: digits };
  throw new ConvexError("Use the email on your PayPal account, or a 10-digit US phone number.");
}

const cleanName = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 60);
const cleanRole = (s: string) => canonicalRole(s).slice(0, 30);

/** "Set up your own restaurant": a real, empty restaurant the visitor owns. */
export const createOwn = mutation({
  args: { name: v.string(), policyText: v.string(), staff: v.array(v.object({ name: v.string(), role: v.string() })) },
  handler: async (ctx, a) => {
    const name = a.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 60) throw new ConvexError("Give the restaurant a name (2 to 60 characters).");
    const policy = a.policyText.trim();
    if (policy.length < 10 || policy.length > 1500) throw new ConvexError("Write the house rules in 10 to 1,500 characters.");
    if (a.staff.length > MAX_STAFF) throw new ConvexError(`Up to ${MAX_STAFF} staff for now.`);
    const day = new Date().toISOString().slice(0, 10);
    const u = await ctx.db.query("usage").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if ((u?.restaurants ?? 0) >= MAX_NEW_RESTAURANTS_PER_DAY) throw new ConvexError("The demo has reached today’s limit for new restaurants. Try the sample night, or come back tomorrow.");
    if (u) await ctx.db.patch(u._id, { restaurants: (u.restaurants ?? 0) + 1 });
    else await ctx.db.insert("usage", { day, aiCalls: 0, restaurants: 1 });

    const ownerKey = randomToken(16);
    const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "restaurant";
    const restaurantId = await ctx.db.insert("restaurants", {
      name, slug: `${slugBase}-${randomToken(4)}`, ownerKey, policyText: policy, demo: false, aiCalls: 0, joinToken: randomToken(10),
    });
    const seen = new Set<string>();
    for (const s of a.staff) {
      const n = cleanName(s.name), r = cleanRole(s.role) || "server";
      if (!n || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      await ctx.db.insert("workers", { restaurantId, name: n, role: r, addedBy: "manager" });
    }
    const nightId = await ctx.db.insert("nights", { restaurantId, date: serviceDate(), status: "open", extraTipsCents: 0, shifts: [], flags: [] });
    await ctx.scheduler.runAfter(0, internal.ai.parsePolicy, { restaurantId });
    return { ownerKey, nightId };
  },
});

/** Older restaurants get a staff link on first use. */
export const ensureJoinToken = mutation({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    if (r.joinToken) return r.joinToken;
    const joinToken = randomToken(10);
    await ctx.db.patch(r._id, { joinToken });
    return joinToken;
  },
});

/** Start a fresh link, so an old one someone forwarded stops working. */
export const resetJoinToken = mutation({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const joinToken = randomToken(10);
    await ctx.db.patch(r._id, { joinToken });
    return joinToken;
  },
});

/** Add names from tonight's board to the staff list in one tap. */
export const addToStaff = mutation({
  args: { ownerKey: v.string(), people: v.array(v.object({ name: v.string(), role: v.string() })) },
  handler: async (ctx, { ownerKey, people }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const workers = await ctx.db.query("workers").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id)).collect();
    if (workers.length + people.length > MAX_STAFF) throw new ConvexError(`Up to ${MAX_STAFF} staff for now.`);
    const have = new Set(workers.map((w) => w.name.toLowerCase()));
    let added = 0;
    for (const p of people.slice(0, 40)) {
      const n = cleanName(p.name);
      if (!n || have.has(n.toLowerCase())) continue;
      have.add(n.toLowerCase());
      await ctx.db.insert("workers", { restaurantId: r._id, name: n, role: cleanRole(p.role) || "server", addedBy: "board" });
      added++;
    }
    return added;
  },
});

export const removeWorker = mutation({
  args: { ownerKey: v.string(), workerId: v.id("workers") },
  handler: async (ctx, { ownerKey, workerId }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const w = await ctx.db.get(workerId);
    if (!w || w.restaurantId !== r._id) throw new ConvexError("Not found");
    await ctx.db.delete(workerId);
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
    wallet: v.optional(v.union(v.literal("PAYPAL"), v.literal("VENMO"))),
    receiver: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const r = await ownedRestaurant(ctx, a.ownerKey);
    const name = cleanName(a.name), role = cleanRole(a.role);
    if (!name || !role) throw new ConvexError("Name and role are required.");
    const pay = a.receiver?.trim() ? parseReceiver(a.wallet ?? "PAYPAL", a.receiver) : { wallet: undefined, recipientType: undefined, receiver: undefined };
    const doc = { restaurantId: r._id, name, role, ...pay };
    if (a.workerId) {
      const w = await ctx.db.get(a.workerId);
      if (!w || w.restaurantId !== r._id) throw new ConvexError("Not found");
      await ctx.db.patch(a.workerId, doc);
      return a.workerId;
    }
    const count = (await ctx.db.query("workers").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id)).collect()).length;
    if (count >= MAX_STAFF) throw new ConvexError(`Up to ${MAX_STAFF} staff for now.`);
    return ctx.db.insert("workers", { ...doc, addedBy: "manager" });
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
