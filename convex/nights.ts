import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { flagV, shiftV } from "./schema";
import { ownedNight, ownedRestaurant, randomToken } from "./lib/access";
import { buildPreview, matchWorker } from "./lib/preview";
import { problemV } from "./lib/problems";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function loadNight(ctx: Parameters<typeof ownedNight>[0], nightId: Parameters<typeof ownedNight>[2], ownerKey: string) {
  const { restaurant, night } = await ownedNight(ctx, ownerKey, nightId);
  const tips = await ctx.db.query("tips").withIndex("by_night", (q) => q.eq("nightId", nightId)).collect();
  const workers = await ctx.db.query("workers").withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurant._id)).collect();
  return { restaurant, night, tips, workers };
}

export const get = query({
  args: { ownerKey: v.string(), nightId: v.id("nights") },
  handler: async (ctx, { ownerKey, nightId }) => {
    const { restaurant, night, tips, workers } = await loadNight(ctx, nightId, ownerKey);
    const preview = buildPreview(restaurant, night, tips, workers);
    const lines = await ctx.db.query("lines").withIndex("by_night", (q) => q.eq("nightId", nightId)).collect();
    const disputes = await ctx.db.query("disputes").withIndex("by_night", (q) => q.eq("nightId", nightId)).collect();
    const boardUrl = night.boardStorageId ? await ctx.storage.getUrl(night.boardStorageId) : null;
    const { ownerKey: _k, ...r } = restaurant;
    return {
      restaurant: r,
      sandbox: (process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").includes("sandbox"),
      night,
      boardUrl,
      tips: tips.map((t) => ({ _id: t._id, amountCents: t.amountCents, status: t.status, simulated: !!t.simulated, at: t._creationTime, payer: t.payer })),
      preview,
      lines,
      disputes,
    };
  },
});

export const setExtraTips = mutation({
  args: { ownerKey: v.string(), nightId: v.id("nights"), cents: v.number() },
  handler: async (ctx, { ownerKey, nightId, cents }) => {
    const { night } = await ownedNight(ctx, ownerKey, nightId);
    if (night.status === "paying" || night.status === "paid") throw new ConvexError("This night is already paid out.");
    if (!Number.isInteger(cents) || cents < 0 || cents > 5_000_000) throw new ConvexError("Enter an amount up to $50,000.");
    await ctx.db.patch(nightId, { extraTipsCents: cents });
  },
});

export const uploadUrl = mutation({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    await ownedRestaurant(ctx, ownerKey);
    return ctx.storage.generateUploadUrl();
  },
});

export const setBoard = mutation({
  args: { ownerKey: v.string(), nightId: v.id("nights"), storageId: v.id("_storage") },
  handler: async (ctx, { ownerKey, nightId, storageId }) => {
    const { night } = await ownedNight(ctx, ownerKey, nightId);
    if (night.status === "paying" || night.status === "paid") throw new ConvexError("This night is already paid out.");
    const meta = await ctx.db.system.get(storageId);
    if (!meta || meta.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.includes(meta.contentType ?? "")) {
      await ctx.storage.delete(storageId);
      throw new ConvexError("Use a JPG, PNG or WebP photo under 5 MB.");
    }
    if (night.boardStorageId) await ctx.storage.delete(night.boardStorageId);
    await ctx.db.patch(nightId, { boardStorageId: storageId, status: "reading", boardError: undefined, boardProblem: undefined, shifts: [], flags: [] });
    await ctx.scheduler.runAfter(0, internal.ai.readBoard, { nightId });
  },
});

export const editShift = mutation({
  args: {
    ownerKey: v.string(),
    nightId: v.id("nights"),
    key: v.optional(v.string()), // missing = add a row
    name: v.string(),
    role: v.string(),
    hours: v.number(),
    remove: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const { restaurant, night } = await ownedNight(ctx, a.ownerKey, a.nightId);
    if (night.status === "paying" || night.status === "paid") throw new ConvexError("This night is already paid out.");
    if (!(a.hours >= 0 && a.hours <= 24)) throw new ConvexError("Hours must be between 0 and 24.");
    const name = a.name.trim().slice(0, 60), role = a.role.trim().toLowerCase().slice(0, 30);
    if (!a.remove && (!name || !role)) throw new ConvexError("Name and role are required.");
    const workers = await ctx.db.query("workers").withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurant._id)).collect();
    let shifts = night.shifts;
    if (a.remove) shifts = shifts.filter((s) => s.key !== a.key);
    else if (a.key) shifts = shifts.map((s) => (s.key === a.key ? { ...s, name, role, hours: a.hours, confidence: 1, workerId: matchWorker(name, workers)?._id } : s));
    else shifts = [...shifts, { key: randomToken(5), name, role, hours: a.hours, confidence: 1, workerId: matchWorker(name, workers)?._id }];
    await ctx.db.patch(a.nightId, { shifts, status: shifts.length ? "review" : "open" });
  },
});

/** Manager approves: server recomputes every amount, freezes the lines, and starts the payout. */
export const approve = mutation({
  args: { ownerKey: v.string(), nightId: v.id("nights") },
  handler: async (ctx, { ownerKey, nightId }) => {
    const { restaurant, night, tips, workers } = await loadNight(ctx, nightId, ownerKey);
    if (night.status !== "review") throw new ConvexError(night.status === "paying" || night.status === "paid" ? "Already paid out." : "Read the shift board first.");
    if (!restaurant.rules)
      throw new ConvexError(restaurant.policyProblem ? "Claude couldn’t read the house rules yet, so there’s nothing to split by. Fix or retry the house rules first." : "Still reading the house rules. Try again in a moment.");
    const p = buildPreview(restaurant, night, tips, workers);
    const blocking = p.flags.filter((f) => f.severity === "error" && f.code !== "manager_in_pool");
    if (blocking.length) throw new ConvexError(blocking[0].message);
    if (p.totals.totalCents <= 0) throw new ConvexError("There are no tips to pay out yet.");
    for (const l of p.lines) {
      await ctx.db.insert("lines", {
        nightId,
        restaurantId: restaurant._id,
        key: l.key,
        workerId: l.worker?._id,
        name: l.worker?.name ?? l.name,
        role: l.role,
        hours: l.hours,
        points: l.points,
        amountCents: l.amountCents,
        pool: l.pool,
        why: l.why,
        receiptToken: randomToken(12),
        payoutStatus: l.amountCents > 0 ? "pending" : "none",
      });
    }
    await ctx.db.patch(nightId, { status: "paying", senderBatchId: `lc-${nightId}` });
    await ctx.scheduler.runAfter(0, internal.payouts.sendNight, { nightId });
  },
});

/** Re-send a batch that PayPal refused (e.g. sandbox out of funds). Same sender_batch_id, so it can never double-pay. */
export const retryPayout = mutation({
  args: { ownerKey: v.string(), nightId: v.id("nights") },
  handler: async (ctx, { ownerKey, nightId }) => {
    const { night } = await ownedNight(ctx, ownerKey, nightId);
    if (night.status !== "paying" || night.payoutBatchId || !(night.payoutProblem || night.payoutError)) throw new ConvexError("Nothing to retry.");
    const lines = await ctx.db.query("lines").withIndex("by_night", (q) => q.eq("nightId", nightId)).collect();
    for (const l of lines) if (l.payoutStatus === "failed") await ctx.db.patch(l._id, { payoutStatus: "pending", payoutNote: undefined });
    await ctx.db.patch(nightId, { payoutError: undefined, payoutProblem: undefined });
    await ctx.scheduler.runAfter(0, internal.payouts.sendNight, { nightId });
  },
});

export const retryBoard = mutation({
  args: { ownerKey: v.string(), nightId: v.id("nights") },
  handler: async (ctx, { ownerKey, nightId }) => {
    const { night } = await ownedNight(ctx, ownerKey, nightId);
    if (night.status !== "open" || !night.boardStorageId) throw new ConvexError("Take a photo of the board first.");
    await ctx.db.patch(nightId, { status: "reading", boardProblem: undefined, boardError: undefined });
    await ctx.scheduler.runAfter(0, internal.ai.readBoard, { nightId });
  },
});

// ---- internal ----

export const internalGet = internalQuery({
  args: { nightId: v.id("nights") },
  handler: async (ctx, { nightId }) => {
    const night = await ctx.db.get(nightId);
    if (!night) return null;
    const restaurant = (await ctx.db.get(night.restaurantId))!;
    const workers = await ctx.db.query("workers").withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurant._id)).collect();
    const lines = await ctx.db.query("lines").withIndex("by_night", (q) => q.eq("nightId", nightId)).collect();
    return { night, restaurant, workers, lines };
  },
});

export const applyBoardRead = internalMutation({
  args: { nightId: v.id("nights"), shifts: v.array(shiftV), flags: v.array(flagV) },
  handler: async (ctx, { nightId, shifts, flags }) => {
    const night = await ctx.db.get(nightId);
    if (!night || night.status !== "reading") return;
    const workers = await ctx.db.query("workers").withIndex("by_restaurant", (q) => q.eq("restaurantId", night.restaurantId)).collect();
    await ctx.db.patch(nightId, {
      status: "review",
      shifts: shifts.map((s) => ({ ...s, workerId: matchWorker(s.name, workers)?._id })),
      flags,
    });
  },
});

export const boardFailed = internalMutation({
  args: { nightId: v.id("nights"), problem: problemV },
  handler: async (ctx, { nightId, problem }) => {
    await ctx.db.patch(nightId, { status: "open", boardProblem: problem });
  },
});
