import { describe, expect, it } from "vitest";
import { allocate, canonicalRole, split, type Rules, type Shift } from "./split";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocate", () => {
  it("always sums to the total", () => {
    for (let t = 0; t < 2000; t += 7) {
      const w = [1, 1, 1, 0.5, 2.25, 3];
      expect(sum(allocate(t, w))).toBe(t);
    }
  });
  it("splits evenly with deterministic leftovers", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it("returns zeros for zero weight", () => {
    expect(allocate(100, [0, 0])).toEqual([0, 0]);
  });
});

const rosas: Shift[] = [
  { key: "a", name: "Ana", role: "server", hours: 6 },
  { key: "b", name: "Ben", role: "bartender", hours: 8 },
  { key: "c", name: "Cy", role: "busser", hours: 5 },
  { key: "d", name: "Dee", role: "kitchen", hours: 8 },
  { key: "e", name: "Eli", role: "kitchen", hours: 4 },
  { key: "m", name: "Marco", role: "manager", hours: 10 },
];
const rules: Rules = {
  method: "hours_x_points",
  rolePoints: { server: 1, bartender: 1, busser: 0.5, manager: 1 },
  offTheTop: [{ role: "kitchen", percent: 10 }],
  excludedRoles: [],
};

describe("split", () => {
  const r = split(123457, rosas, rules);

  it("pays out every cent", () => {
    expect(sum(r.lines.map((l) => l.amountCents)) + r.unallocatedCents).toBe(123457);
  });
  it("keeps managers out even when the policy includes them", () => {
    expect(r.lines.find((l) => l.key === "m")!.amountCents).toBe(0);
    expect(r.flags.some((f) => f.code === "manager_in_pool" && f.severity === "error")).toBe(true);
  });
  it("takes kitchen off the top and splits by hours", () => {
    const k = r.lines.filter((l) => l.role === "kitchen").map((l) => l.amountCents);
    expect(sum(k)).toBe(12346);
    expect(k[0]).toBeGreaterThan(k[1]);
  });
  it("weights by hours x points", () => {
    const ana = r.lines.find((l) => l.key === "a")!;
    const cy = r.lines.find((l) => l.key === "c")!;
    // Ana 6h x1 = 6, Cy 5h x0.5 = 2.5
    expect(ana.amountCents / cy.amountCents).toBeCloseTo(6 / 2.5, 2);
  });
  it("keeps board order", () => {
    expect(r.lines.map((l) => l.key)).toEqual(["a", "b", "c", "d", "e", "m"]);
  });
  it("flags bad hours and unknown roles", () => {
    const x = split(1000, [{ key: "z", name: "Zed", role: "barback", hours: 0 }, { key: "y", name: "Yu", role: "runner", hours: 20, confidence: 0.4 }], { ...rules, offTheTop: [] });
    const codes = x.flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["bad_hours", "long_shift", "low_confidence", "unknown_role"]));
    expect(x.lines.find((l) => l.key === "y")!.amountCents).toBe(1000);
  });
  it("keeps the off-the-top share in the main pool when nobody holds that role", () => {
    const x = split(1000, rosas.filter((s) => s.role !== "kitchen"), rules);
    expect(sum(x.lines.map((l) => l.amountCents))).toBe(1000);
    expect(x.flags.some((f) => f.code === "empty_pool")).toBe(true);
  });
  it("reports unallocated when nobody is eligible", () => {
    const x = split(500, [rosas[5]], rules);
    expect(x.unallocatedCents).toBe(500);
  });
  it("rejects impossible percentages", () => {
    const x = split(500, rosas, { ...rules, offTheTop: [{ role: "kitchen", percent: 140 }] });
    expect(x.flags.some((f) => f.code === "bad_percent")).toBe(true);
    expect(sum(x.lines.map((l) => l.amountCents))).toBe(500);
  });
});

describe("canonicalRole", () => {
  it("maps board shorthand to policy roles", () => {
    expect(["line", "Dish", "prep cook", "BOH"].map(canonicalRole)).toEqual(["kitchen", "kitchen", "kitchen", "kitchen"]);
    expect(["bar", "MGR", "busboy", "Hostess", "svr"].map(canonicalRole)).toEqual(["bartender", "manager", "busser", "host", "server"]);
    expect(canonicalRole("sommelier")).toBe("sommelier");
  });
});
