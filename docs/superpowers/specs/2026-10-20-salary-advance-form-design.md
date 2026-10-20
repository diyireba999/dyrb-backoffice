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
- **The form** (A4 portrait, half a page; simplified 2026-10-20 at the owner's request):
  - Letterhead as on reports (logo, company name, registration no., address, phone),
    title `Salary Advance`, period line `<doc no> · <date>`.
  - Four lines: Name · IC / Passport · Date · Amount (`RM 1,250.00`, then the amount in
    words).
  - One sentence: "I received this salary advance. It will be deducted from my <Month
    Year> salary, and any balance from the following month."
  - Two signature blocks side by side: "Staff" (name under the line) and "Approved by
    <company>" (the signed-in user's name under the line), each with a Date line.
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
