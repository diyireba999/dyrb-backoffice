# Dashboard Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first screen answer the three questions the owner actually opens the app with — what money is there and what is due, is trade up or down, and is the month going to make anything.

**Architecture:** Read-only. No migration, no new table, no new RPC. Everything comes from the existing `account_balances` view (which already groups by account *and* date), the `account_totals` RPC, and one query against `purchase_invoice_status`. The arithmetic that is worth getting wrong — break-even, weekday-matched comparisons — moves into pure functions in their own module with a runnable test, because nothing else in the front end is tested.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind, Supabase (PostgREST + RPC), Node for the new pure-function test.

## Global Constraints

- **No schema changes at all.** This part of the spec is a read layer. If a task seems to need a migration, stop and report rather than adding one.
- Live production data exists. Every query is read-only.
- `web/.env.local` must exist for a meaningful front-end build. Without it Vite dead-code-eliminates the whole application (the app loads via a dynamic `import('./App.tsx')` behind an env-var check) and `npm run build` passes while bundling nothing. It is gitignored and already present; do not delete it. After any change, confirm your code reaches `dist/assets/App-*.js`.
- `oxlint` fails on unused imports.
- Money is formatted with `rm()`, dates with `dmy()`, amounts rounded with `round2()`, today in Malaysia time via `todayMY()` — all from `web/src/lib.ts`. Do not introduce a date library.
- Tailwind shorthands live in `web/src/index.css`: `card`, `btn`, `btn-light`, `link`, `muted`, `badge`, `alert-error`, `no-print`. Use them rather than ad-hoc utility stacks.
- Chart colours come from the two-slot palette already in `web/src/charts.tsx` (`SERIES`). Do not invent new colours; if a third series is genuinely needed, say so in your report rather than picking one.
- The dashboard has a staff-role branch that shows only their own claims. Do not change what a staff user sees.

### Account ranges this plan relies on

| Range | Meaning |
|---|---|
| `4000`–`4099` | Sales — food `4000`, beverage `4010`, liquor `4020`, corkage `4030` |
| `4100`–`4899` | Service charge |
| `4900`–`4999` | Other income |
| `5000`–`5099` | Cost of sales — food `5000`, beverage `5010`, liquor `5020`, packaging `5100` |
| `6000`–`6999` | Running costs; `6200` is card and e-wallet fees |
| `1000`,`1010`,`1100` | Cash in drawer, petty cash, bank |
| `2000` | Owed to suppliers |
| `2500`–`2599` | Owed to directors (`isDirector` in `lib.ts`) |

Corkage `4030` deliberately has no cost account — it is money with no stock behind it. Any margin calculation that pairs sales with cost must exclude it, or the drink margin is overstated.

### Traps already paid for on earlier branches — do not repeat

1. Never resolve a message at render time from state cleared in the same handler; React batches them.
2. `numeric` columns arrive from PostgREST as **strings**. `===` between a string and a number is silently false, and `+` concatenates. Coerce with `Number(...)` before arithmetic or comparison. A total that silently concatenates is the single most likely bug in this plan.
3. Never put an HTML `max` on an input whose legitimate value can exceed it.

---

### Task 1: The arithmetic, as tested pure functions

**Files:**
- Create: `web/src/dashboard-math.ts`
- Create: `web/dashboard-test.mjs`
- Modify: `web/package.json` (add the test script)

**Interfaces:**
- Consumes: nothing — these are pure functions over plain numbers and `YYYY-MM-DD` strings.
- Produces:
  - `type DayAmount = { date: string; amount: number }`
  - `breakEven(input: { fixed: number; variableRate: number; daysInMonth: number }): number | null`
  - `variableRate(input: { costOfSales: number; cardFees: number; sales: number }): number | null`
  - `sumRange(days: DayAmount[], from: string, to: string): number`
  - `sameWeekdayLastWeek(date: string): string`
  - `addDaysISO(date: string, n: number): string`
  - `daysInMonth(month: string): number` where `month` is `YYYY-MM`
  - `pctChange(now: number, before: number): number | null`

Everything that can be got quietly wrong lives here, and nothing here touches React or Supabase, so it can be tested with plain Node asserts.

- [ ] **Step 1: Write the failing test**

Create `web/dashboard-test.mjs`:

```js
import assert from 'node:assert/strict'
import {
  addDaysISO, breakEven, daysInMonth, pctChange, sameWeekdayLastWeek, sumRange, variableRate,
} from './src/dashboard-math.ts'

// --- date helpers ---
assert.equal(addDaysISO('2026-09-27', 1), '2026-09-28')
assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01', 'crosses the year')
assert.equal(addDaysISO('2027-03-01', -1), '2027-02-28', 'non-leap February')
assert.equal(addDaysISO('2028-03-01', -1), '2028-02-29', 'leap February')
assert.equal(sameWeekdayLastWeek('2026-09-27'), '2026-09-20')
assert.equal(daysInMonth('2026-02'), 28)
assert.equal(daysInMonth('2028-02'), 29)
assert.equal(daysInMonth('2026-09'), 30)
assert.equal(daysInMonth('2026-12'), 31)

// --- sumRange is inclusive at both ends and ignores days outside it ---
const days = [
  { date: '2026-09-01', amount: 100 },
  { date: '2026-09-02', amount: 200 },
  { date: '2026-09-03', amount: 400 },
]
assert.equal(sumRange(days, '2026-09-01', '2026-09-02'), 300)
assert.equal(sumRange(days, '2026-09-02', '2026-09-02'), 200)
assert.equal(sumRange(days, '2026-09-04', '2026-09-30'), 0, 'no days in range is zero, not NaN')

// Values arriving as strings from PostgREST must not concatenate.
const stringy = [{ date: '2026-09-01', amount: '100' }, { date: '2026-09-02', amount: '200' }]
assert.equal(sumRange(stringy, '2026-09-01', '2026-09-02'), 300, 'string amounts are coerced, not concatenated')

// --- variable rate ---
assert.equal(variableRate({ costOfSales: 3000, cardFees: 200, sales: 10000 }), 0.32)
assert.equal(variableRate({ costOfSales: 0, cardFees: 0, sales: 0 }), null, 'no sales means no rate')

// --- break-even ---
// fixed 30000, variable rate 0.32 -> 30000 / 0.68 = 44117.65 a month, /30 = 1470.59 a day
assert.equal(breakEven({ fixed: 30000, variableRate: 0.32, daysInMonth: 30 }), 1470.59)
assert.equal(breakEven({ fixed: 30000, variableRate: 1, daysInMonth: 30 }), null, 'variable eats every ringgit')
assert.equal(breakEven({ fixed: 30000, variableRate: 1.2, daysInMonth: 30 }), null, 'variable exceeds sales')
assert.equal(breakEven({ fixed: 0, variableRate: 0.32, daysInMonth: 30 }), 0, 'no fixed costs, break even at zero')

// --- percentage change ---
assert.equal(pctChange(110, 100), 10)
assert.equal(pctChange(90, 100), -10)
assert.equal(pctChange(100, 0), null, 'no baseline means no percentage')
assert.equal(pctChange(0, 0), null)

console.log('dashboard math ok')
```

- [ ] **Step 2: Add the script and run it to verify it fails**

In `web/package.json`, add to `scripts`:

```json
"test:dash": "node --experimental-strip-types dashboard-test.mjs"
```

This was checked on the machine this plan was written for: Node is v24.14.0, which strips TypeScript types natively and still accepts `--experimental-strip-types` as a no-op. The flag is kept because `web/.node-version` pins 22 for Cloudflare, and Node 22.6–22.17 needs it. Do not add a build step or a bundler for this one test file.

This test runs locally only — Cloudflare's build is `tsc -b && vite build` and never invokes it.

Run: `cd web && npm run test:dash`
Expected: fails, `Cannot find module './src/dashboard-math.ts'`.

- [ ] **Step 3: Write the module**

Create `web/src/dashboard-math.ts`:

```ts
// Pure arithmetic for the dashboard. No React, no Supabase — so it can be tested
// with plain Node asserts, which nothing else in the front end is.

export type DayAmount = { date: string; amount: number | string }

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0

// YYYY-MM-DD shifted by whole days, via UTC so no timezone can move the date.
export function addDaysISO(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const sameWeekdayLastWeek = (date: string) => addDaysISO(date, -7)

// month is 'YYYY-MM'. Day 0 of the next month is the last day of this one.
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// Inclusive of both ends. Amounts may arrive from PostgREST as strings.
export function sumRange(days: DayAmount[], from: string, to: string): number {
  return days.reduce((s, d) => (d.date >= from && d.date <= to ? s + n(d.amount) : s), 0)
}

// The share of each ringgit of sales that is eaten by costs which scale with it:
// the stock behind what was sold, plus the card processor's cut.
// Null when there are no sales to take a share of.
export function variableRate({ costOfSales, cardFees, sales }: {
  costOfSales: number; cardFees: number; sales: number
}): number | null {
  if (!(sales > 0)) return null
  return (n(costOfSales) + n(cardFees)) / n(sales)
}

// Sales per day needed to cover the fixed costs once the variable share is taken out.
// Null when the variable share is 1 or more — every extra ringgit of sales loses
// money, so no amount of trade breaks even and a figure would be a lie.
export function breakEven({ fixed, variableRate: v, daysInMonth: days }: {
  fixed: number; variableRate: number; daysInMonth: number
}): number | null {
  if (!(days > 0)) return null
  if (v >= 1) return null
  const monthly = n(fixed) / (1 - n(v))
  return Math.round((monthly / days) * 100) / 100
}

// Null rather than Infinity when there is nothing to compare against.
export function pctChange(now: number, before: number): number | null {
  if (!(n(before) > 0)) return null
  return Math.round(((n(now) - n(before)) / n(before)) * 1000) / 10
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm run test:dash
```

Expected: prints `dashboard math ok` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard-math.ts web/dashboard-test.mjs web/package.json
git commit -m "feat: pure, tested arithmetic for the dashboard"
```

---

### Task 2: The data layer

**Files:**
- Modify: `web/src/lib.ts` (append)

**Interfaces:**
- Consumes: the `account_balances` view (`code, name, type, date, debit, credit`, one row per account per day) and the `purchase_invoice_status` view (`id, supplier, date, due_date, total, paid, outstanding`).
- Produces:
  - `dailyNet(from: string, to: string, codeFrom: string, codeTo: string): Promise<DayAmount[]>` — net credit (income positive) per day for accounts in `[codeFrom, codeTo)`.
  - `supplierDue(today: string): Promise<{ dueSoon: number; overdue: number }>`

- [ ] **Step 1: Add the helpers**

Append to `web/src/lib.ts`:

```ts
import type { DayAmount } from './dashboard-math'

// Income accounts are credit-balance, so credit minus debit reads positive.
// account_balances already groups by account and date, so a whole series is one query.
export async function dailyNet(from: string, to: string, codeFrom: string, codeTo: string): Promise<DayAmount[]> {
  const { data, error } = await supabase.from('account_balances')
    .select('date, debit, credit')
    .gte('date', from).lte('date', to)
    .gte('code', codeFrom).lt('code', codeTo)
  if (error) { console.error('Could not load the daily figures:', error.message); return [] }
  const byDay = new Map<string, number>()
  for (const r of (data ?? []) as { date: string; debit: number | string; credit: number | string }[]) {
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + (Number(r.credit) - Number(r.debit)))
  }
  return [...byDay].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date))
}

// What is owed to suppliers, split by whether it is already late.
export async function supplierDue(today: string) {
  const { data, error } = await supabase.from('purchase_invoice_status')
    .select('due_date, outstanding').gt('outstanding', 0)
  if (error) { console.error('Could not load supplier due dates:', error.message); return { dueSoon: 0, overdue: 0 } }
  const soon = addDays(today, 7)
  let dueSoon = 0, overdue = 0
  for (const r of (data ?? []) as { due_date: string; outstanding: number | string }[]) {
    const amt = Number(r.outstanding)
    if (r.due_date < today) overdue += amt
    else if (r.due_date <= soon) dueSoon += amt
  }
  return { dueSoon: round2(dueSoon), overdue: round2(overdue) }
}
```

Note `dailyNet` returns net **credit**, so for expense ranges the figures come back negative. Callers that want a positive cost figure negate it — do that at the call site and say so in a comment, rather than adding a second function.

- [ ] **Step 2: Check it compiles**

```bash
cd web && npm run lint && npm run build
```

Both must pass. `DayAmount` is imported as a type only, so it must use `import type`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib.ts
git commit -m "feat: daily account series and supplier due-date split"
```

---

### Task 3: Band 1 — money now

**Files:**
- Modify: `web/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `accountTotals`, `supplierDue` (Task 2), the existing `Kpi` component in this file.
- Produces: nothing new.

- [ ] **Step 1: Extend the tiles**

The five tiles stay as they are — Bank, Cash on hand, Owed to suppliers, Claims to settle, Owed to director — with one change: **Owed to suppliers** gains a sub-line reading, for example, `RM 1,240 due in 7 days · RM 380 overdue`, from `supplierDue(todayMY())`.

Show only the parts that are non-zero: if nothing is overdue, do not print `RM 0.00 overdue`. If both are zero, show the existing tile with no sub-line. The overdue figure is the one that matters, so give it the same rose colouring the aging screen uses for an overdue row — read `ApAging` in `web/src/pages/Purchase.tsx` for the exact class.

The `Kpi` component takes a `note` string. If the sub-line needs two colours, widen `note` to `React.ReactNode` rather than adding a second prop.

- [ ] **Step 2: Verify**

```bash
cd web && npm run lint && npm run build
```

Then confirm the code reached the bundle:

```bash
cd web && node -e "const fs=require('fs');const d='dist/assets';console.log(fs.readdirSync(d).filter(f=>f.startsWith('App')).map(f=>fs.readFileSync(d+'/'+f,'utf8').includes('overdue')))"
```

Must print `[ true ]`.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Dashboard.tsx
git commit -m "feat: show what is due and what is overdue on the money tiles"
```

---

### Task 4: Band 2 — sales, with the break-even line

**Files:**
- Modify: `web/src/pages/Dashboard.tsx`
- Modify: `web/src/charts.tsx` (add `DailyBars`)

**Interfaces:**
- Consumes: `dailyNet` (Task 2), everything from `dashboard-math` (Task 1).
- Produces: `DailyBars({ days, breakEvenLine }: { days: DayAmount[]; breakEvenLine: number | null })` in `charts.tsx`.

This band replaces the existing "Sales vs expenses" card. Keep `SalesVsExpenses` in `charts.tsx` — do not delete a component another screen may use; check with grep whether anything else imports it and say so in your report.

- [ ] **Step 1: The three comparisons**

Weekday-matched, because bar trade swings hard by day of week and a plain day-on-day figure misleads:

| Figure | Now | Compared with |
|---|---|---|
| Yesterday | sales on `addDaysISO(today, -1)` | `sameWeekdayLastWeek` of that day |
| Week to date | Monday of this week → yesterday | the same span one week earlier |
| Month to date | 1st of this month → yesterday | 1st of last month → the same day-of-month |

Use yesterday rather than today throughout: today's sales are not uploaded yet, so including today would always show a collapse. Say that in a one-line caption under the figures.

Each shows the amount and the change from its comparison via `pctChange`, with `null` rendered as "no figure to compare" rather than a dash — a dash reads as zero. Colour the change green above, rose below, using the classes already used for `Profit so far` in this file.

Month-to-date's comparison needs care when last month is shorter: comparing the 1st–31st of March against the 1st–31st of February should stop at the 28th. Clamp the comparison end date to the last day of that month with `daysInMonth`.

- [ ] **Step 2: The 42-day strip**

Add to `web/src/charts.tsx`:

```tsx
export function DailyBars({ days, breakEvenLine }: { days: DayAmount[]; breakEvenLine: number | null }) {
```

One thin bar per day, oldest left. Use `SERIES[0]`. Height scales to `niceMax` of the highest day, and of `breakEvenLine` when there is one, so the line is always on the chart. Draw the break-even line as a horizontal dashed rule across the plot with a small right-hand label. Days with no sales render as a visible baseline stub, not a gap — a closed day is information.

On hover show the date and the amount, reusing the tooltip pattern already in `SalesVsExpenses`. Add the same `<details>` "Show as table" fallback that component has; it is how this app stays usable on a phone and printable.

- [ ] **Step 3: Break-even, and when to hide it**

```
F = total of accounts 6000–6999 EXCLUDING 6200 over the last 3 complete months,
    divided by the number of complete months actually covered by data (2 or 3)
v = variableRate({ costOfSales: 5000–5999, cardFees: 6200, sales: 4000–4099 }) over the same window
line = breakEven({ fixed: F, variableRate: v, daysInMonth: daysInMonth(thisMonth) })
```

Use **complete** months only — the current partial month would drag the average down and make break-even look easy.

Two things this formula gets wrong if written carelessly, both of which understate break-even and flatter the month:

- **Divide by the months actually covered, not a hard-coded 3.** The history gate admits two complete months, so a business two months old would otherwise have its fixed costs divided by three and be told break-even is a third lower than it is. Derive the count from the earliest journal date, and exclude a partial first month from it.
- **Cost of sales is 5000–5999, not 5000–5099.** The narrower range orphans `5100 Packaging & Consumables` — counted as neither variable nor fixed, so it vanishes from the formula. It also contradicts the gross-margin figure on the same screen, which treats 5000–5999 as cost of sales.

Period aggregates come from the `accountTotals` RPC, **not** from `dailyNet` — see Task 2. `dailyNet` is narrow-range only and will throw rather than return a truncated series.

Caption it plainly: `Break even at RM 4,180 a day. Averaging RM 4,720 a day this month.` The second figure is this month's sales to date divided by days elapsed.

Hide the line and show a short explanation instead when any of these hold — each is a case where a number would be a lie:
- fewer than two complete months of data exist
- `variableRate` returns `null` (no sales in the window)
- `breakEven` returns `null` (variable costs at or above sales)

- [ ] **Step 4: Verify**

```bash
cd web && npm run test:dash && npm run lint && npm run build
```

Bundle check with a distinctive string from your caption; must print `[ true ]`.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Dashboard.tsx web/src/charts.tsx
git commit -m "feat: weekday-matched sales trend with a derived break-even line"
```

---

### Task 5: Band 3 — profit and cost health

**Files:**
- Modify: `web/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `accountTotals`, `pctChange`, the existing `RankedBars` component.
- Produces: nothing new.

- [ ] **Step 1: Margin, and the three-way split**

Gross margin this month — `(sales − cost of sales) ÷ sales` over `4000`–`4099` against `5000`–`5099` — with the change in **percentage points** against last month. Percentage points, not a percentage of a percentage: going from 60% to 63% is "up 3 points", not "up 5%". Label it so.

Then the split three ways, pairing each sales account with its cost account:

| Line | Sales | Cost |
|---|---|---|
| Food | `4000` | `5000` |
| Beverage | `4010` | `5010` |
| Liquor | `4020` | `5020` |

**Corkage `4030` is excluded on purpose** — it has no cost account because there is no stock behind it, and folding it in would flatter the drink margin. If corkage is non-zero this month, show it as its own line with its amount and no margin, so the money is not silently missing from the card.

A category with no sales this month shows nothing rather than a 0% margin.

- [ ] **Step 2: Top running costs, with direction**

Keep the existing `RankedBars` list of the top running costs (`6000`+) this month, and add the change against the same range last month: an up or down arrow with the percentage, from `pctChange`. Up is bad here, so colour it rose; down is emerald — the opposite of the sales figures, which is exactly why each needs a word next to it rather than relying on colour alone.

A cost that did not exist last month shows "new" rather than a percentage.

- [ ] **Step 3: Verify**

```bash
cd web && npm run lint && npm run build
```

Bundle check with a distinctive string; `npm run test:dash` still passes.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Dashboard.tsx
git commit -m "feat: gross margin, the food/beverage/liquor split and cost direction"
```

---

### Task 6: Remove the recent-documents band, tidy, document

**Files:**
- Modify: `web/src/pages/Dashboard.tsx`
- Modify: `README.md`

- [ ] **Step 1: Remove the band**

Delete the "Recent documents" card and its `recent` state, effect and `Recent` type. Every document type now has its own searchable history screen, so a six-row teaser is a dead end that duplicates them.

Check whether `dmy`, `Link` or any other import becomes unused once it is gone, and remove it — `oxlint` will fail the build otherwise.

Keep the quick-action buttons at the top (Payment Voucher, Official Receipt, Purchase Invoice).

- [ ] **Step 2: Check the loading and empty states**

A brand-new database, and a database with one day of data, must both render without crashing or showing `NaN`. Walk each new figure and confirm its zero case. In particular: `pctChange` with no baseline, `sumRange` over an empty array, and the margin lines when a category has no sales.

While the figures are loading, the bands should not flash misleading zeros. Follow whatever the file already does for this; if it does nothing, a simple skeleton or a `muted` "Loading…" in each card is enough. Do not add a spinner library.

- [ ] **Step 3: Update the README**

In the **Status** section, extend or add the Phase 6 line to record that the dashboard now shows money due, a weekday-matched sales trend, break-even and margin health. Match the existing phase-line style.

Under **Everyday notes**, add one short bullet in the README's plain voice: the dashboard compares against the same weekday a week ago because trade swings by day of week, and the break-even figure is worked out from the last three complete months, so it settles down once there is a few months of history.

Add `npm run test:dash` to the list of test commands in the "Run on this computer" section, alongside the existing ones.

- [ ] **Step 4: Full verification**

```bash
cd web && npm run test:dash && npm run test:db && npm run test:rls && npm run test:repair && npm run lint && npm run build
```

All six must pass with no line of output starting with `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Dashboard.tsx README.md
git commit -m "feat: drop the recent-documents teaser and document the new dashboard"
```

---

## Deployment note

Nothing to run in Supabase. This branch is read-only against the existing schema, so it can be merged and deployed on its own.

## Out of scope

- A to-do / action list on the dashboard — considered and declined
- Manual monthly sales targets; break-even is derived instead
- Any change to what a staff-role user sees
- Item 4 of the original request, general UX simplification, which remains unscoped
