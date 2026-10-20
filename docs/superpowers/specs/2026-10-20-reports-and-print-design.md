# UX upgrade, slice D: reports and print

Date: 2026-10-20. Status: approved in conversation.

## Why

The statements read well on screen but the owner still cannot see the year month by
month, the "Excel" button gives a bare CSV, and printouts carry screen styling. Slice D
adds a monthly P&L, real Excel files on every export, and one print rule set.

## Decisions already made

- Monthly P&L shows every account with group totals (not a summary), one column per
  month plus Total, and prints landscape.
- Excel export uses one small library, `write-excel-file` (same author as the
  `read-excel-file` already used; browser build; no SheetJS advisories). It replaces the
  CSV helper everywhere. This is the only new dependency in the slice.
- Print: global rules in `index.css`, landscape for wide tables, payslips two per page.
- PDF stays the browser's Print → Save as PDF. No PDF library, no charts in print, no
  signature lines.
- Reports stay read-only: no new SQL, nothing for the owner to run.
- Slice A/B/C parts apply (compact density, orange only on primary buttons / active nav /
  focus / links, header action slot, toasts).

## Pure report logic (`web/src/report-math.ts`, new)

Shared by the P&L statement and the monthly P&L so the two never disagree.

```ts
export type PlSection = 'sales' | 'service' | 'other' | 'cost' | 'opex'
// income < 4100 → sales; 4100–4899 → service; ≥ 4900 → other
// expense < 6000 → cost; ≥ 6000 → opex; anything else → null
export function plSection(a: { code: string; type: string }): PlSection | null

// Statement figures: no "RM", negatives in brackets, two decimals, thousands commas.
export function fig(v: number): string
// '+12.3%', '-4.0%', 'new' (prev 0, cur not 0), '' (both 0)
export function change(cur: number, prev: number): string

export type MonthlyLine = {
  kind: 'head' | 'item' | 'sub' | 'total' | 'grand' | 'pct'
  label: string
  code?: string
  values: (number | null)[]   // one per month given; null = month not loaded, or % with no sales
  total: number | null        // sum across loaded months; for pct rows, total profit / total sales
}
// `months[i]` is the account net map (debit − credit) for month i, or null when not loaded.
export function monthlyLines(accounts: Account[], months: (Map<string, number> | null)[]): MonthlyLine[]
```

`monthlyLines` output order: Sales (items, "Total sales"), Cost of sales (items, "Total cost
of sales"), **Gross profit** (total), Service charge (items, "Total service charge"; group
omitted when it has no items), Other income (same), Operating expenses (items, "Total
operating expenses"), **Net profit** / **Net loss** (grand; label from the Total column),
then two `pct` rows: "Gross profit % of sales" and "Net profit % of sales". Income nets are
negated so sales read positive. An account is hidden when it is zero in every loaded
month. Item values for unloaded months are null; subtotal and total values are null for
those months too. Percent rows are null where sales is zero.

The P&L statement in `Reports.tsx` switches to `plSection`, `fig` and `change` from this
file; its own copies go.

## Monthly P&L screen (`/reports/monthly`)

- `PAGES` entry after Profit & Loss: label `Monthly P&L`, subtitle `Each month of the year
  side by side`, icon `Columns3`, group Books, section Reports, roles REPORTS.
- Controls in the `ReportBar`: a Year `<select>` (this year and the four before).
- Data: one `accountTotals(first, last)` per month of the chosen year, all in parallel.
  For the current year only months up to and including this month are loaded; later
  months are null (blank columns). A load error shows through `Ready` like the other
  statements.
- Table: first column account (code muted, as the statement), then Jan … Dec, then Total.
  Row styles as `StatementTable` (`ROW_STYLE`), `pct` rows muted small text, negative grand
  totals red on screen. On screen the table has `min-w-[1100px]` inside the scrolling
  card and the first column is sticky (`sticky left-0 bg-white`). Note under the table:
  "% is of food and drink sales. Service charge is passed on to staff, so it is left out
  of the margins."
- Print: the page root carries `print-landscape`; the table loses its min width in print.
- Excel: `monthly-pl-<year>.xlsx`, columns Code · Account · Jan … Dec · Total; head rows
  as an upper-case label; pct rows as numbers with two decimals (not strings).
- Page title in the printed letterhead: `Monthly Profit & Loss`, period `Year <year>`.

## Excel export

`web/src/excel.ts` (new, pure, tested):

```ts
export type Cell = { value: string | number; type?: NumberConstructor | StringConstructor;
  format?: string; fontWeight?: 'bold'; align?: 'right' } | null
export function toSheet(rows: (string | number)[][]): { data: Cell[][]; columns: { width: number }[] }
```

Rules: row 0 is the header, every non-empty cell bold. A number becomes `{ value, type:
Number, format: '#,##0.00', align: 'right' }`. A non-empty string becomes `{ value, type:
String }`. An empty string becomes `null`. Column width = the longest cell in that column
(numbers measured as their `#,##0.00` text), plus 2, clamped to 8–48 characters.

`downloadExcel(filename, rows)` in `lib.ts` replaces `downloadCsv`: `toSheet`, then
`writeXlsxFile(data, { columns, fileName: filename, sheet: 'Report' })` from
`write-excel-file`. Every caller passes a `.xlsx` filename. `downloadCsv` is deleted.
Callers (11): Trial Balance, P&L, Balance Sheet, Journal Listing, Chart of Accounts,
General Ledger / Cash Book, Payroll summary, Payslips, Payroll year, Supplier aging, Item
Costs, plus the new Monthly P&L. Buttons still read "Excel".

## Print

`index.css` `@media print` block becomes the one place for print styling:

- `.no-print` hidden (as now); white background, exact colours (as now).
- `table { font-size: 10.5px }`, `th, td { padding: 3px 6px }`, `thead { display:
  table-header-group }`, `tr { break-inside: avoid }`.
- `.card { border: 0; box-shadow: none; border-radius: 0; }`.
- `a { color: inherit; text-decoration: none }`.
- `@page landscape { size: A4 landscape }` and `.print-landscape { page: landscape }`.
  Applied to the page root (so the letterhead and the table share the page) of: Monthly
  P&L, Payroll summary (`/payroll/run`), Payroll year, Supplier aging.
- `StatementTable` drops its own `print:` utilities (font, padding, card flattening); the
  global rules cover it. Other per-table `print:` utilities that duplicate the global
  rules go too.
- Payslips: two per A4 page. The first slip of each pair ends with a dashed cut line
  (`print:border-b print:border-dashed print:border-slate-400`), the second ends the page
  (`print:break-after-page`). Cards keep `break-inside-avoid`.
- Orange leftovers to slate: Today quick-button icons (`text-slate-500`), the Books
  "Showing doc" chip (`bg-slate-100 text-slate-700`), the payslip Net pay box
  (`bg-slate-100 text-slate-900`).

## Testing

- `web/dashboard-test.mjs`: `plSection` on the five ranges and a non-P&L account; `fig`
  and `change` cases; `monthlyLines` with three accounts and three months (one null):
  hidden zero account, sales sign, gross and net rows, pct rows (null where sales 0),
  totals ignore null months, Net loss label.
- `web/dashboard-test.mjs`: `toSheet` on a header row, a number, an empty string, a long
  string: bold header, number format and align, null cell, widths (clamp both ends).
- `tsc`, `oxlint`, `build`; the owner prints the Monthly P&L and a payslip run from the
  live site and opens one Excel file.

## Out of scope

PDF generation in code; charts on paper; a reports hub page; year-end closing entries;
budget columns.
