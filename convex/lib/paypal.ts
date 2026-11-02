// PayPal REST (sandbox) called directly. Runs inside Convex actions (fetch runtime).
// Every call: timeout, retry with backoff+jitter on 429/5xx/network only, idempotency header on writes.

const base = () => process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";

/** PayPal's sandbox rejects recipient_wallet VENMO; Venmo payouts only run against live. */
export const isSandbox = () => base().includes("sandbox");

export const paypalConfigured = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);

export class PayPalError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}, attempt = 0): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(base() + path, { ...init, signal: ctrl.signal });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(400 * 2 ** attempt + Math.random() * 300);
      return request(path, init, attempt + 1);
    }
    return res;
  } catch (e) {
    if (attempt < 3) {
      await sleep(400 * 2 ** attempt + Math.random() * 300);
      return request(path, init, attempt + 1);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error("PayPal sandbox keys are not set (PAYPAL_CLIENT_ID / PAYPAL_SECRET).");
  const res = await request("/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${id}:${secret}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await res.json();
  if (!res.ok) throw new PayPalError(res.status, body, `PayPal auth failed (${res.status})`);
  cached = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

async function call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = json?.details?.[0]?.issue ?? json?.details?.[0]?.description ?? json?.message ?? json?.name ?? res.statusText;
    console.error("paypal", method, path, res.status, JSON.stringify(json).slice(0, 800));
    throw new PayPalError(res.status, json, `PayPal ${res.status}: ${detail}`);
  }
  return json as T;
}

export const dollars = (cents: number) => (cents / 100).toFixed(2);

// ---- Orders v2: guest tips ----

export async function createTipOrder(opts: { cents: number; nightId: string; restaurant: string; requestId: string }) {
  return call<{ id: string; status: string }>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: dollars(opts.cents) },
          description: `Tip for the team at ${opts.restaurant}`.slice(0, 127),
          custom_id: opts.nightId,
          soft_descriptor: "LASTCALL TIP",
        },
      ],
      payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", brand_name: opts.restaurant.slice(0, 127) } } },
    },
    opts.requestId,
  );
}

type Capture = {
  id: string;
  status: string;
  payer?: { email_address?: string; name?: { given_name?: string } };
  purchase_units: { custom_id?: string; payments?: { captures?: { id: string; status: string; amount: { value: string } }[] } }[];
};

export async function captureOrder(orderId: string) {
  return call<Capture>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `cap-${orderId}`);
}

// ---- Payouts v1 ----

export type PayoutItem = {
  senderItemId: string;
  cents: number;
  wallet: "PAYPAL" | "VENMO";
  recipientType: "EMAIL" | "PHONE";
  receiver: string;
  note: string;
};

export async function createPayoutBatch(senderBatchId: string, subject: string, message: string, items: PayoutItem[]) {
  return call<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: { sender_batch_id: senderBatchId, email_subject: subject.slice(0, 255), email_message: message.slice(0, 1000) },
      items: items.map((i) => ({
        recipient_type: i.recipientType,
        recipient_wallet: isSandbox() ? "PAYPAL" : i.wallet,
        receiver: i.receiver,
        amount: { value: dollars(i.cents), currency: "USD" },
        note: i.note.slice(0, 4000),
        sender_item_id: i.senderItemId,
      })),
    },
    senderBatchId,
  );
}

export type BatchStatus = {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: { payout_item_id: string; transaction_status: string; payout_item: { sender_item_id: string }; errors?: { name?: string; message?: string } }[];
};

export async function getPayoutBatch(batchId: string) {
  return call<BatchStatus>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}?fields=batch_header,items&page_size=100`);
}

// ---- Webhooks ----

export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const res = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return res.verification_status === "SUCCESS";
}

/** PayPal transaction_status -> our status */
export function mapItemStatus(s: string): "pending" | "success" | "unclaimed" | "failed" {
  switch (s.toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "UNCLAIMED":
      return "unclaimed";
    case "FAILED":
    case "RETURNED":
    case "BLOCKED":
    case "REFUNDED":
    case "REVERSED":
    case "DENIED":
      return "failed";
    default:
      return "pending";
  }
}
