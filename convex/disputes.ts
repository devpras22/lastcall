import { v, ConvexError, type Infer } from "convex/values";
import { mutation, query, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ownedRestaurant } from "./lib/access";
import { payoutStatusV } from "./schema";
import { problemV, type Problem } from "./lib/problems";

/** Worker's receipt. The token in the link is the only key; it shows one line and nothing else. */
export const receipt = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (token.length < 10 || token.length > 40) return null;
    const line = await ctx.db.query("lines").withIndex("by_token", (q) => q.eq("receiptToken", token)).unique();
    if (!line) return null;
    const night = (await ctx.db.get(line.nightId))!;
    const restaurant = (await ctx.db.get(line.restaurantId))!;
    const worker = line.workerId ? await ctx.db.get(line.workerId) : null;
    const disputes = await ctx.db.query("disputes").withIndex("by_line", (q) => q.eq("lineId", line._id)).collect();
    const shift = night.shifts.find((s) => s.key === line.key);
    return {
      restaurant: restaurant.name,
      date: night.date,
      paidAt: night.paidAt,
      simulated: !!night.simulated,
      line: {
        name: line.name, role: line.role, hours: line.hours, points: line.points, amountCents: line.amountCents, why: line.why,
        payoutStatus: line.payoutStatus, payoutNote: line.payoutNote, clockIn: shift?.clockIn, clockOut: shift?.clockOut,
      },
      wallet: worker?.wallet ?? null,
      receiverHint: worker ? (worker.recipientType === "PHONE" ? `•••${worker.receiver.slice(-4)}` : worker.receiver.replace(/^(.).*(@.*)$/, "$1•••$2")) : null,
      disputes: disputes.map((d) => ({ _id: d._id, message: d.message, status: d.status, reply: d.verdict?.split("\n\nFor the manager:")[0], topUpCents: d.topUpCents, topUpStatus: d.topUpStatus, at: d._creationTime })),
    };
  },
});

export const open = mutation({
  args: { token: v.string(), message: v.string() },
  handler: async (ctx, { token, message }) => {
    const text = message.trim();
    if (text.length < 4 || text.length > 500) throw new ConvexError("Say what's off in a sentence or two (up to 500 characters).");
    const line = await ctx.db.query("lines").withIndex("by_token", (q) => q.eq("receiptToken", token)).unique();
    if (!line) throw new ConvexError("Not found");
    const existing = await ctx.db.query("disputes").withIndex("by_line", (q) => q.eq("lineId", line._id)).collect();
    if (existing.length >= 3) throw new ConvexError("You've already raised this a few times. Talk to your manager directly.");
    if (existing.some((d) => d.status === "checking" || d.status === "proposed" || d.status === "approved")) throw new ConvexError("Your last note is still being looked at.");
    const disputeId = await ctx.db.insert("disputes", { lineId: line._id, nightId: line.nightId, restaurantId: line.restaurantId, message: text, status: "checking" });
    await ctx.scheduler.runAfter(0, internal.ai.reviewDispute, { disputeId });
  },
});

export const forRestaurant = query({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const ds = await ctx.db.query("disputes").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id)).order("desc").take(50);
    return Promise.all(
      ds.map(async (d) => {
        const line = (await ctx.db.get(d.lineId))!;
        return { ...d, name: line.name, role: line.role, hours: line.hours, paidCents: line.amountCents };
      }),
    );
  },
});

export const decide = mutation({
  args: { ownerKey: v.string(), disputeId: v.id("disputes"), approve: v.boolean() },
  handler: async (ctx, { ownerKey, disputeId, approve }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const d = await ctx.db.get(disputeId);
    if (!d || d.restaurantId !== r._id) throw new ConvexError("Not found");
    if (d.status !== "proposed") throw new ConvexError("Nothing to approve here.");
    if (!approve) {
      await ctx.db.patch(disputeId, { status: "declined" });
      return;
    }
    await ctx.db.patch(disputeId, { status: "approved", topUpStatus: "pending" });
    await ctx.scheduler.runAfter(0, internal.payouts.sendTopUp, { disputeId });
  },
});

export const retryTopUp = mutation({
  args: { ownerKey: v.string(), disputeId: v.id("disputes") },
  handler: async (ctx, { ownerKey, disputeId }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const d = await ctx.db.get(disputeId);
    if (!d || d.restaurantId !== r._id) throw new ConvexError("Not found");
    if (d.status !== "approved" || d.topUpStatus !== "failed" || d.topUpBatchId) throw new ConvexError("Nothing to retry.");
    await ctx.db.patch(disputeId, { topUpStatus: "pending", problem: undefined });
    await ctx.scheduler.runAfter(0, internal.payouts.sendTopUp, { disputeId });
  },
});

// ---- internal ----

export const internalGet = internalQuery({
  args: { disputeId: v.id("disputes") },
  handler: async (ctx, { disputeId }) => {
    const dispute = await ctx.db.get(disputeId);
    if (!dispute) return null;
    const line = (await ctx.db.get(dispute.lineId))!;
    const night = (await ctx.db.get(dispute.nightId))!;
    const restaurant = (await ctx.db.get(dispute.restaurantId))!;
    const lines = await ctx.db.query("lines").withIndex("by_night", (q) => q.eq("nightId", dispute.nightId)).collect();
    const worker = line.workerId ? await ctx.db.get(line.workerId) : null;
    return { dispute, line, night, restaurant, lines, worker };
  },
});

export const saveVerdict = internalMutation({
  args: {
    disputeId: v.id("disputes"),
    status: v.union(v.literal("proposed"), v.literal("declined")),
    verdict: v.string(),
    claimedHours: v.optional(v.number()),
    topUpCents: v.optional(v.number()),
    problem: v.optional(problemV),
  },
  handler: async (ctx, { disputeId, ...rest }) => {
    await ctx.db.patch(disputeId, rest);
  },
});

export async function applyTopUp(
  ctx: MutationCtx,
  disputeId: Id<"disputes">,
  status: Infer<typeof payoutStatusV>,
  itemId?: string,
  batchId?: string,
  problem?: Problem,
) {
  const d = await ctx.db.get(disputeId);
  if (!d || d.topUpStatus === "success") return;
  await ctx.db.patch(disputeId, {
    topUpStatus: status,
    ...(itemId ? { topUpItemId: itemId } : {}),
    ...(batchId ? { topUpBatchId: batchId } : {}),
    problem: status === "failed" ? problem : undefined,
    ...(status === "success" ? { status: "paid" as const } : {}),
  });
}

export const setTopUp = internalMutation({
  args: { disputeId: v.id("disputes"), status: payoutStatusV, itemId: v.optional(v.string()), batchId: v.optional(v.string()), problem: v.optional(problemV) },
  handler: (ctx, a) => applyTopUp(ctx, a.disputeId, a.status, a.itemId, a.batchId, a.problem),
});
