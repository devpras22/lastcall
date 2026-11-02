# Last Call — design

PayPal AI Hackathon (Devpost). Early check by **Thu 5 Nov 2026**, final by **Thu 12 Nov 2026 12:00 PT**.

## One line
Close out the night's tip pool from one photo and a sentence of house policy — every worker paid to PayPal or Venmo before they leave, with a receipt that explains their share.

## Who and why
Independent restaurants and bars (no Toast/Square tip-out add-on). Today the manager does napkin math at 1am and hands out cash or Venmos people one by one. Kickfin / TipHaus / 7shifts solve this only with a POS integration. Last Call needs no POS.

## Flow
1. **Guests tip through PayPal** on the restaurant's tip page (PayPal Checkout, Orders v2 capture). Each capture is recorded against tonight. Manager can also type in a cash/card total.
2. **Manager snaps the shift board** (whiteboard, printed schedule, handwriting). Claude vision extracts shifts: name, role, in/out, hours, confidence.
3. **House policy, plain English, once** ("Bartenders get 1 point, servers 1, bussers half. Kitchen gets 10% off the top. Managers out."). Claude turns it into structured rules; manager sees the rules back in plain words.
4. **Split preview.** Deterministic TypeScript does all the money math (largest-remainder, sums to the cent). Flags: manager in pool (FLSA §203(m)(2)(B)), name not on roster, missing payout handle, implausible hours, low-confidence reads.
5. **Approve & pay.** One PayPal Payouts batch (`sender_batch_id` = night id → can never double-pay). Recipients by PayPal email or Venmo phone.
6. **Payout wall.** Each worker card flips sending → paid as `PAYMENT.PAYOUTS-ITEM.*` webhooks arrive (signature verified, deduped by event id; status poll as fallback).
7. **Worker receipt** (`/r/:token`, phone). Amount, the why line by line. "Something's off" → dispute in plain words ("I stayed till close, 2am not 11"). Claude re-checks against the board read; if the claim is plausible it proposes a correction, manager approves, a **top-up payout** goes out and is noted on both receipts.
8. **Ledger.** AG Grid: every night × worker, flags, disputes, payout status.

## Stack
- **Vite + React + TypeScript + Tailwind** (SPA, same shape as Homeport), Vercel.
- **Convex**: tables, mutations, actions (PayPal + Claude), HTTP route for PayPal webhooks, file storage for board photos, scheduler for payout polling.
- **Claude Sonnet 5.5** (`claude-sonnet-5-5`) via Anthropic API, tool-use for structured output. Never does arithmetic. Daily call cap + per-IP rate limit (spend cap).
- **PayPal REST sandbox**, called directly: OAuth client-credentials, Orders v2 (tips), Payouts v1 (batch + item status), Webhooks verify-signature.
- **AG Grid Community** ledger (AG Grid sponsor prize).

## Data (Convex)
- `restaurants` — name, slug, policyText, rules, demo flag
- `workers` — restaurant, name, role, recipientType (EMAIL|PHONE), receiver, wallet (PAYPAL|VENMO)
- `tips` — restaurant, night, amountCents, paypalOrderId (unique), source
- `nights` — restaurant, date, status, tipsCents, boardStorageId, extraction, flags, senderBatchId, payoutBatchId
- `lines` — night, worker, role, hours, points, amountCents, explanation, receiptToken, payoutItemId, payoutStatus
- `disputes` — line, message, aiVerdict, proposedTopUpCents, status, topUpItemId
- `webhookEvents` — eventId (dedupe)
- `aiCalls` — day counter for the spend cap

## Demo for judges
Landing → "Close out a demo night" → fresh copy of **Rosa's Taqueria** (9 staff, a pre-shot shift-board photo, policy prefilled, sandbox tips). No sign-up. Real sandbox payouts. Demo nights reset; caps keep cost bounded.

## Look
"The night's receipt": warm off-white receipt paper, ink-black type, monospace tabular numbers, one amber "OPEN sign" accent, perforated edges. Manager screens phone-first; payout wall and ledger desktop. Bottom sheets draggable with a grab handle; SVG icons.

## Production basics
Timeouts on every outbound call; retries with backoff+jitter on 429/5xx only; idempotent payouts (`sender_batch_id`) and tip captures (order id unique); webhook signature verify + dedupe; AI rate limit + daily cap; input validation (image size/type, policy length, amounts); server recomputes every amount; errors logged with context.

## Out of scope (hackathon)
Real auth (demo restaurants are per-browser), POS imports, payroll tax reporting, non-US payouts.
