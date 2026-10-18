# UX upgrade, slice A: shell and design system

Date: 2026-10-18. Status: approved in conversation, awaiting written review.

## Why

The owner runs the whole back office alone, mostly on a laptop, with a phone to
check figures. The review on 2026-10-18 found four kinds of friction: finding
screens, daily entry, month-end, and reading the numbers. The upgrade is split
into four slices so the live site improves at each step:

- **A. Shell and design system** (this spec)
- B. Today dashboard and Month-end checklist
- C. Daily entry flows (one-drop daily close, faster invoices and payments)
- D. Reports and print

Slice A gives every later slice one look and one set of parts to build on. It
changes markup and navigation only. No posting function, query, SQL file or
route changes.

## Decisions already made

- Left rail grouped by task (option A of three shown), compact density
  (13px text, 32px rows), light theme only, DYRB orange kept but used only
  for actions.
- No new libraries. React, Tailwind v4, lucide icons and the current Supabase
  SQL stay.
- Native `<select>` stays for accounts and suppliers (type-to-jump is built
  in); no custom picker.

## Tokens

All colour, type and spacing live in `web/src/index.css` under `@theme` and the
`@layer base` / `@layer components` blocks. Screens never set a colour or a font
size directly except through these classes.

Colour

| Use | Value |
|---|---|
| Brand (primary button, active nav, focus ring, links) | `#e0481c`, hover `#b8370f`, soft `#fff1ec` |
| Page background | `#f8f9fb` |
| Surfaces (cards, rail, header) | white, border `slate-200` |
| Text | `slate-900` body, `slate-600` secondary, `slate-400` hints |
| Danger (errors, overdue, delete) | `red-600` text on `red-50` |
| Warning (due soon, unsaved, not split) | `amber-700` on `amber-50` |
| Success (paid, posted, reconciled) | `green-700` on `green-50` |

Orange appears nowhere else: not on icons, headings, borders or table rows.

Type: Inter. Body and tables 13px. Page title 18px semibold, section title
15px semibold, labels 12px medium, hints and pills 11px. Every number is
`tabular-nums` and right-aligned in tables. Document numbers are monospace.

Spacing and shape: 4px grid. Inputs, selects and buttons are 32px tall. Table
rows are 32px (padding 7px 10px). Cards: radius 8px, border `slate-200`, one soft
shadow. Inputs: radius 6px. Page padding 16px on phone, 24px on laptop. Content
max width 1280px.

## Shell

### Rail (laptop, 1024px and wider)

232px wide, fixed left, white, border right. From top:

1. Logo and name.
2. Search button (opens the existing Ctrl K dialog).
3. **+ New** button: Payment, Receipt, Transfer, Invoice, Journal.
4. Groups. A group heading is 11px uppercase `slate-400`. An item is one
   row, 32px, icon plus label; the active item is `#fff1ec` background with
   orange text and icon.
5. Bottom: name, role, change-password and sign-out icons, as now.

Groups and items, with the URL each item keeps:

| Group | Item | URL | Section tabs on the page |
|---|---|---|---|
| Today | Today | `/` | — |
| Money in | Sales upload | `/sales/upload` | Sales: Upload · Card settlement |
| | Card settlement | `/sales/fiuu` | (same section) |
| | Official receipt | `/cash/receipt` | — |
| | Transfer | `/cash/transfer` | — |
| Money out | Purchases | `/ap/invoices` | Purchases: Invoices · Pay suppliers · Suppliers · Aging |
| | Payment voucher | `/cash/payment` | — |
| | Claims | `/claims` | — |
| Month-end | Timesheet | `/payroll/timesheet` | Payroll: Timesheet · Advances · Monthly run · Yearly summary |
| | Payroll | `/payroll/run` | (same section) |
| | Accruals | `/gl/accruals` | — |
| | Stock count | `/stock/count` | — |
| | Bank reconciliation | `/cash/bank-rec` | — |
| Books | Documents | `/gl/listing` | — |
| | Journal entry | `/gl/journal` | — |
| | Ledger | `/gl/ledger` | Ledger: All accounts · Cash & bank (`/cash/book`) |
| | Reports | `/reports/pl` | Reports: Profit & Loss · Balance sheet · Trial balance |
| Setup (collapsed) | Chart of accounts | `/gl/accounts` | — |
| | Staff | `/payroll/staff` | — |
| | Item costs | `/stock/costs` | — |
| | Sales settings | `/sales/settings` | — |
| | Payroll settings | `/payroll/rates` | — |
| | Company details | `/company` | — |
| | Users | `/users` | — |

A section with tabs shows as one rail item (its first tab), as today. `/ap/aging`
moves from a standalone report to the fourth Purchases tab. `/payslips` (My
payslips) stays a route and appears in the rail only for roles that are not
office roles, since the owner has no use for it. Roles keep the same
visibility rules as now (`PAGES[].roles`). In slice B the Month-end checklist
takes the first position of its group; in slice A the group starts with
Timesheet.

### Page header

Every screen starts with the same header, rendered by `Shell`, not by the
screen: title (18px), one-line subtitle (`slate-500`), and an actions slot on
the right. A screen passes its actions (Print, Excel, + New …) through a small
context (`usePageActions(node)`), so the buttons sit in the header and never in
the body. Section tabs render directly under the header when the page has
siblings. On Today the title is the greeting and the subtitle is the date, as
now.

### Phone (narrower than 1024px)

No rail. A fixed bottom bar with four buttons: **Today**, **Search**, **New**,
**Menu**. Menu opens the existing drawer with the full grouped list; New opens
the + New list as a bottom sheet. The page header stacks: title, subtitle, then
actions wrap underneath. Forms go to one column. Tables scroll sideways inside
their card, as now. Text stays 13px; tap targets stay at least 40px even
though inputs are 32px, by padding the row, not the control.

## Shared parts (`web/src/ui.tsx`)

- `PageHeader` is not a component screens render; it is the `Shell` header plus
  `usePageActions`. Screens stop rendering their own title rows and `ReportBar`
  buttons move into the actions slot. `ReportBar` keeps its print-only header
  block (company name, period, printed-at) but no longer draws screen buttons.
- **Tables**: a `.table` base in CSS: sticky header, header 10px uppercase
  `slate-500`, right-aligned numeric columns, hover row `slate-50`, last row
  no border. Status pills: `.pill`, `.pill-ok`, `.pill-warn`, `.pill-danger`.
  Due dates in lists read as a pill: "Overdue", "Due today", "Due Tue",
  "Due 31/10" (within 7 days, weekday; later, the date; past, Overdue).
- **Forms**: labels above inputs, `grid sm:grid-cols-2`, first input has
  `autoFocus`. A `useEscape(onBack)` hook returns to the list on Esc. Submit
  on Enter is native. Save buttons sit bottom-right: `Save` (primary) and
  `Save & add another` (light) on PV, OR, Transfer, Journal, Purchase invoice
  and Staff advance. "Save & add another" keeps the date and the paid-from
  account, clears the rest, keeps focus in the form.
- **After save**: the form closes, the list reloads with the new or changed
  row highlighted (`bg-amber-50` fading over 2s, matched by `doc_no`), and a
  toast reads "PV-000143 saved · RM 1,860.00". The `Done` component and its
  full-screen "Add another" page are deleted.
- **States**: `Empty` (text plus an optional button for the next step),
  `Loading…`, and `.alert-error` keep their current look and are the only
  three. `Ready` stays for reports.
- **Toast**: a tiny module-level store (same pattern as `useLoading`):
  `toast(message, { kind?: 'ok' | 'error', action?: { label, onClick } })`.
  Rendered once by `Shell` bottom-right (bottom-centre above the bar on
  phone), 4s for ok, 8s for error, stacked, dismiss on click. Every
  `alert(...)` in `web/src` becomes `toast(msg, { kind: 'error' })`.
- **Confirm**: `confirmDialog({ title, body?, confirmLabel, danger? }):
  Promise<boolean>`, rendered by the same `Shell` host as a centred modal with
  Cancel (light) and the confirm button (primary, or red when `danger`). Esc
  cancels, Enter confirms. Every `confirm(...)` in `web/src` becomes
  `await confirmDialog(...)` with the document number and amount in the body.
- **Buttons**: `.btn` (orange), `.btn-light` (white, border), `.btn-ghost`
  (text only, for row and header secondary actions), `.btn-danger` (red,
  used only inside the confirm dialog). All 32px.
- **Search dialog** and **LoadingBar** stay as they are.

## What each screen does in this slice

Only markup: adopt the header slot, the table and form rules, Save & add
another where listed, toast and confirm. No field, column, query or function
changes. Order of work, each step committed and deployable on its own:

1. Tokens, CSS classes, toast store, confirm host, `usePageActions`,
   `useEscape` — no screen changes yet. Build must pass.
2. `App.tsx`: new `PAGES` grouping and labels, rail, bottom bar, header with
   actions slot. All routes unchanged.
3. Money out screens: Purchase invoices, Pay suppliers, Suppliers, Aging,
   Payment voucher, Claims.
4. Money in: Sales upload, Card settlement, Official receipt, Transfer.
5. Month-end: Timesheet, Payroll run, Advances, Yearly summary, Accruals,
   Stock count, Bank reconciliation.
6. Books and Setup: Documents, Journal entry, Ledger, Cash book, three
   reports (screen chrome only; statement layout is slice D), Chart of
   accounts, Staff, Item costs, Sales settings, Payroll settings, Company,
   Users. Today keeps its current content with the new header (rebuilt in
   slice B).
7. Delete `Done`, the old `ReportBar` button row, every remaining
   `alert`/`confirm`, and any class no longer referenced.

## Testing

- `npx tsc -b`, `npx oxlint` and `npm run build` on every step.
- `dashboard-test.mjs` gains asserts for the due-date pill text function and
  the toast store (push, auto-expire, dismiss), since both are plain logic.
- After each pushed step the owner checks that group on the live site; a
  step is done when every screen in it posts, lists, edits and deletes as
  before.

## Out of scope for slice A

Dashboard content, Month-end checklist, one-drop daily close, invoice and
payment speed-ups, report layouts and PDF, dark theme, any SQL.

## Risks

- Muscle memory: items move groups. Mitigated by unchanged URLs, the search
  dialog, and the + New menu keeping its five entries.
- Replacing `alert`/`confirm` touches many call sites; each is mechanical and
  the build catches a missed `await`.
