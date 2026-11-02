import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { problemV } from "./lib/problems";

export const rulesV = v.object({
  method: v.union(v.literal("hours"), v.literal("points"), v.literal("hours_x_points")),
  rolePoints: v.record(v.string(), v.number()),
  offTheTop: v.array(v.object({ role: v.string(), percent: v.number() })),
  excludedRoles: v.array(v.string()),
});

export const shiftV = v.object({
  key: v.string(),
  name: v.string(),
  role: v.string(),
  hours: v.number(),
  clockIn: v.optional(v.string()),
  clockOut: v.optional(v.string()),
  confidence: v.optional(v.number()),
  workerId: v.optional(v.id("workers")),
});

export const flagV = v.object({
  severity: v.union(v.literal("error"), v.literal("warn")),
  code: v.string(),
  key: v.optional(v.string()),
  message: v.string(),
});

export const payoutStatusV = v.union(
  v.literal("none"),
  v.literal("held"), // share is set aside until the worker adds payout details
  v.literal("pending"),
  v.literal("success"),
  v.literal("unclaimed"),
  v.literal("failed"),
);

export default defineSchema({
  restaurants: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerKey: v.string(), // capability token held by the manager's browser
    policyText: v.string(),
    rules: v.optional(rulesV),
    rulesSummary: v.optional(v.array(v.string())),
    policyProblem: v.optional(problemV),
    demo: v.boolean(),
    aiCalls: v.number(),
    joinToken: v.optional(v.string()), // the link staff use to add their own payout details
  })
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerKey"])
    .index("by_join", ["joinToken"]),

  workers: defineTable({
    restaurantId: v.id("restaurants"),
    name: v.string(),
    role: v.string(),
    // Payout details are optional: a name can come from the board or the manager first, and the worker adds them via the join link.
    wallet: v.optional(v.union(v.literal("PAYPAL"), v.literal("VENMO"))),
    recipientType: v.optional(v.union(v.literal("EMAIL"), v.literal("PHONE"))),
    receiver: v.optional(v.string()),
    addedBy: v.optional(v.union(v.literal("demo"), v.literal("manager"), v.literal("board"), v.literal("self"))),
  }).index("by_restaurant", ["restaurantId"]),

  nights: defineTable({
    restaurantId: v.id("restaurants"),
    date: v.string(), // YYYY-MM-DD, the service date
    status: v.union(
      v.literal("open"),
      v.literal("reading"),
      v.literal("review"),
      v.literal("paying"),
      v.literal("paid"),
    ),
    extraTipsCents: v.number(), // cash/card typed in by the manager
    boardStorageId: v.optional(v.id("_storage")),
    boardError: v.optional(v.string()), // legacy
    boardProblem: v.optional(problemV),
    shifts: v.array(shiftV),
    flags: v.array(flagV),
    senderBatchId: v.optional(v.string()),
    payoutBatchId: v.optional(v.string()),
    payoutError: v.optional(v.string()), // legacy
    payoutProblem: v.optional(problemV),
    simulated: v.optional(v.boolean()),
    paidAt: v.optional(v.number()),
  }).index("by_restaurant", ["restaurantId", "date"]),

  tips: defineTable({
    restaurantId: v.id("restaurants"),
    nightId: v.id("nights"),
    amountCents: v.number(),
    paypalOrderId: v.string(),
    payer: v.optional(v.string()),
    status: v.union(v.literal("created"), v.literal("captured")),
    simulated: v.optional(v.boolean()),
  })
    .index("by_night", ["nightId"])
    .index("by_order", ["paypalOrderId"]),

  lines: defineTable({
    nightId: v.id("nights"),
    restaurantId: v.id("restaurants"),
    key: v.string(),
    workerId: v.optional(v.id("workers")),
    name: v.string(),
    role: v.string(),
    hours: v.number(),
    points: v.number(),
    amountCents: v.number(),
    pool: v.string(),
    why: v.array(v.string()),
    receiptToken: v.string(),
    payoutItemId: v.optional(v.string()),
    payoutStatus: payoutStatusV,
    payoutNote: v.optional(v.string()),
  })
    .index("by_night", ["nightId"])
    .index("by_token", ["receiptToken"])
    .index("by_item", ["payoutItemId"])
    .index("by_worker", ["workerId"]),

  disputes: defineTable({
    lineId: v.id("lines"),
    nightId: v.id("nights"),
    restaurantId: v.id("restaurants"),
    message: v.string(),
    status: v.union(
      v.literal("checking"),
      v.literal("proposed"), // AI found it plausible; waiting for manager
      v.literal("declined"), // AI or manager said no
      v.literal("approved"),
      v.literal("paid"),
    ),
    verdict: v.optional(v.string()),
    claimedHours: v.optional(v.number()),
    topUpCents: v.optional(v.number()),
    topUpItemId: v.optional(v.string()),
    topUpBatchId: v.optional(v.string()),
    topUpStatus: v.optional(payoutStatusV),
    problem: v.optional(problemV),
  })
    .index("by_line", ["lineId"])
    .index("by_night", ["nightId"])
    .index("by_restaurant", ["restaurantId"]),

  webhookEvents: defineTable({ eventId: v.string(), type: v.string() }).index("by_event", ["eventId"]),

  usage: defineTable({ day: v.string(), aiCalls: v.number(), restaurants: v.optional(v.number()) }).index("by_day", ["day"]),
});
