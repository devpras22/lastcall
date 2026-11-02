// Every failure outside the user's control becomes a Problem: what happened, in plain words,
// whether any money moved, and whether trying again can help. Shown to judges and managers as-is.
import { ConvexError, v, type Infer } from "convex/values";
import { PayPalError } from "./paypal";

export const problemV = v.object({
  kind: v.string(),
  title: v.string(),
  message: v.string(),
  detail: v.optional(v.string()), // technical line for the curious: service, status, code
  retry: v.boolean(),
});
export type Problem = Infer<typeof problemV>;

const P = (kind: string, title: string, message: string, retry: boolean, detail?: string): Problem => ({ kind, title, message, retry, detail });

/** Throw this from a function the browser calls; the UI turns it into the pop-up. */
export const fail = (p: Problem) => new ConvexError(p);

export const isProblem = (x: unknown): x is Problem =>
  !!x && typeof x === "object" && typeof (x as Problem).title === "string" && typeof (x as Problem).message === "string";

function status(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function isNetwork(e: unknown) {
  const name = (e as Error)?.name ?? "";
  const msg = (e as Error)?.message ?? "";
  return name === "AbortError" || name === "TimeoutError" || /APIConnection|fetch failed|network|timed? ?out|ECONN|socket/i.test(name + " " + msg);
}

/** PayPal REST failures. `moneyMoved` says whether this call could have moved money. */
export function fromPayPal(e: unknown, action: "payout" | "topup" | "tip" | "capture"): Problem {
  if (e instanceof ConvexError && isProblem(e.data)) return e.data;
  const what = action === "payout" ? "the team’s payouts" : action === "topup" ? "the top-up" : "the tip";
  const safe = action === "payout" || action === "topup" ? " PayPal held the whole batch, so nobody was paid twice or half-paid." : " Your card or PayPal balance was not charged.";
  if (e instanceof PayPalError) {
    const b = (e.body ?? {}) as { name?: string; error?: string; debug_id?: string; details?: { issue?: string; description?: string }[] };
    const code = b.name ?? b.error ?? "";
    const detail = `PayPal ${e.status}${code ? ` ${code}` : ""}${b.debug_id ? `, debug id ${b.debug_id}` : ""}`;
    if (code === "INSUFFICIENT_FUNDS")
      return P("paypal_funds", "The demo’s PayPal account is out of play money", `This demo pays real PayPal sandbox money, and the test business account has run low.${safe} The split itself is fine. Try again shortly, once the balance is topped up.`, true, detail);
    if (e.status === 401 || code === "invalid_client" || code === "AUTHENTICATION_FAILURE")
      return P("paypal_auth", "PayPal didn’t accept this app’s keys", `PayPal turned down the app’s sandbox credentials, so ${what} couldn’t be sent.${safe} This needs the app owner to update the keys; trying again won’t help.`, false, detail);
    if (e.status === 403 || code === "AUTHORIZATION_ERROR" || code === "NOT_AUTHORIZED")
      return P("paypal_forbidden", "PayPal hasn’t switched this feature on for the app", `PayPal says this app isn’t allowed to do that yet.${safe}`, false, detail);
    if (e.status === 429 || code === "RATE_LIMIT_REACHED")
      return P("paypal_busy", "PayPal asked us to slow down", `Too many requests reached PayPal at once.${safe} Wait a few seconds and try again.`, true, detail);
    if (e.status >= 500)
      return P("paypal_down", "PayPal’s sandbox didn’t answer properly", `PayPal had a problem on its side while handling ${what}.${safe} It usually clears up in a minute.`, true, detail);
    if (code === "DUPLICATE_REQUEST_ID" || code === "SENDER_BATCH_ID_ALREADY_USED")
      return P("paypal_duplicate", "PayPal already has this payout", "This night was already sent to PayPal once, and PayPal refused to send it twice. That’s the double-pay guard working.", false, detail);
    const issue = b.details?.[0]?.issue ?? b.details?.[0]?.description;
    return P("paypal_rejected", "PayPal turned this request down", `PayPal rejected ${what}${issue ? `: ${issue.replace(/\.$/, "")}` : ""}.${safe}`, false, detail);
  }
  if (isNetwork(e))
    return P("paypal_down", "Couldn’t reach PayPal", `The connection to PayPal timed out while sending ${what}.${safe} Try again in a moment.`, true, "network timeout");
  if (/keys are not set/i.test((e as Error)?.message ?? ""))
    return P("paypal_auth", "PayPal isn’t connected", "This copy of the app has no PayPal sandbox keys, so it can’t move money.", false);
  return P("unknown", "Something went wrong with PayPal", `${what[0].toUpperCase() + what.slice(1)} didn’t go through.${safe}`, true, (e as Error)?.message?.slice(0, 160));
}

/** Claude (Anthropic API) failures, plus our own demo spend caps. */
export function fromClaude(e: unknown, task: "board" | "policy" | "dispute"): Problem {
  if (e instanceof ConvexError && isProblem(e.data)) return e.data;
  const what = task === "board" ? "read the shift board" : task === "policy" ? "read the house rules" : "check this correction";
  const after = task === "board" ? " You can also type the shifts in by hand." : "";
  const s = status(e);
  const msg = (e as Error)?.message ?? "";
  const detail = s ? `Anthropic API ${s}` : undefined;
  if (/credit balance|billing|spend(ing)? limit|usage limit|quota/i.test(msg))
    return P("ai_budget", "The demo’s Claude budget is used up", `Claude couldn’t ${what} because this demo’s AI key has reached its spending limit. That limit is deliberate, so a demo can’t run up a bill.${after}`, false, detail);
  if (s === 401 || s === 403)
    return P("ai_auth", "Claude didn’t accept this app’s key", `The Anthropic key behind this demo was refused, so Claude couldn’t ${what}. Trying again won’t help until the app owner updates it.${after}`, false, detail);
  if (s === 429)
    return P("ai_busy", "Claude is getting too many requests", `Claude asked us to slow down before it could ${what}. Wait a few seconds and try again.`, true, detail);
  if (s === 529 || (s !== undefined && s >= 500))
    return P("ai_busy", "Claude is overloaded right now", `Anthropic’s servers were busy, so Claude couldn’t ${what}. This usually clears in under a minute.`, true, detail);
  if (isNetwork(e))
    return P("ai_busy", "Claude took too long to answer", `The request to ${what} timed out. Try again in a moment.`, true, "network timeout");
  if (task === "board")
    return P("ai_unreadable", "Claude couldn’t read that photo", `${msg || "The board didn’t come through clearly."} Try a straighter, closer shot with the whole board in frame, or type the shifts in by hand.`, true);
  if (task === "policy")
    return P("ai_unreadable", "Claude couldn’t make sense of those rules", "Try saying who gets what share, for example “servers 1 point an hour, bussers half, kitchen 10% off the top.”", true);
  return P("ai_unreadable", "Claude couldn’t check this one", "Your manager still has your note and can fix it by hand.", true);
}

export const demoLimit = () =>
  P("demo_limit", "This demo restaurant has used its Claude allowance", "Each demo copy gets a fixed number of Claude calls so the public demo can’t run up a bill. Start a fresh demo night from the home page to keep going.", false);

export const dailyLimit = () =>
  P("daily_limit", "The demo has reached today’s Claude limit", "There’s a daily cap on AI calls across all demo visitors, so the bill stays bounded. It resets at midnight UTC. Everything else, including payouts, still works.", false);

/** PayPal per-item payout errors (UNCLAIMED, RECEIVER_UNREGISTERED…) in a sentence for the ticket. */
export function itemNote(status: string, error?: string) {
  if (/RECEIVER_UNREGISTERED|UNCLAIMED/i.test(`${status} ${error ?? ""}`))
    return "No PayPal account at that address yet. PayPal holds the money for 30 days for them to claim, then returns it.";
  if (/RECEIVER_UNCONFIRMED/i.test(error ?? "")) return "Their PayPal account isn’t confirmed yet, so PayPal is holding the money.";
  if (/BLOCKED|RISK|DENIED/i.test(`${status} ${error ?? ""}`)) return "PayPal held this payout for a review on its side. Nothing was taken from anyone.";
  if (/RETURNED|REFUNDED|REVERSED/i.test(status)) return "PayPal sent this payout back to the restaurant.";
  return error;
}
