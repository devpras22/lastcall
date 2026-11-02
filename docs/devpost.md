# Devpost submission: Last Call

Copy each block into the matching Devpost field.

---

## Project name (max 60)
Last Call: Tip Pools Paid by PayPal Before Close

## Elevator pitch (max 200 characters)
Snap the shift board and everyone’s tips land in PayPal before they clock out. Claude reads the hours. Code does the math. No napkins, no cash, no POS.

## Try it out (links)
- https://lastcall-tips.vercel.app
- https://github.com/devpras22/lastcall

## Video
`<YouTube link: add after recording>`

## Built with (tags)
paypal, paypal-payouts, paypal-orders-api, paypal-webhooks, paypal-js-sdk, claude, anthropic, convex, react, typescript, vite, vercel, ag-grid

## Image gallery (upload in this order)
1. `public/og.png` (cover)
2. `docs/screens/closeout.png`
3. `docs/screens/wall-paid.png`
4. `docs/screens/dispute-reply.png`
5. `docs/screens/receipt.png`
6. `docs/screens/ledger.png`

---

## About the project (paste into the story field)

### Inspiration
It's 1:30am. The last table just left. In most independent restaurants, the manager now splits the night's tips by hand: who worked how long, who gets a full share and who gets half, how much goes to the kitchen. Then they hand out cash, or send nine separate Venmos.

Nobody can check that math, and the law has traps. Under the US Fair Labor Standards Act, managers and supervisors can't keep any part of the tip pool, and the rule gets broken by accident. Existing tip-out tools only work if you run a supported POS. Most small places don't.

We wanted closing out to take one photo and one tap, with everyone paid through PayPal before they walk out the door.

### What it does
**Last Call closes out a restaurant's tip pool and pays the whole team through PayPal the same night.**

1. **Tips come in through PayPal.** Guests scan a QR code and tip with PayPal Checkout; the money lands in tonight's pool live. The manager adds card and cash tips from the terminal report.
2. **Snap the shift board.** Whiteboard, printout or sign-in sheet. Claude reads every name, role and in/out time, matches names to the staff list, and flags only what the manager should double-check, like a smudged clock-out.
3. **House rules in plain English, once.** *"Bussers get half a point. Kitchen gets 10% off the top."* Claude turns that into structured rules, reads them back, and lists anything it found unclear.
4. **The split runs in code, never in the model.** Integer cents with largest-remainder rounding, so the shares always add up to the cent. If the policy includes a manager, Last Call keeps them out of the pool and says why.
5. **Approve and pay.** One **PayPal Payouts** batch pays everyone to their PayPal email or Venmo phone. The payout wall flips each ticket to "paid" as PayPal confirms each payout (verified webhooks, with status polling as a backup).
6. **A receipt for every worker.** Each person gets a link with their share worked out line by line. If something's off (*"I stayed till 1am"*), Claude checks the claim against the board photo. If it's plausible, the manager approves and a **top-up payout** goes out.
7. **A ledger** of every night and every share, in AG Grid.
8. **Your own restaurant, in two minutes.** Name, house rules, staff. Workers add their own PayPal email or Venmo number from a staff link or QR code on their phone, so the manager never types anyone's details. Anyone who isn't set up yet has their share held, not lost, and paid in a follow-up PayPal batch once they add it.

The demo needs no sign-up. Close out a sample taqueria's night in one click, or set up your own restaurant and staff. Real PayPal sandbox money moves either way.

### How we built it
- **PayPal REST API, called directly:**
  - **Payouts v1**: one batch for the night, follow-up batches for held shares, and single-item top-ups;
  - **Orders v2** with the **JS SDK** buttons: guest tips;
  - **Webhooks**: `PAYMENT.PAYOUTS-ITEM.*` events, each verified with PayPal's verify-webhook-signature and deduplicated by event id;
  - **OAuth 2.0** client credentials.

  PayPal's Agent Toolkit doesn't cover Payouts, so we called the REST API directly.
- **Claude Sonnet 5.5** through the Anthropic SDK with **structured outputs**, for three jobs:
  - reading the board photo (vision);
  - turning the house rules into a rules object;
  - checking a worker's dispute against the photo.

  Claude never decides a dollar amount.
- **Convex** for the database, server functions, file storage for photos, scheduled jobs, and the webhook endpoint. Its live queries make the payout wall update the moment a webhook lands.
- **React + TypeScript** on Vite, hosted on **Vercel**.
- **AG Grid** for the ledger.

**Built to handle real money:**
- **No double-pays.** The Payouts `sender_batch_id` is the night's id and each top-up's is the dispute's id, so a retry or a double tap can never pay twice. Guest tips are deduplicated by order id.
- **The server recomputes every amount** at approval and never trusts the browser.
- **Timeouts on every outbound call**, with retries plus backoff on 429/5xx only.
- **AI spend caps** per restaurant and per day.
- **Every failure gets a plain-language pop-up.** PayPal out of funds, bad keys, rate limits, outages, a Claude spend limit, an unreadable photo: each one says whether money moved, with **Try again** where it helps.
- **26 unit tests** cover the split engine and the error classifier.

### Challenges we ran into
- **Venmo payouts don't exist in PayPal's sandbox.** The sandbox rejects `recipient_wallet: VENMO`. In sandbox, Venmo workers are paid to their PayPal wallet with an on-screen note; against the live API the same code sends Venmo.
- **The sandbox's play money ran out** after our own test runs. That pushed us to build the error pop-ups and a safe "Retry payout" that can't double-pay.
- **PayPal's hosted sandbox MCP server was down** during the build, which settled it: direct REST calls.
- **Reading handwriting honestly.** The first prompt flagged every row ("board says 'bar', roster says bartender"). We tightened it so Claude stays quiet about routine clean-up and only raises what a manager must check.
- **Keeping the model away from money** while still letting it judge a dispute. Claude says whether a claim is plausible and how many hours were claimed; the code works out the top-up, and a human approves it.

### Accomplishments that we're proud of
- A full close-out runs end to end on real PayPal sandbox money: one photo of the board, and nine workers paid in a single Payouts batch, each payout confirmed back from PayPal.
- The legal check is code, not a prompt. A manager or supervisor on the board is kept out of the pool, whatever the policy text says.
- Every share adds up to the exact cent, and every worker can see why they got what they got.
- Failures explain themselves. We tested them with real rejections from both PayPal and Anthropic.

### What we learned
- The best split of work between AI and code is "AI reads, code counts". Claude is great at messy input (handwriting, plain-English policy, a worker's complaint); deterministic code is what you want touching money.
- Payouts plus webhooks is a fantastic primitive for paying many people at once, and idempotency keys matter more than any other line of code.
- A demo that handles failure well is more convincing than one that only shows the happy path.

### What's next for Last Call
- Live PayPal and real Venmo payouts for a first pilot restaurant.
- Shift data straight from scheduling apps when a restaurant has one, with the photo as the fallback.
- Worker sign-up by text message, so staff add their own PayPal or Venmo.
- State-specific tip-pool rules beyond the federal manager rule.
