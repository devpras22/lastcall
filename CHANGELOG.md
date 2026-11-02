# Changelog

## Unreleased

- Guest-tip QR on the close-out screen (PayPal Checkout straight into tonight's pool).
- Phone: sticky pay bar on the close-out that jumps to the split.
- Video script in `docs/video-script.md`.
- Live at lastcall-tips.vercel.app (Convex production + Vercel, git-linked).
- Retry payout button and a plain message when the sandbox account runs out of play money.
- Error pop-ups everywhere a service can fail: every PayPal and Claude failure is sorted into a plain-language problem (out of play money, bad keys, rate limits, outages, rejected requests, spend limits, unreadable photos, demo caps), saved on the record, and shown in a dialog that says whether money moved, with Try again where it helps. Crashed screens show a recovery page. Tested with real 401s from PayPal and Anthropic.
- Retry actions for the board read, house rules, payouts and top-ups; type shifts in by hand when there's no photo.

## 0.2.0 (2026-11-02)

- Real PayPal sandbox payouts verified end to end (9 of 9 paid, webhooks verified). Sandbox rejects the Venmo wallet, so Venmo items go to the PayPal wallet in sandbox, with a note on screen.
- Real Claude reads of the board, the policy and disputes; board flags trimmed to what a manager must check.
- README rewrite with screenshots, share image (`public/og.png`), Open Graph and Twitter meta.
- Fixes: simulated payouts now schedule reliably, receipt fits phone width, the dispute sheet keeps focus while typing.

## 0.1.0 (2026-11-02)

- First build: manager close-out (tips, shift-board photo, house rules, split preview), payout wall, worker receipt with corrections, AG Grid ledger, guest tip page.
- Split engine in integer cents with tests; managers kept out of the pool (FLSA).
- PayPal REST: Orders v2 for guest tips, Payouts v1 batches and top-ups, webhook verification and dedupe, polling fallback.
- Claude Sonnet 5.5 with structured outputs reads the board, the policy and worker disputes; AI calls capped per restaurant and per day.
- Runs end to end without keys: canned board read and simulated payouts, labelled on screen.
