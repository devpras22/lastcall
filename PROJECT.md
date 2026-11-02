# Project map

- `convex/` backend
  - `schema.ts` tables: restaurants, workers, nights, tips, lines, disputes, webhookEvents, usage
  - `lib/split.ts` the tip-pool math (pure, integer cents) and `split.test.ts`
  - `lib/paypal.ts` PayPal REST client (OAuth, Orders v2, Payouts v1, webhook verify)
  - `lib/ai.ts` Claude calls (board photo, house rules, disputes)
  - `lib/problems.ts` turns PayPal/Claude/demo-cap failures into plain-language problems for the error pop-up (tested in `problems.test.ts`)
  - `lib/demo.ts` Rosa's Taqueria seed; `lib/preview.ts` split preview + roster matching; `lib/access.ts` owner-key access
  - `restaurants.ts`, `nights.ts`, `disputes.ts`, `tips.ts`, `ledger.ts` public functions
  - `ai.ts`, `payouts.ts` actions; `http.ts` PayPal webhook route
- `src/` frontend (Vite + React)
  - `screens/` Landing, CloseOut, Wall, Receipt, Ledger, Tip
  - `ui/` Ticket, Sheet (draggable bottom sheet), Problem (error pop-up + crash boundary), icons
  - `app.css` + `tokens.css` + `base.css` design system (Hallmark custom theme)
- `public/demo/rosas-board.jpg` sample shift board; `public/og.png` share image
- `docs/design.md` product design; `docs/screens/` README screenshots
