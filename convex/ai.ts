import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as claude from "./lib/ai";
import { DEMO_BOARD_FIXTURE } from "./lib/demo";
import { fmt, isManagerRole, split } from "./lib/split";
import { rulesV } from "./schema";
import { fromClaude, problemV } from "./lib/problems";

type Media = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function image(ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } }, id: Id<"_storage">) {
  const blob = await ctx.storage.get(id);
  if (!blob) return null;
  return { base64: toBase64(await blob.arrayBuffer()), mediaType: (blob.type || "image/jpeg") as Media };
}


// ---- Policy ----

export const parsePolicy = internalAction({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    const r = await ctx.runQuery(internal.ai.restaurant, { restaurantId });
    if (!r) return;
    if (!claude.aiConfigured()) {
      // No key yet: hand-written rules for the demo policy so the app still runs end to end.
      await ctx.runMutation(internal.ai.saveRules, {
        restaurantId,
        policyText: r.policyText,
        rules: { method: "hours_x_points", rolePoints: { server: 1, bartender: 1, busser: 0.5, host: 0.5, barback: 0.5, manager: 1 }, offTheTop: [{ role: "kitchen", percent: 10 }], excludedRoles: [] },
        summary: ["Servers and bartenders: 1 point per hour.", "Bussers, hosts, barbacks: ½ point per hour.", "Kitchen: 10% off the top, split by hours.", "Manager (Marco): 1 point per hour."],
        simulated: true,
      });
      return;
    }
    try {
      await ctx.runMutation(internal.restaurants.takeAiCall, { restaurantId });
      const p = await claude.parsePolicy(r.policyText);
      await ctx.runMutation(internal.ai.saveRules, { restaurantId, policyText: r.policyText, rules: p.rules, summary: [...p.summary, ...p.ambiguities.map((a) => `Unclear: ${a}`)] });
    } catch (e) {
      console.error("parsePolicy", restaurantId, e);
      await ctx.runMutation(internal.ai.saveRules, { restaurantId, policyText: r.policyText, rules: undefined, summary: [], problem: fromClaude(e, "policy") });
    }
  },
});

export const restaurant = internalQuery({
  args: { restaurantId: v.id("restaurants") },
  handler: (ctx, { restaurantId }) => ctx.db.get(restaurantId),
});

export const saveRules = internalMutation({
  args: {
    restaurantId: v.id("restaurants"),
    policyText: v.string(),
    rules: v.optional(rulesV),
    summary: v.array(v.string()),
    simulated: v.optional(v.boolean()),
    problem: v.optional(problemV),
  },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.restaurantId);
    if (!r || r.policyText !== a.policyText) return; // policy changed while we were reading it
    await ctx.db.patch(a.restaurantId, { rules: a.rules, rulesSummary: a.problem ? undefined : a.summary, policyProblem: a.problem });
  },
});

// ---- Shift board ----

export const readBoard = internalAction({
  args: { nightId: v.id("nights") },
  handler: async (ctx, { nightId }) => {
    const data = await ctx.runQuery(internal.nights.internalGet, { nightId });
    if (!data?.night.boardStorageId) return;
    try {
      let read: claude.BoardRead;
      if (claude.aiConfigured()) {
        await ctx.runMutation(internal.restaurants.takeAiCall, { restaurantId: data.restaurant._id });
        const img = await image(ctx, data.night.boardStorageId);
        if (!img) throw new Error("Photo upload was lost. Try again.");
        read = await claude.readBoard(img, data.workers.map((w) => ({ name: w.name, role: w.role })));
      } else {
        await new Promise((r) => setTimeout(r, 2200)); // let the "reading" state show
        read = DEMO_BOARD_FIXTURE;
      }
      if (read.shifts.length === 0) throw new Error("No shifts found on that photo.");
      const shifts = read.shifts.slice(0, 60).map((s, i) => ({
        key: `b${i}`,
        name: s.name.slice(0, 60),
        role: s.role.toLowerCase().slice(0, 30),
        hours: Math.max(0, Math.min(24, Math.round(s.hours * 4) / 4)),
        clockIn: s.clockIn || undefined,
        clockOut: s.clockOut || undefined,
        confidence: Math.max(0, Math.min(1, s.confidence)),
      }));
      const flags = [
        ...read.shifts
          .slice(0, 60)
          .flatMap((s, i) => (s.note ? [{ severity: "warn" as const, code: "board", key: `b${i}`, message: `${s.name}: ${s.note}` }] : [])),
        ...(read.unreadable ? [{ severity: "warn" as const, code: "board", message: `Couldn't read: ${read.unreadable}` }] : []),
      ];
      await ctx.runMutation(internal.nights.applyBoardRead, { nightId, shifts, flags });
    } catch (e) {
      console.error("readBoard", nightId, e);
      await ctx.runMutation(internal.nights.boardFailed, { nightId, problem: fromClaude(e, "board") });
    }
  },
});

// ---- Disputes ----

export const reviewDispute = internalAction({
  args: { disputeId: v.id("disputes") },
  handler: async (ctx, { disputeId }) => {
    const d = await ctx.runQuery(internal.disputes.internalGet, { disputeId });
    if (!d) return;
    const { dispute, line, night, restaurant } = d;
    const shift = night.shifts.find((s) => s.key === line.key);
    try {
      let verdict: { plausible: boolean; claimedHours: number; reply: string; managerNote: string };
      if (claude.aiConfigured()) {
        await ctx.runMutation(internal.restaurants.takeAiCall, { restaurantId: restaurant._id });
        const board = night.boardStorageId ? await image(ctx, night.boardStorageId) : null;
        verdict = await claude.reviewDispute({
          message: dispute.message,
          worker: { name: line.name, role: line.role, hours: line.hours, clockIn: shift?.clockIn, clockOut: shift?.clockOut, confidence: shift?.confidence, amount: fmt(line.amountCents) },
          why: line.why,
          board: board ?? undefined,
        });
      } else {
        const m = dispute.message.match(/(\d{1,2})(?::(\d{2}))?\s*(a|am)\b/i);
        const lowConf = (shift?.confidence ?? 1) < 0.7;
        const claimed = m && shift ? line.hours + ((Number(m[1]) % 12) + Number(m[2] ?? 0) / 60) : 0;
        verdict = lowConf && claimed > line.hours
          ? { plausible: true, claimedHours: claimed, reply: `The board was smudged at your out time, so ${claimed} hours is believable. I've sent this to your manager with a top-up ready to approve.`, managerNote: "Out time was hard to read on the board." }
          : { plausible: false, claimedHours: 0, reply: "The board clearly shows the hours you were paid for. I've passed your note to your manager so you can talk it through.", managerNote: "Board read was clear." };
      }

      let topUpCents = 0;
      if (verdict.plausible && verdict.claimedHours > line.hours && verdict.claimedHours <= 24 && restaurant.rules && !isManagerRole(line.role)) {
        // What their share would have been with the corrected hours, everything else unchanged.
        const shifts = night.shifts.map((s) => ({ key: s.key, name: s.name, role: s.role, hours: s.key === line.key ? verdict.claimedHours : s.hours }));
        const total = d.lines.reduce((a, l) => a + l.amountCents, 0);
        const redo = split(total, shifts, restaurant.rules);
        const mine = redo.lines.find((l) => l.key === line.key)?.amountCents ?? 0;
        topUpCents = Math.max(0, mine - line.amountCents);
      }
      await ctx.runMutation(internal.disputes.saveVerdict, {
        disputeId,
        status: topUpCents > 0 ? "proposed" : "declined",
        verdict: `${verdict.reply}\n\nFor the manager: ${verdict.managerNote}`,
        claimedHours: verdict.claimedHours || undefined,
        topUpCents: topUpCents || undefined,
      });
    } catch (e) {
      console.error("reviewDispute", disputeId, e);
      const problem = fromClaude(e, "dispute");
      await ctx.runMutation(internal.disputes.saveVerdict, {
        disputeId,
        status: "declined",
        verdict: `I couldn’t check the board automatically just now, so I’ve passed your note straight to your manager.\n\nFor the manager: ${problem.title}. Check the hours by hand.`,
        problem,
      });
    }
  },
});
