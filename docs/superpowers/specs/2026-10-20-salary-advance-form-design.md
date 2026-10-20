# Salary advance form

Date: 2026-10-20. Status: approved in conversation (English only; printed after the advance is recorded).

## Why

When a staff member takes a salary advance the owner wants a signed paper on file. The
advance is already recorded on the Staff Advance screen; this adds a printed agreement
for that record.

## What

- **Staff Advance list** (`/payroll/advances`): a print button on every row (Printer
  icon, title "Print form"). Pressing it loads the advance's document number and the
  account the money came from, then prints the form on its own (the list does not
  print). Anyone who can see the list can print.
- **The form** (A4 portrait, one page):
  - Letterhead as on reports (logo, company name, registration no., address, phone),
    title `Salary Advance Agreement`, period line `<doc no> · <date>`.
  - Details: Staff name · Staff no. · IC / Passport no. · Position · Date of advance ·
    Amount (`RM 1,250.00`, then the amount in words) · Paid from (Cash in Drawer / Petty
    Cash / Bank) · Note (when there is one).
  - Terms, in plain English: receipt of the amount on the date; it is deducted from the
    salary for the month of the advance; any balance carries to the following month(s)
    until fully repaid; if employment ends first, the balance is due on the last day and
    may be deducted from final pay.
  - Two signature blocks side by side: "Received by (staff)" and "Approved by (for
    <company>)", each with a signature line, Name and Date.
- **Amount in words**: `ringgitInWords(amount)` in `web/src/money-words.ts`, pure and
  tested: `Ringgit Malaysia one thousand two hundred and fifty and sen fifty only`.

## Shared parts

- `Letterhead({ title, period })` is extracted from `ReportBar` in `web/src/ui.tsx` and
  used by both.
- The payslip print switch becomes general: `.print-page` (hidden while printing a
  document) and `.print-doc` (shown only while printing a document), toggled by
  `printDocument()` in `web/src/page.tsx`, which adds `printing-doc` to `<body>` and
  removes it after printing. Payslips use the same classes.

## Out of scope

Bahasa Malaysia text; a blank form; storing the signed copy (no uploads).
