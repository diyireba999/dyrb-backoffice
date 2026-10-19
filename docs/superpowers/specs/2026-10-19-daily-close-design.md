# UX upgrade, slice C: daily close and tick-to-pay

Date: 2026-10-19. Status: approved in conversation.

## Why

Daily entry is the owner's most frequent job. Today it takes three uploads on two
screens (Bill Summary, Product Sales, Fiuu listing) with three Post buttons, and paying
suppliers means typing every amount. Slice C makes the daily close one drop and one
Post, and makes paying invoices a tick.

## Decisions already made

- One drop zone on the Upload screen accepts any mix of the three `.xlsx` exports at
  once; a review table stays; one Post button posts everything that adds up. Days that
  are posted immediately without review were rejected.
- The stand-alone Card settlement screen (`/sales/fiuu`) stays as it is, for one-off
  use; it shares the Fiuu load and post code with the daily close.
- Pay suppliers: a checkbox per invoice fills the full amount. Copy-last-invoice,
  remembered payees and keyboard line entry were not wanted.
- Nothing posts differently: the same RPCs (`post_sales_day`, `replace_sales_day`,
  `post_cogs_day`, `resplit_sales_day`, `post_fiuu_settlement`, `note_items`) with the
  same arguments, the same split tolerance (RM 0.05) and the same owner-only Replace.
- No new libraries. Slice A/B parts (toasts, header slot, pills) apply.

## File detection (`web/src/zeoniq.ts`)

`detectFile(input): 'bill' | 'items' | 'fiuu' | null`, pure, tested with Node asserts:

1. If the first row contains both `Settlement Date` and `Bill Amt` → `fiuu`.
2. Else find the row containing `Business Date`; none → `null`.
3. If any later row's second cell starts with `Item:` → `items` (Product Sales Listing).
4. Else if that header row contains `Net Total` → `bill` (Bill Summary Listing).
5. Else `null`.

Order matters: the Product Sales export also has a `Net Sales` column, so the `Item:`
rows decide before the Bill Summary test.

## Daily close (Upload screen, `/sales/upload`)

- **Drop zone**: one, `multiple`, click or drag-and-drop. Each dropped file is read,
  detected and loaded; a file of a kind already loaded replaces it. A file that fits
  nothing shows "`<name>`: not a Zeoniq Bill Summary, Product Sales or Fiuu listing"
  in the error box; other files in the same drop still load. Loaded files show as
  chips ("Bill Summary: file.xlsx ×"); × unloads that file and clears what came from
  it (days and ticks; items; payouts, takings and the POS comparison).
- **Days table**: as today (Date · Sales · Service charge · Tax · Rounding · Day total ·
  Payments · Split · Cost of sales · Replace (owner) · status). Rows are pre-ticked when
  not yet posted and adding up.
- **Card payouts**: shown when a Fiuu file is loaded. A "Money paid into" account
  picker (1000 / 1010 / 1100, default 1100), the pending/skipped note, and the payouts
  table as on the Card settlement screen (tick · paid into bank on · card payments ·
  customers paid · fee · rate · into bank · status, with the per-card-type rows).
- **One Post button**: label "Post 5 days", "Post 2 payouts" or "Post 5 days and 2
  payouts"; disabled when nothing is ticked. Order of work: for each ticked day, sales
  (or replace) then cost of sales, exactly as today; then each ticked payout. Every row
  shows its own result; failures are listed in the error box and remain un-posted, so
  Post can be pressed again for what is left.
- **Secondary buttons** (unchanged behaviour): "Post cost of sales · N days" and
  "Re-split N posted days" when they apply.
- **Check table**: the Fiuu-vs-POS comparison stays at the bottom when takings are
  loaded. The existing explanatory notes stay.

Shared with the Card settlement screen: `loadFiuuFile(rows)` (parse, posted flags,
takings, what the POS booked to 1200) and `postSettlements(rows, pick, bank)`, both
module-level functions in `web/src/pages/Sales.tsx`, plus a `FiuuCheck` component for
the comparison table.

## Tick invoices to pay (`/ap/payments`)

- A checkbox column before Doc No. Checked means `Pay now` holds an amount above zero.
  Ticking fills `Pay now` with the full outstanding (`owingOn(i)`); unticking clears it.
  Typing a different amount keeps the tick (part payment). "Pay all in full" ticks every
  row. Total, Save and the edit flow are unchanged.

## Testing

- `web/dashboard-test.mjs` (the Node assert runner that already imports `zeoniq.ts`):
  `detectFile` on synthetic row arrays for each kind, a Product Sales sheet that also has
  a `Net Total` column, a sheet with no `Business Date`, and the sheet-wrapper shape
  (`[{ data: rows }]`).
- `tsc`, `oxlint`, `build`; the owner runs a real daily close on the live site.

## Out of scope

Posting without review; auto-detecting which bank a payout went to; e-wallet (1210)
settlement; invoice line keyboard shortcuts; remembered payees.
