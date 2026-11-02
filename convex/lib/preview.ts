import type { Doc } from "../_generated/dataModel";
import { firstName } from "./access";
import { split, type Flag, type Rules } from "./split";

export const DEFAULT_RULES: Rules = { method: "hours", rolePoints: {}, offTheTop: [], excludedRoles: [] };

export function tipTotals(night: Doc<"nights">, tips: Doc<"tips">[]) {
  const paypalCents = tips.filter((t) => t.status === "captured").reduce((a, t) => a + t.amountCents, 0);
  return { paypalCents, extraCents: night.extraTipsCents, totalCents: paypalCents + night.extraTipsCents };
}

/** Match board names to the roster by full or first name. */
export function matchWorker(name: string, workers: Doc<"workers">[]) {
  const n = name.trim().toLowerCase();
  return (
    workers.find((w) => w.name.toLowerCase() === n) ??
    workers.find((w) => firstName(w.name) === firstName(n)) ??
    null
  );
}

export function buildPreview(restaurant: Doc<"restaurants">, night: Doc<"nights">, tips: Doc<"tips">[], workers: Doc<"workers">[]) {
  const totals = tipTotals(night, tips);
  const rules = restaurant.rules ?? DEFAULT_RULES;
  const result = split(
    totals.totalCents,
    night.shifts.map((s) => ({ key: s.key, name: s.name, role: s.role, hours: s.hours, confidence: s.confidence })),
    rules,
  );
  const flags: Flag[] = [...result.flags];
  const lines = result.lines.map((l) => {
    const shift = night.shifts.find((s) => s.key === l.key)!;
    const worker = shift.workerId ? workers.find((w) => w._id === shift.workerId) ?? null : matchWorker(l.name, workers);
    if (l.amountCents > 0 && !worker)
      flags.push({ severity: "error", code: "not_on_roster",key: l.key, message: `${l.name} isn't on the staff list, so there's nowhere to send ${(l.amountCents / 100).toFixed(2)}. Add them or fix the name.` });
    return { ...l, clockIn: shift.clockIn, clockOut: shift.clockOut, confidence: shift.confidence, worker: worker ? { _id: worker._id, name: worker.name, wallet: worker.wallet, receiver: worker.receiver } : null };
  });
  return { totals, rules, lines, unallocatedCents: result.unallocatedCents, flags: [...flags, ...night.flags] };
}
