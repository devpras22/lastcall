import { v } from "convex/values";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { applyTopUp } from "./disputes";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as paypal from "./lib/paypal";
import { payoutStatusV } from "./schema";
import { fmt } from "./lib/split";
import { fromPayPal, itemNote, problemV } from "./lib/problems";

const APP_URL = () => process.env.APP_URL ?? "http://localhost:5173";
const TOPUP = "topup-";

/** One PayPal Payouts batch for the whole night. sender_batch_id = night id, so a retry can never pay twice. */
export const sendNight = internalAction({
  args: { nightId: v.id("nights") },
  handler: async (ctx, { nightId }) => {
    const data = await ctx.runQuery(internal.nights.internalGet, { nightId });
    if (!data || data.night.status !== "paying" || data.night.payoutBatchId) return;
    const { night, restaurant, workers, lines } = data;
    const items = lines
      .filter((l) => l.amountCents > 0 && l.workerId && workers.find((x) => x._id === l.workerId)?.receiver)
      .map((l) => {
        const w = workers.find((x) => x._id === l.workerId)!;
        return {
          senderItemId: l._id,
          cents: l.amountCents,
          wallet: w.wallet ?? "PAYPAL",
          recipientType: w.recipientType ?? "EMAIL",
          receiver: w.receiver!,
          note: `Your tips from ${restaurant.name}, ${night.date}: ${fmt(l.amountCents)} for ${l.hours}h. See why: ${APP_URL()}/r/${l.receiptToken}`,
        };
      });

    if (items.length === 0) {
      // Everyone's share is held until they add payout details.
      await ctx.runMutation(internal.payouts.settle, { nightId });
      return;
    }

    if (!paypal.paypalConfigured()) {
      // No sandbox keys yet: simulate the money flow so the UI can be built. Marked on every screen.
      await ctx.runMutation(internal.payouts.batchCreated, { nightId, batchId: `SIM-${nightId.slice(-8)}`, simulated: true });
      await Promise.all(
        items.map((it, i) =>
          ctx.scheduler.runAfter(900 + i * 450 + Math.floor(Math.random() * 400), internal.payouts.itemStatus, {
            senderItemId: it.senderItemId, status: "success", itemId: `SIMITEM${i}`,
          }),
        ),
      );
      return;
    }

    try {
      const res = await paypal.createPayoutBatch(
        night.senderBatchId!,
        `Your tips from ${restaurant.name} are here`,
        `Tonight's tip pool is paid. Tap the link in your note to see exactly how your share was worked out.`,
        items,
      );
      await ctx.runMutation(internal.payouts.batchCreated, { nightId, batchId: res.batch_header.payout_batch_id });
      await ctx.scheduler.runAfter(4000, internal.payouts.poll, { batchId: res.batch_header.payout_batch_id, attempt: 0 });
    } catch (e) {
      console.error("sendNight", nightId, e);
      await ctx.runMutation(internal.payouts.batchFailed, { nightId, problem: fromPayPal(e, "payout") });
    }
  },
});

/** A second batch for shares that were held. sender_batch_id is built from the line ids, so the same set can't be sent twice. */
export const sendHeld = internalAction({
  args: { nightId: v.id("nights"), lineIds: v.array(v.id("lines")) },
  handler: async (ctx, { nightId, lineIds }) => {
    const data = await ctx.runQuery(internal.nights.internalGet, { nightId });
    if (!data) return;
    const { night, restaurant, workers, lines } = data;
    const items = lines
      .filter((l) => lineIds.includes(l._id) && l.payoutStatus === "pending")
      .flatMap((l) => {
        const w = workers.find((x) => x._id === l.workerId);
        if (!w?.receiver) return [];
        return [{ senderItemId: l._id, cents: l.amountCents, wallet: w.wallet ?? "PAYPAL", recipientType: w.recipientType ?? "EMAIL", receiver: w.receiver,
          note: `Your tips from ${restaurant.name}, ${night.date}: ${fmt(l.amountCents)} for ${l.hours}h. See why: ${APP_URL()}/r/${l.receiptToken}` }];
      });
    if (!items.length) return;
    if (!paypal.paypalConfigured()) {
      await Promise.all(items.map((it, i) => ctx.scheduler.runAfter(800 + i * 400, internal.payouts.itemStatus, { senderItemId: it.senderItemId, status: "success", itemId: `SIMHELD${i}` })));
      return;
    }
    const batchKey = `lc-h-${[...lineIds].sort().join("").slice(-200)}`;
    try {
      const res = await paypal.createPayoutBatch(batchKey, `Your tips from ${restaurant.name} are here`, "Your held share is paid. Tap the link in your note to see how it was worked out.", items);
      await ctx.scheduler.runAfter(4000, internal.payouts.poll, { batchId: res.batch_header.payout_batch_id, attempt: 0 });
    } catch (e) {
      console.error("sendHeld", nightId, e);
      await ctx.runMutation(internal.payouts.heldFailed, { lineIds: items.map((i) => i.senderItemId as Id<"lines">), problem: fromPayPal(e, "payout") });
    }
  },
});

export const heldFailed = internalMutation({
  args: { lineIds: v.array(v.id("lines")), problem: problemV },
  handler: async (ctx, { lineIds, problem }) => {
    for (const id of lineIds) await ctx.db.patch(id, { payoutStatus: "held", payoutNote: `${problem.title}. ${problem.message}` });
    const first = lineIds[0] ? await ctx.db.get(lineIds[0]) : null;
    if (first) await settleNight(ctx, first.nightId);
  },
});

export const settle = internalMutation({
  args: { nightId: v.id("nights") },
  handler: (ctx, { nightId }) => settleNight(ctx, nightId),
});

/** Fallback to webhooks: poll the batch with backoff until every item settles. */
export const poll = internalAction({
  args: { batchId: v.string(), attempt: v.number() },
  handler: async (ctx, { batchId, attempt }) => {
    let pending = true;
    try {
      const b = await paypal.getPayoutBatch(batchId);
      for (const it of b.items ?? []) {
        await ctx.runMutation(internal.payouts.itemStatus, {
          senderItemId: it.payout_item.sender_item_id,
          status: paypal.mapItemStatus(it.transaction_status),
          itemId: it.payout_item_id,
          note: itemNote(it.transaction_status, it.errors?.name ?? it.errors?.message),
        });
      }
      pending = (b.items ?? []).length === 0 || (b.items ?? []).some((it) => paypal.mapItemStatus(it.transaction_status) === "pending");
    } catch (e) {
      console.error("poll", batchId, e);
    }
    if (pending && attempt < 12) await ctx.scheduler.runAfter(Math.min(60_000, 3000 * 2 ** attempt), internal.payouts.poll, { batchId, attempt: attempt + 1 });
  },
});

export const sendTopUp = internalAction({
  args: { disputeId: v.id("disputes") },
  handler: async (ctx, { disputeId }) => {
    const d = await ctx.runQuery(internal.disputes.internalGet, { disputeId });
    if (!d || d.dispute.status !== "approved" || !d.dispute.topUpCents || !d.worker?.receiver || d.dispute.topUpBatchId) return;
    const senderItemId = TOPUP + disputeId;
    if (!paypal.paypalConfigured()) {
      await ctx.runMutation(internal.disputes.setTopUp, { disputeId, status: "pending", batchId: `SIM-${disputeId.slice(-8)}` });
      await ctx.scheduler.runAfter(1500, internal.payouts.itemStatus, { senderItemId, status: "success", itemId: "SIMTOPUP" });
      return;
    }
    try {
      const res = await paypal.createPayoutBatch(
        `lc-${senderItemId}`,
        `A tip correction from ${d.restaurant.name}`,
        `Your manager approved your correction for ${d.night.date}.`,
        [{
          senderItemId,
          cents: d.dispute.topUpCents,
          wallet: d.worker.wallet ?? "PAYPAL",
          recipientType: d.worker.recipientType ?? "EMAIL",
          receiver: d.worker.receiver,
          note: `Top-up for ${d.night.date}: ${fmt(d.dispute.topUpCents)}. ${APP_URL()}/r/${d.line.receiptToken}`,
        }],
      );
      await ctx.runMutation(internal.disputes.setTopUp, { disputeId, status: "pending", batchId: res.batch_header.payout_batch_id });
      await ctx.scheduler.runAfter(4000, internal.payouts.poll, { batchId: res.batch_header.payout_batch_id, attempt: 0 });
    } catch (e) {
      console.error("sendTopUp", disputeId, e);
      await ctx.runMutation(internal.disputes.setTopUp, { disputeId, status: "failed", problem: fromPayPal(e, "topup") });
    }
  },
});

export const batchCreated = internalMutation({
  args: { nightId: v.id("nights"), batchId: v.string(), simulated: v.optional(v.boolean()) },
  handler: async (ctx, { nightId, batchId, simulated }) => {
    await ctx.db.patch(nightId, { payoutBatchId: batchId, simulated, payoutError: undefined, payoutProblem: undefined });
  },
});

export const batchFailed = internalMutation({
  args: { nightId: v.id("nights"), problem: problemV },
  handler: async (ctx, { nightId, problem }) => {
    await ctx.db.patch(nightId, { payoutProblem: problem });
    const lines = await ctx.db.query("lines").withIndex("by_night", (q) => q.eq("nightId", nightId)).collect();
    for (const l of lines) if (l.payoutStatus === "pending") await ctx.db.patch(l._id, { payoutStatus: "failed", payoutNote: "Held: see the message at the top." });
  },
});

/** Apply one item's status (from poll, webhook or simulation). Idempotent; never moves a settled item back. */
export const itemStatus = internalMutation({
  args: { senderItemId: v.string(), status: payoutStatusV, itemId: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, { senderItemId, status, itemId, note }) => {
    if (senderItemId.startsWith(TOPUP)) {
      const id = ctx.db.normalizeId("disputes", senderItemId.slice(TOPUP.length));
      if (id) await applyTopUp(ctx, id, status, itemId);
      return;
    }
    const lineId = ctx.db.normalizeId("lines", senderItemId);
    const line = lineId ? await ctx.db.get(lineId) : null;
    if (!line) return;
    if (line.payoutStatus === status && line.payoutItemId === itemId) return;
    if (line.payoutStatus === "success" && status !== "failed") return;
    await ctx.db.patch(line._id, { payoutStatus: status, payoutItemId: itemId ?? line.payoutItemId, payoutNote: note });
    await settleNight(ctx, line.nightId);
  },
});

async function settleNight(ctx: MutationCtx, nightId: Id<"nights">) {
  const lines = await ctx.db.query("lines").withIndex("by_night", (q) => q.eq("nightId", nightId)).collect();
  if (lines.every((l) => l.payoutStatus !== "pending")) {
    const night = await ctx.db.get(nightId);
    if (night && night.status === "paying") await ctx.db.patch(nightId, { status: "paid", paidAt: Date.now() });
  }
}
