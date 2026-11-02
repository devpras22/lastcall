import { v } from "convex/values";
import { query } from "./_generated/server";
import { ownedRestaurant } from "./lib/access";

/** Every paid line for the restaurant, for the AG Grid ledger. */
export const rows = query({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    const r = await ownedRestaurant(ctx, ownerKey);
    const nights = await ctx.db.query("nights").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id)).order("desc").take(90);
    const disputes = await ctx.db.query("disputes").withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id)).collect();
    const rows = [];
    for (const n of nights) {
      if (n.status !== "paying" && n.status !== "paid") continue;
      const lines = await ctx.db.query("lines").withIndex("by_night", (q) => q.eq("nightId", n._id)).collect();
      for (const l of lines) {
        const ds = disputes.filter((d) => d.lineId === l._id);
        const topUp = ds.filter((d) => d.status === "paid").reduce((a, d) => a + (d.topUpCents ?? 0), 0);
        rows.push({
          id: l._id,
          date: n.date,
          name: l.name,
          role: l.role,
          hours: l.hours,
          points: l.points,
          pool: l.pool,
          amount: l.amountCents / 100,
          topUp: topUp / 100,
          perHour: l.hours > 0 ? (l.amountCents + topUp) / 100 / l.hours : 0,
          status: l.payoutStatus,
          dispute: ds.length ? ds[ds.length - 1].status : "",
          receipt: l.receiptToken,
          simulated: !!n.simulated,
        });
      }
    }
    return rows;
  },
});
