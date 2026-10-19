# UX upgrade, slice B: Today dashboard and Month-end checklist

Date: 2026-10-19. Status: approved in conversation.

## Why

Slice A gave the app one look and a task-grouped menu. The owner's two remaining
pains in this area are "reading the numbers" and "month-end feels like separate chores
with no order". Slice B answers both on two screens: Today says whether the month is
making money and what is waiting; Month-end lists the close in order and says what is
done.

## Decisions already made

- One database function, `month_status(p_month date)`, computes every check for a month
  in one call. Two small tables hold the facts only the owner knows: `closed_days`
  and `month_closes`. One migration file, `supabase/032_month_status.sql`, safe to run
  again. The function is tested in `web/db-test.mjs`.
- The to-do list watches: sales days not uploaded, card takings not settled, payroll
  state, and last month's close steps. Bills due are shown on the Owed-to-suppliers
  tile, not in the to-do list.
- The Month-end checklist is the "full close": nine steps, two of them manual
  (supplier invoices entered, review P&L), and a "Close month" mark that does not lock
  posting.
- No new libraries. Everything else from the slice A spec (tokens, header slot, toasts,
  confirm dialog) applies.

## Data

### Tables

```sql
create table if not exists closed_days (
  day date primary key,                     -- the bar was shut; no sales expected
  created_at timestamptz not null default now()
);
create table if not exists month_closes (
  month date primary key,                   -- always the 1st
  invoices_entered boolean not null default false,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
```

Row security: office roles read and write both (`is_office()`), nobody else. The app
writes them directly (insert / delete on `closed_days`; upsert on `month_closes`).

### `month_status(p_month date) returns jsonb`

Security definer, `search_path = public, pg_temp`, raises `Not allowed` unless
`is_office()`. `first_day` = the 1st of `p_month`'s month, `last_day` = its last day,
`today` = `(now() at time zone 'Asia/Kuala_Lumpur')::date`.

| Key | Type | Meaning |
|---|---|---|
| `month` | `YYYY-MM-01` | echo of the month |
| `days_missing` | date[] | every day from `first_day` to `least(last_day, today - 1)` with no journal `source = 'sales'` whose `source_ref` is that date, and not in `closed_days`; empty when the month has not started |
| `days_closed` | date[] | `closed_days` rows inside the month |
| `card_unsettled` | number | net debit balance of account 1200 for journals dated on or before `least(last_day + 7, today - 3)`; 0 when negative or when that date is before `first_day` |
| `card_since` | date or null | earliest `source = 'sales'` journal date in the month with a debit to 1200, only when `card_unsettled > 0` |
| `timesheet_rows` | int | `timesheets` rows with `work_date` in the month |
| `active_staff` | int | `employees` with `active` true |
| `payroll` | `{ status, run_id }` | `status` is `none`, `draft`, `approved` (not paid) or `paid`, from `payroll_runs` where `month = first_day` |
| `accruals_posted` | bool | a journal with `source = 'accrual'` and `source_ref = first_day::text` exists |
| `stock_count_posted` | bool | a journal with `source = 'stock'` dated inside the month exists |
| `bank_uncleared` | int | `journal_lines` on account 1100 with `cleared_on is null` whose journal is dated on or before `last_day` |
| `invoices_entered` | bool | from `month_closes`, default false |
| `closed_at` | timestamptz or null | from `month_closes` |

The function reads only; it never writes.

## Pure logic (`web/src/dashboard-math.ts`)

`todoItems(statuses: MonthStatus[], today: string): TodoItem[]` turns one or more month
statuses (this month first, then last month) into the sentences on Today. `TodoItem` is
`{ key: string; text: string; to: string; action: string; days?: string[] }`. Rules, in
output order:

1. For each status with `days_missing` non-empty: text `Sales not uploaded: 16 Oct, 17 Oct`
   (dates as `D Mon`; more than four days reads `16 Oct, 17 Oct, 18 Oct and 5 more`),
   `to: '/sales/upload'`, `action: 'Upload'`, `days` = the dates (Today renders a
   "Closed that day" link per date).
2. For the first status (this month) when `card_unsettled > 0`: `Card takings RM 1,234.00
   waiting since 14 Oct`, `to: '/sales/fiuu'`, `action: 'Settle'`. Without `card_since`
   the sentence stops at the amount.
3. For each status: payroll `draft` → `October payroll is a draft`, `to: '/payroll/run'`,
   `action: 'Open'`; `approved` → `October payroll approved, not paid`, `action: 'Pay'`.
   Only when the month has started (`first_day <= today`).
4. For the second status (last month) when `closed_at` is null: the unfinished steps
   among accruals, stock count, bank (`bank_uncleared > 0`), payroll (`none`), listed as
   `September not closed: accruals, stock count, bank`, `to: '/month-end'`,
   `action: 'Month-end'`. Omitted when every one of those is done.

Month names come from the status month with `toLocaleDateString('en-MY', { month:
'long' })`.

`monthStatus(month: 'YYYY-MM-01')` in `web/src/lib.ts` calls the RPC and throws on error,
like `accountTotals`.

## Today (owner, manager, accountant)

Layout, top to bottom:

1. Quick buttons as now.
2. Four tiles (five when a claim is open):
   - **Profit this month** — `income − cost of sales − running costs` for the month to
     month end (the figure already shown as "Profit so far"); note "+12% vs last month"
     using the same-day-cut last-month map, or "no figure to compare". Red when negative.
   - **Cash** — bank + drawer + petty cash; note "RM 4,120 bills due this week" (due
     soon + overdue from `supplierDue`) when non-zero, else "Bank + cash on hand".
   - **Owed to suppliers** — as now.
   - **Owed to director** — as now.
   - **Claims to settle** — only when `openClaims.length > 0`.
   Bank balance and cash on hand are no longer separate tiles; the Cash tile shows the
   split in its note when there are no bills due ("Bank RM 28,100 · Cash RM 3,100").
3. **To do** card: `todoItems` over `[thisMonth, lastMonth]`. Each item is one row:
   text on the left, a `link` button on the right (`action`), and for sales rows a
   second line of small "Closed that day" buttons, one per date; pressing one inserts
   into `closed_days` and refreshes. States: "Checking…" while loading, the error text
   when the RPC fails, "Nothing waiting. Up to date." when empty.
4. Sales band, then the month card, unchanged.

Investors and staff keep their current views; the to-do card and the new tiles are
office-only because `month_status` and `supplierDue` are.

## Month-end screen

Route `/month-end`, `PAGES` entry first in the Month-end group: label `Checklist`,
subtitle `Close the month, step by step`, icon `ListChecks`, roles OFFICE. Header actions:
**Close month** (primary, enabled when steps 1–8 are done and the month is not closed) or
**Reopen** (light) when closed.

Body:

- Month picker (`MonthInput`), default: last month if its `closed_at` is null, else this
  month.
- Closed banner when `closed_at` is set: "Closed on 3 Nov 2026".
- Nine rows in a card. Each row: status mark (✓ green done, ○ grey not done, – "not
  needed"), step name, one line of detail, link on the right.

| # | Step | Done when | Detail | Link |
|---|---|---|---|---|
| 1 | Sales uploaded | `days_missing` empty | "All days in" / "Missing 16 Oct, 17 Oct" with a "Closed that day" button per date; closed days listed with "Undo" | Upload |
| 2 | Card settled | `card_unsettled = 0` | "Nothing waiting" / "RM 1,234.00 since 14 Oct" | Settle |
| 3 | Supplier invoices entered | `invoices_entered` | checkbox "All bills for the month are in" (writes `month_closes`) | Invoices |
| 4 | Timesheet | `timesheet_rows > 0`; "–" when `active_staff = 0` | "42 days entered for 3 staff" | Timesheet |
| 5 | Payroll | `paid`; `approved` shows ○ "Approved, not paid"; `draft` ○ "Draft"; `none` ○ "Not started"; "–" when `active_staff = 0` | as listed | Payroll |
| 6 | Accruals | `accruals_posted` | "Posted" / "Not posted" | Accruals |
| 7 | Stock count | `stock_count_posted` | "Posted" / "No count this month" | Stock count |
| 8 | Bank reconciled | `bank_uncleared = 0` | "All ticked" / "7 lines not ticked" | Bank rec |
| 9 | Review P&L | always open (○ never blocks closing) | "Open the statement for the month" | P&L for that month (`/reports/pl`) |

"Close month" upserts `closed_at = now()`; Reopen sets it null. Both toast. The close is a
mark only; posting into a closed month still works and nothing warns, which the screen
says in one muted line under the list.

## Testing

- `web/db-test.mjs`, new section after 031: run 032 twice; build a month (two sales days
  with a gap, one closed day, a draft payroll, one uncleared 1100 line); assert
  `days_missing`, `days_closed`, `payroll.status`, `bank_uncleared`, `accruals_posted`
  false then true after `post_accruals`, `invoices_entered` after an upsert, and that a
  staff login gets `Not allowed`.
- `web/dashboard-test.mjs`: `todoItems` cases: gap days (four or fewer, more than four),
  card unsettled with and without a date, draft and approved payroll, last month not
  closed with two steps open, everything done gives an empty list.
- `tsc`, `oxlint`, `build` on every step; the owner checks Today and Month-end on the live
  site after the push and after running 032.

## Out of scope

Locking posting into a closed month; e-wallet (1210) settlement checks; the daily close
upload flow (slice C); report layout (slice D).
