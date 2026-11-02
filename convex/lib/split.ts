// Tip-pool math. Pure, deterministic, integer cents. The AI never does arithmetic;
// it only reads the board and the policy into the shapes below.

export type Method = "hours" | "points" | "hours_x_points";

export type Rules = {
  method: Method;
  /** role -> points; roles missing here default to 1 with a warning */
  rolePoints: Record<string, number>;
  /** pools taken off the top before the main split, e.g. kitchen 10% */
  offTheTop: { role: string; percent: number }[];
  /** roles the policy leaves out of the pool */
  excludedRoles: string[];
};

export type Shift = {
  key: string; // stable id (worker id or board row)
  name: string;
  role: string;
  hours: number;
  confidence?: number; // 0..1 from the board read
};

export type Flag = {
  severity: "error" | "warn";
  code:
    | "manager_in_pool"
    | "bad_hours"
    | "long_shift"
    | "low_confidence"
    | "unknown_role"
    | "empty_pool"
    | "bad_percent"
    | "not_on_roster"
    | "no_payout"
    | "no_payout_row"
    | "board";
  key?: string;
  message: string;
};

export type Line = {
  key: string;
  name: string;
  role: string;
  hours: number;
  points: number;
  weight: number;
  amountCents: number;
  pool: "main" | string; // "main" or the off-the-top role
  why: string[];
};

export type SplitResult = {
  totalCents: number;
  lines: Line[];
  unallocatedCents: number;
  flags: Flag[];
};

// FLSA 29 U.S.C. 203(m)(2)(B): managers and supervisors may not keep employees' tips.
const MANAGER_ROLES = /\b(manager|gm|owner|supervisor|director|chef de cuisine|executive chef|mgr)\b/i;

export const isManagerRole = (role: string) => MANAGER_ROLES.test(role);

export const norm = (role: string) => role.trim().toLowerCase();

// Board shorthand → the roles house rules are written in. Deterministic, so a policy about "kitchen" catches line cooks and dish.
const ROLE_ALIASES: [RegExp, string][] = [
  [/^(line( cook)?|cook|prep( cook)?|dish(washer)?|dishes|kitchen|boh|back of house|chef|sous( chef)?|expo|pastry|grill|fry|saute)$/, "kitchen"],
  [/^(bar|bartender|bartend|bt|mixologist)$/, "bartender"],
  [/^(barback|bar back)$/, "barback"],
  [/^(bus|busser|busboy|bus boy|busperson|bussing)$/, "busser"],
  [/^(host|hostess|host stand)$/, "host"],
  [/^(run|runner|food runner)$/, "runner"],
  [/^(server|serve|waiter|waitress|wait staff|waitstaff|svr)$/, "server"],
  [/^(mgr|manager|gm|general manager|agm|mod|manager on duty|floor manager)$/, "manager"],
];
export function canonicalRole(role: string) {
  const r = norm(role).replace(/[.]/g, "");
  return ROLE_ALIASES.find(([re]) => re.test(r))?.[1] ?? r;
}

export const fmt = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

/** Split `total` cents by weights so the parts sum exactly to total (largest remainder, ties by index). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

export function split(totalCents: number, shifts: Shift[], rules: Rules): SplitResult {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error("totalCents must be a non-negative integer");
  const flags: Flag[] = [];
  const excluded = new Set(rules.excludedRoles.map(norm));
  const points = new Map(Object.entries(rules.rolePoints).map(([r, p]) => [norm(r), p]));
  const lines: Line[] = [];
  const warnedRoles = new Set<string>();

  // Sanity flags on the board read.
  for (const s of shifts) {
    if (!(s.hours > 0)) flags.push({ severity: "error", code: "bad_hours", key: s.key, message: `${s.name}: ${s.hours} hours can't be right.` });
    else if (s.hours > 16) flags.push({ severity: "warn", code: "long_shift", key: s.key, message: `${s.name}: ${num(s.hours)} hours is a very long shift. Check the board.` });
    if (s.confidence !== undefined && s.confidence < 0.7)
      flags.push({ severity: "warn", code: "low_confidence", key: s.key, message: `${s.name}: the board was hard to read here. Confirm ${num(s.hours)}h as ${s.role}.` });
  }

  // Managers are out no matter what the policy says.
  const eligible: Shift[] = [];
  for (const s of shifts) {
    const r = norm(s.role);
    if (isManagerRole(s.role)) {
      const policyIncluded = !excluded.has(r);
      flags.push({
        severity: policyIncluded ? "error" : "warn",
        code: "manager_in_pool",
        key: s.key,
        message: policyIncluded
          ? `${s.name} is a ${s.role}. Federal law (FLSA) bars managers from the tip pool, so they're left out even though the policy includes them.`
          : `${s.name} (${s.role}) is left out of the pool, as the law requires.`,
      });
      lines.push(zeroLine(s, ["Managers and supervisors can't share in the tip pool under federal law (FLSA §203(m))."]));
    } else if (excluded.has(r)) {
      lines.push(zeroLine(s, [`House policy leaves ${s.role} out of the tip pool.`]));
    } else if (s.hours > 0) {
      eligible.push(s);
    } else {
      lines.push(zeroLine(s, ["No valid hours on the board."]));
    }
  }

  // Off-the-top pools.
  let remaining = totalCents;
  const topRoles = new Set<string>();
  const pctSum = rules.offTheTop.reduce((a, t) => a + t.percent, 0);
  if (rules.offTheTop.some((t) => t.percent < 0 || t.percent > 100) || pctSum > 100) {
    flags.push({ severity: "error", code: "bad_percent", message: `Off-the-top pools add up to ${num(pctSum)}%, which isn't possible.` });
  } else {
    const topCents = allocate(Math.round((totalCents * pctSum) / 100), rules.offTheTop.map((t) => t.percent));
    rules.offTheTop.forEach((t, i) => {
      const role = norm(t.role);
      topRoles.add(role);
      const members = eligible.filter((s) => norm(s.role) === role);
      if (members.length === 0) {
        flags.push({ severity: "warn", code: "empty_pool", message: `Policy sets ${num(t.percent)}% aside for ${t.role}, but nobody on the board is ${t.role}. That share stays in the main pool.` });
        return;
      }
      remaining -= topCents[i];
      const hours = members.reduce((a, s) => a + s.hours, 0);
      const amounts = allocate(topCents[i], members.map((s) => s.hours));
      members.forEach((s, j) =>
        lines.push({
          key: s.key, name: s.name, role: s.role, hours: s.hours, points: 0, weight: s.hours,
          amountCents: amounts[j], pool: role,
          why: [
            `${t.role} gets ${num(t.percent)}% off the top of ${fmt(totalCents)} = ${fmt(topCents[i])}.`,
            `Split by hours among ${members.length} ${t.role}: you worked ${num(s.hours)} of ${num(hours)} hours.`,
          ],
        }),
      );
    });
  }

  // Main pool.
  const main = eligible.filter((s) => !topRoles.has(norm(s.role)));
  const pts = main.map((s) => {
    const r = norm(s.role);
    if (!points.has(r) && rules.method !== "hours" && !warnedRoles.has(r)) {
      warnedRoles.add(r);
      flags.push({ severity: "warn", code: "unknown_role", message: `Policy doesn't say how many points a ${s.role} gets. Using 1.` });
    }
    return points.get(r) ?? 1;
  });
  const weights = main.map((s, i) =>
    rules.method === "hours" ? s.hours : rules.method === "points" ? pts[i] : s.hours * pts[i],
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let unallocated = 0;
  if (main.length === 0 || totalWeight <= 0) {
    unallocated = remaining;
    if (remaining > 0) flags.push({ severity: "error", code: "empty_pool", message: `Nobody is eligible for the main pool, so ${fmt(remaining)} can't be paid out.` });
  } else {
    const amounts = allocate(remaining, weights);
    main.forEach((s, i) => {
      const why = [
        remaining === totalCents ? `Tonight's pool: ${fmt(totalCents)}.` : `Pool after off-the-top shares: ${fmt(remaining)} of ${fmt(totalCents)}.`,
        rules.method === "hours"
          ? `Split by hours: you worked ${num(s.hours)} of ${num(totalWeight)} hours.`
          : rules.method === "points"
            ? `Split by points: a ${s.role} gets ${num(pts[i])} point${pts[i] === 1 ? "" : "s"}, out of ${num(totalWeight)} total.`
            : `Your share: ${num(s.hours)}h × ${num(pts[i])} pt (${s.role}) = ${num(weights[i])} of ${num(totalWeight)} team points.`,
        `${num((weights[i] / totalWeight) * 100)}% of ${fmt(remaining)} = ${fmt(amounts[i])}.`,
      ];
      lines.push({ key: s.key, name: s.name, role: s.role, hours: s.hours, points: pts[i], weight: weights[i], amountCents: amounts[i], pool: "main", why });
    });
  }

  // Keep the board order.
  const order = new Map(shifts.map((s, i) => [s.key, i]));
  lines.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  return { totalCents, lines, unallocatedCents: unallocated, flags };
}

function zeroLine(s: Shift, why: string[]): Line {
  return { key: s.key, name: s.name, role: s.role, hours: s.hours, points: 0, weight: 0, amountCents: 0, pool: "none", why };
}
