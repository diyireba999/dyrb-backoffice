# Dashboard rebuild, document history & edit, payroll advance & timesheet

Date: 2026-09-26
Status: approved for planning

## Background

Three gaps came out of daily use of the back office:

1. The dashboard shows balances but not timing, trend, or whether the month is going well.
2. A posted document cannot be found again or corrected. Journals are immutable by design — `post_journal` and `delete_journal` are the only write paths, and `journal_lines` has `insert, update, delete` revoked from `authenticated`. The only correction available today is delete-and-retype, and only for some document types.
3. Payroll has no salary advance and no attendance. `payslips.hours` and `payslips.ot_hours` are typed in by hand each month with nothing feeding them, and advances are informally hidden inside `other_deduction` with no record of the balance owed.

A fourth item — general UX simplification — is deliberately out of scope for this spec. Part 2 addresses the largest single cause of it.

## Hard constraint: existing data

Live data has been entered through 23 September 2026 and must survive untouched.

- All schema changes are additive migrations: `018_docedit.sql`, `019_advance.sql`, `020_timesheet.sql`.
- New tables, and `alter table ... add column if not exists` only.
- No `drop table`, no `drop column`, no backfill that rewrites existing rows.
- Every document already posted must open in the new history screens without modification.

## Part 1 — Dashboard

### What it shows

Three bands. The existing "Recent documents" band is removed: Part 2 provides real history screens, making a six-row teaser redundant.

**Band 1 — Money now.** Five tiles, extending the current set with timing:

| Tile | Source |
|---|---|
| Bank balance | account 1100 |
| Cash on hand | 1000 + 1010 |
| Owed to suppliers | 2000, with a sub-line "RM X due within 7 days · RM Y overdue" from `purchase_invoices.due_date` against unpaid balance |
| Claims to settle | `claims` where status in (pending, approved) |
| Owed to director | accounts 2500–2599 (`isDirector`) |

**Band 2 — Sales.** Weekday-matched comparisons, because bar trade varies strongly by day of week and a plain day-on-day figure misleads:

- Yesterday vs the same weekday last week
- Week-to-date vs last week at the same point in the week
- Month-to-date vs last month at the same day-of-month

Below them, a 42-day bar strip of daily sales with the break-even line drawn across it.

**Band 3 — Profit & cost health.**

- Gross margin % this month, and the change against last month
- Margin split three ways — food, beverage, liquor — pairing income 4000/4010/4020 with cost 5000/5010/5020
- Top six running costs (6000–6999) this month, each with a month-on-month arrow

### Break-even calculation

Derived from the ledger. There is no target to set and nothing to maintain.

```
F = trailing 3-month average of accounts 6000–6999, excluding 6200 (card fees)
v = (accounts 5000–5099 + account 6200) ÷ total sales, over the same 3 months
break-even monthly sales = F ÷ (1 − v)
break-even daily sales   = that ÷ days in the current month
```

Account 6200 (card and e-wallet fees) is treated as variable because it scales with takings; everything else in the 6000 range is treated as fixed. Monthly accruals (migration 013) mean rent and utilities land in the right month, so the fixed figure is meaningful.

Displayed as: *"Break even at RM 4,180/day. Averaging RM 4,720/day this month."*

Guard conditions — the band hides itself with a short explanation when:

- fewer than two complete calendar months of data exist, or
- `v >= 1` (variable costs at or above sales, making break-even undefined), or
- trailing sales are zero.

### Implementation notes

No new tables and no new RPCs. Every figure comes from `accountTotals(from, to)` over date ranges, plus one query against `purchase_invoices` for the due/overdue split. Chart components live alongside the existing `charts.tsx`.

## Part 2 — Document history and edit

### Screen shape

Each posting screen gains two modes, reusing the `list ↔ new` pattern that `PurchaseInvoices` in `web/src/pages/Purchase.tsx` already uses. No new pattern is introduced.

**History is the default mode.** Selecting "Payment Voucher" lands on the list of payment vouchers, newest first, with a "New" button. Default range is the last three months. Search filters by document number, description/payee, or amount.

Clicking a row opens a read-only document view with **Edit**, **Delete** and **Print** actions, subject to the permission rules already in `delete_journal`.

A shared `DocumentList` component is factored out and used by all of these screens, so the behaviour is identical everywhere and the logic lives in one file.

### Edit semantics by document type

The user decision is edit-in-place with no audit history table. What "edit" means differs by type, and the difference is load-bearing.

**Directly editable — PV, OR, TR, JV.** A new `update_journal` RPC:

```
update_journal(p_id, p_date, p_description, p_ref, p_attachment, p_lines)
```

- `security definer`, mirroring `post_journal`'s permission checks
- rejects any source not in the editable set
- rejects sources `pi` and `sp` (they have their own RPCs below)
- deletes and re-inserts `journal_lines`, updates the `journals` row
- keeps the same `journals.id` and therefore the same `doc_no`
- the existing deferred `journal_balanced` constraint trigger still enforces debits = credits, so an unbalanced edit cannot commit
- applies the same guards `post_journal` has: at least two lines, no inactive account, account 2000 requires a supplier

**Purchase Invoice.** `update_purchase_invoice` updates the journal and the `purchase_invoices` row in one transaction. Permitted only while the invoice is unpaid — the same condition `cancel_purchase_invoice` already enforces and the UI already checks (`Number(r.paid) === 0`).

**Supplier Payment.** `update_supplier_payment` re-posts the journal and updates the `supplier_payments` row. Supplier balances are computed from the ledger by the `supplier_balances` view, so they correct themselves.

**Daily sales — "Replace this day".** Today a day that has been posted cannot be posted again; `UploadSales` marks it and skips it. A new `replace_sales_day` RPC wraps, in one transaction, the delete of the existing day's journal (and its linked `cogs` entry, as `delete_journal` already does) and the posting of the replacement. Surfaced as a single "Replace this day" action on the upload screen. Permission matches `delete_journal` for source `sales` — owner only — so the action is hidden for manager and accountant.

**Generated documents — payroll, claims, card settlement, stock count, accruals.** "Edit" opens the source record on its own screen; the journal is re-posted from it. The journal lines are never hand-edited.

This is deliberate. A payroll journal edited directly would leave `payslips` and the ledger disagreeing, and the discrepancy would surface at EA-form time when it is expensive to unpick. Editing the payslip and re-posting reaches the same result with the two kept in step.

### Change stamp

Two columns on `journals`, added with `add column if not exists`:

- `updated_at timestamptz`
- `updated_by uuid references profiles`

Set by `update_journal` and its siblings. The document view shows "changed by Aden, 24/9 3:14pm" when present. This is a last-touched stamp, not a version history — no prior values are retained, per the decision taken.

## Part 3 — Payroll: salary advance and timesheet

### 3a. Salary advance

**Account.** `1310 Staff Advances`, type asset, inserted with `on conflict (code) do nothing`. Placed beside `1300 Deposits Paid`; `1400` is already Food Stock.

**Table.**

```sql
create table staff_advances (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees,
  date date not null,
  amount numeric(12,2) not null check (amount > 0),
  journal_id bigint not null references journals,
  note text,
  created_at timestamptz not null default now()
);
```

Row-level security matching `employees`: office reads all, staff read their own; owner and accountant write.

**Screen.** "Staff Advance" under the Payroll group, list + new, same pattern as everywhere else. Recording an advance posts `Dr 1310 / Cr <money account>` through `post_journal` with source `advance`, so the cash actually leaves the books at the time it leaves the till.

**Recovery.** A new `payslips.advance_recovery numeric(12,2) not null default 0` column. `payslip_view`'s `net_pay` expression is extended to subtract it.

When a payroll run is built, every advance for that employee that is not yet fully recovered and dated on or before the run's month-end is pulled in and deducted **in full**. The payslip shows a "Salary advance recovered" line.

**Over-recovery guard.** If outstanding advances exceed that month's net pay, deducting in full would drive net pay negative. Recovery therefore caps at the month's net pay, and the remainder is carried into the next run automatically. No repayment schedule is entered anywhere; recovery simply completes when the balance reaches zero. The run screen shows a note on any payslip where a cap was applied.

Recovery is tracked by amount rather than a boolean flag, so partial recovery is representable:

```sql
alter table staff_advances add column if not exists recovered numeric(12,2) not null default 0;
```

An advance is outstanding while `recovered < amount`. Approving a run increments `recovered` and posts the credit to 1310 in the payroll journal.

**Staff visibility.** Outstanding advance balance appears on the staff member's own payslip view, so they can see what remains.

### 3b. Timesheet

**Table.**

```sql
create table timesheets (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees,
  work_date date not null,
  hours numeric(5,2) not null default 0,
  ot_hours numeric(5,2) not null default 0,
  note text,
  unique (employee_id, work_date)
);
```

Office reads and writes; staff read their own.

**Screen.** "Timesheet" under the Payroll group. Month picker; a grid with staff down the side and days of the month across the top. Hours typed per cell, saved on blur. Hourly staff are shown by default; a toggle adds monthly staff so their OT can be logged. A right-hand column totals each person's hours and OT for the month.

This is a timesheet, not attendance capture — nobody clocks in. It replaces the current step of typing a single total-hours figure into each payslip.

**Feeding payroll.** The payroll run's "Work out pay" step reads each employee's monthly totals from `timesheets` into `payslips.hours` and `payslips.ot_hours`. Both remain editable by hand before the run is approved, so a wrong or missing timesheet entry never blocks the run.

**Overtime rate.** OT is paid at `payroll_rates.ot_normal` (1.5×) against the hourly rate. `ot_rest_day` (2×) and `ot_public_holiday` (3×) exist in the rates table but require a public-holiday calendar to apply automatically; that calendar is not built here. Those cases are handled by overriding `ot_amount` on the payslip.

## Testing

Extending the existing `web/db-test.mjs` harness rather than adding a framework:

- `update_journal` keeps the entry balanced, and an unbalanced edit is rejected
- `update_journal` preserves `doc_no` and `journals.id`
- `update_journal` refuses sources outside the editable set
- `update_purchase_invoice` is refused once a payment exists against the invoice
- `replace_sales_day` leaves exactly one sales journal and one cogs journal for the day
- advance recovery caps at net pay, and the remainder carries to the following run
- an advance is not recovered twice across two runs
- timesheet totals arrive in `payslips.hours` and `ot_hours`, and a hand override survives
- RLS: a staff-role user can read their own advance and timesheet rows and no one else's (extends `rls-test.mjs`)

## Implementation order

Three independent parts, each with its own migration and its own plan. Suggested order:

1. **Part 2** — document history and edit. Largest daily benefit, and it establishes the shared `DocumentList` component the other screens reuse.
2. **Part 3** — payroll advance and timesheet.
3. **Part 1** — dashboard. Pure read layer, no schema change, so it is unaffected by the order and is the safest to land last.

## Out of scope

- Audit history of prior document versions (decided against; a last-touched stamp only)
- Clock-in/clock-out attendance, PIN devices, staff phone check-in, shift rostering
- Manual monthly sales targets (break-even is derived instead)
- A public-holiday calendar and automatic rest-day/holiday OT multipliers
- Repayment schedules or instalment plans for advances
- General UX simplification as a separate workstream
- Period locking of closed months
