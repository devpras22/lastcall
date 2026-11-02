import { httpRouter } from "convex/server";
import { v } from "convex/values";
import { httpAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import * as paypal from "./lib/paypal";

const http = httpRouter();

/** PayPal webhooks: verify the signature with PayPal, dedupe by event id, then apply. */
http.route({
  path: "/paypal/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const raw = await req.text();
    if (raw.length > 100_000) return new Response("too large", { status: 413 });
    let event: { id?: string; event_type?: string; resource?: Record<string, any> };
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (!event.id || !event.event_type) return new Response("bad event", { status: 400 });

    let ok = false;
    try {
      ok = await paypal.verifyWebhook(req.headers, event);
    } catch (e) {
      console.error("webhook verify failed", event.id, e);
      return new Response("verify error", { status: 500 }); // PayPal retries
    }
    if (!ok) {
      console.warn("webhook rejected", event.id, event.event_type);
      return new Response("invalid signature", { status: 401 });
    }

    const fresh = await ctx.runMutation(internal.http.seen, { eventId: event.id, type: event.event_type });
    if (!fresh) return new Response("ok");

    const r = event.resource ?? {};
    if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.") && r.payout_item?.sender_item_id) {
      await ctx.runMutation(internal.payouts.itemStatus, {
        senderItemId: r.payout_item.sender_item_id,
        status: paypal.mapItemStatus(r.transaction_status ?? ""),
        itemId: r.payout_item_id,
        note: r.errors?.message,
      });
    }
    return new Response("ok");
  }),
});

export const seen = internalMutation({
  args: { eventId: v.string(), type: v.string() },
  handler: async (ctx, { eventId, type }) => {
    const e = await ctx.db.query("webhookEvents").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
    if (e) return false;
    await ctx.db.insert("webhookEvents", { eventId, type });
    return true;
  },
});

export default http;
