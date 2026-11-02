import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { ConvexError } from "convex/values";
import { PayPalError } from "./paypal";
import { demoLimit, fail, fromClaude, fromPayPal, itemNote } from "./problems";

const pp = (status: number, body: object) => new PayPalError(status, body, `PayPal ${status}`);

describe("fromPayPal", () => {
  it("explains an empty sandbox balance and offers retry", () => {
    const p = fromPayPal(pp(422, { name: "INSUFFICIENT_FUNDS", debug_id: "abc" }), "payout");
    expect(p.kind).toBe("paypal_funds");
    expect(p.retry).toBe(true);
    expect(p.message).toMatch(/nobody was paid twice or half-paid/);
    expect(p.detail).toBe("PayPal 422 INSUFFICIENT_FUNDS, debug id abc");
  });
  it("treats bad keys as not retryable", () => {
    expect(fromPayPal(pp(401, { error: "invalid_client" }), "payout")).toMatchObject({ kind: "paypal_auth", retry: false });
  });
  it("treats 429 and 5xx as temporary", () => {
    expect(fromPayPal(pp(429, { name: "RATE_LIMIT_REACHED" }), "tip").retry).toBe(true);
    expect(fromPayPal(pp(503, {}), "topup").kind).toBe("paypal_down");
  });
  it("says a guest wasn't charged when a tip fails", () => {
    expect(fromPayPal(pp(500, {}), "tip").message).toMatch(/not charged/);
  });
  it("names the validation issue", () => {
    const p = fromPayPal(pp(400, { name: "VALIDATION_ERROR", details: [{ issue: "Recipient wallet not supported in sandbox." }] }), "payout");
    expect(p.message).toMatch(/Recipient wallet not supported in sandbox/);
  });
  it("frames a duplicate batch as the double-pay guard", () => {
    expect(fromPayPal(pp(400, { name: "DUPLICATE_REQUEST_ID" }), "payout").kind).toBe("paypal_duplicate");
  });
  it("handles timeouts", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(fromPayPal(e, "payout").kind).toBe("paypal_down");
  });
});

describe("fromClaude", () => {
  const api = (status: number, message: string) => Anthropic.APIError.generate(status, { error: { message } }, message, new Headers());
  it("spots a spend limit", () => {
    expect(fromClaude(api(400, "Your credit balance is too low to access the Anthropic API."), "board").kind).toBe("ai_budget");
  });
  it("spots a bad key", () => {
    expect(fromClaude(api(401, "invalid x-api-key"), "policy")).toMatchObject({ kind: "ai_auth", retry: false });
  });
  it("treats overload as temporary", () => {
    expect(fromClaude(api(529, "Overloaded"), "dispute")).toMatchObject({ kind: "ai_busy", retry: true });
  });
  it("passes our own demo caps through unchanged", () => {
    expect(fromClaude(fail(demoLimit()), "board").kind).toBe("demo_limit");
  });
  it("offers a manual fallback for an unreadable board", () => {
    expect(fromClaude(new Error("Couldn't read that photo."), "board").message).toMatch(/type the shifts in by hand/);
  });
  it("keeps ConvexError payloads intact", () => {
    const e = new ConvexError(demoLimit());
    expect(fromPayPal(e, "payout").kind).toBe("demo_limit");
  });
});

describe("itemNote", () => {
  it("explains an unclaimed payout", () => {
    expect(itemNote("UNCLAIMED", "RECEIVER_UNREGISTERED")).toMatch(/30 days/);
  });
});
