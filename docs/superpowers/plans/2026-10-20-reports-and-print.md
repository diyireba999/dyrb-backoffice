# Reports and Print (UX slice D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monthly P&L for the year, real Excel files on every export, and one print rule set with landscape for wide tables and two payslips per page.

**Architecture:** Pure report logic moves to `web/src/report-math.ts` (section rules, figure formatting, monthly lines) and the Excel cell mapper to `web/src/excel.ts`, both tested with Node asserts. The screens stay thin: the new `MonthlyPl` page in `Reports.tsx` loads twelve `account_totals` calls in parallel and renders `monthlyLines`; `downloadExcel` in `lib.ts` wraps `write-excel-file`. Print styling lives in `index.css` only.

**Tech Stack:** React 19, react-router-dom 7, Tailwind v4, lucide-react, Supabase (read-only here), `write-excel-file` 4.x (new, the only new dependency), Node assert tests via `node --experimental-strip-types`.

Spec: `docs/superpowers/specs/2026-10-20-reports-and-print-design.md`.

## Global Constraints

- No new SQL. Reports only read `account_totals`; nothing for the owner to run.
- The only new dependency is `write-excel-file` (`npm install write-excel-file@4` in `web/`). No other library.
- P&L section rule, exact: income `< '4100'` sales; `>= '4100' && < '4900'` service; `>= '4900'` other; expense `< '6000'` cost; `>= '6000'` opex; otherwise null. Income nets are negated so sales read positive.
- Design tokens: 13px text, 32px rows, orange (`brand`) only on primary buttons, active nav, focus rings and links. Slice D removes the last three orange leftovers (Today quick-button icons, Books "Showing doc" chip, payslip Net pay box).
- Excel cells: header row bold; numbers `type: Number`, `format: '#,##0.00'`, `align: 'right'`; empty string → `null`; column width = longest cell + 2, clamped 8–48.
- Print: all print styling in `index.css` `@media print`; `.print-landscape { page: landscape }` with `@page landscape { size: A4 landscape }`; payslips two per A4 page.
- Every task ends with `npx tsc -b`, `npx oxlint src`, `npx vite build` clean (warnings about Payroll.tsx set-state-in-effect and chunk size are pre-existing) and `npm run test:dash` passing.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work on branch `ux-reports` from master.

---

### Task 1: Pure report logic (`report-math.ts`) and the P&L statement uses it

**Files:**
- Create: `web/src/report-math.ts`
- Modify: `web/src/pages/Reports.tsx` (lines 55–70: delete local `fig`, `change`; lines 166–172: section filters)
- Test: `web/dashboard-test.mjs` (append)

**Interfaces:**
- Produces: `plSection(a) → 'sales'|'service'|'other'|'cost'|'opex'|null`, `fig(v): string`, `change(cur, prev): string`, `type MonthlyLine`, `monthlyLines(accounts, months)` (used by Task 3).

- [ ] **Step 1: Write the failing tests** — append to `web/dashboard-test.mjs`:

```js
// --- report math (slice D) ---
const { plSection, fig, change, monthlyLines } = await import('./src/report-math.ts')
assert.equal(plSection({ code: '4000', type: 'income' }), 'sales')
assert.equal(plSection({ code: '4099', type: 'income' }), 'sales')
assert.equal(plSection({ code: '4100', type: 'income' }), 'service')
assert.equal(plSection({ code: '4899', type: 'income' }), 'service')
assert.equal(plSection({ code: '4900', type: 'income' }), 'other')
assert.equal(plSection({ code: '5000', type: 'expense' }), 'cost')
assert.equal(plSection({ code: '5999', type: 'expense' }), 'cost')
assert.equal(plSection({ code: '6000', type: 'expense' }), 'opex')
assert.equal(plSection({ code: '1100', type: 'asset' }), null)
assert.equal(fig(-1234.5), '(1,234.50)')
assert.equal(fig(1234567.891), '1,234,567.89')
assert.equal(fig(0), '0.00')
assert.equal(fig(-0.001), '0.00', 'rounds to zero, no brackets')
assert.equal(change(110, 100), '+10.0%')
assert.equal(change(90, 100), '-10.0%')
assert.equal(change(50, -100), '+150.0%', 'change measured against |prev|')
assert.equal(change(5, 0), 'new')
assert.equal(change(0, 0), '')

const accts = [
  { code: '4000', name: 'Food sales', type: 'income' },
  { code: '4010', name: 'Drink sales', type: 'income' },
  { code: '4100', name: 'Service charge 10%', type: 'income' },
  { code: '5000', name: 'Cost of food', type: 'expense' },
  { code: '6000', name: 'Rent', type: 'expense' },
  { code: '6010', name: 'Unused', type: 'expense' },
  { code: '1100', name: 'Bank', type: 'asset' },
]
const m = o => new Map(Object.entries(o))
const months = [m({ '4000': -1000, '5000': 400, '6000': 500, '1100': 999 }), m({ '4000': -2000, '4010': -500, '5000': 1000, '6000': 500 }), null]
const ml = monthlyLines(accts, months)
const by = label => ml.find(l => l.label === label)
assert.equal(by('Unused'), undefined, 'account zero in every loaded month is hidden')
assert.equal(by('Bank'), undefined, 'balance sheet accounts never appear')
assert.equal(by('Service charge'), undefined, 'group with no items is omitted')
assert.equal(ml[0].kind, 'head'); assert.equal(ml[0].label, 'Sales'); assert.equal(ml[0].total, null)
assert.deepEqual(by('Food sales').values, [1000, 2000, null], 'income reads positive; unloaded month null')
assert.equal(by('Food sales').code, '4000')
assert.deepEqual(by('Total sales').values, [1000, 2500, null]); assert.equal(by('Total sales').total, 3500)
assert.deepEqual(by('Gross profit').values, [600, 1500, null]); assert.equal(by('Gross profit').kind, 'total')
assert.deepEqual(by('Net profit').values, [100, 1000, null]); assert.equal(by('Net profit').total, 1100); assert.equal(by('Net profit').kind, 'grand')
assert.deepEqual(by('Gross profit % of sales').values, [60, 60, null]); assert.equal(by('Gross profit % of sales').kind, 'pct')
assert.equal(by('Net profit % of sales').total, 31.43, 'total % = total net / total sales')
assert.deepEqual(ml.map(l => l.kind).slice(-2), ['pct', 'pct'])
const loss = monthlyLines(accts, [m({ '6000': 300 })])
assert.equal(loss.find(l => l.kind === 'grand').label, 'Net loss')
assert.deepEqual(loss.find(l => l.kind === 'grand').values, [-300])
assert.deepEqual(loss.find(l => l.label === 'Net profit % of sales').values, [null], 'no sales: % is null')
assert.equal(loss.find(l => l.label === 'Net profit % of sales').total, null)
assert.deepEqual(monthlyLines(accts, []).find(l => l.kind === 'grand').values, [], 'no months: empty vectors')
console.log('report math ok')
```

- [ ] **Step 2: Run the tests to see them fail**

Run (in `web/`): `npm run test:dash`
Expected: fails at the import, `Cannot find module … report-math.ts`.

- [ ] **Step 3: Create `web/src/report-math.ts`**

```ts
// Pure report logic shared by the P&L statement and the monthly P&L, so the two
// never disagree. No imports: this file is run by the Node assert tests.

type AccountLike = { code: string; name: string; type: string }

export type PlSection = 'sales' | 'service' | 'other' | 'cost' | 'opex'

// Which P&L block an account belongs to, by chart code. Service charge is shown
// on its own because it is passed on to staff; the margins are measured on food
// and drink sales only.
export function plSection(a: { code: string; type: string }): PlSection | null {
  if (a.type === 'income') return a.code < '4100' ? 'sales' : a.code < '4900' ? 'service' : 'other'
  if (a.type === 'expense') return a.code < '6000' ? 'cost' : 'opex'
  return null
}

const round2 = (n: number) => Math.round(n * 100) / 100

// Statement figures: no "RM" on every cell, negatives in brackets.
export const fig = (v: number) => {
  const s = Math.abs(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return round2(v) < 0 ? `(${s})` : s
}

// '+12.3%', '-4.0%', 'new' when there was nothing before, '' when both are zero.
export const change = (cur: number, prev: number) => {
  if (round2(prev) === 0) return round2(cur) === 0 ? '' : 'new'
  const p = ((cur - prev) / Math.abs(prev)) * 100
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`
}

export type MonthlyLine = {
  kind: 'head' | 'item' | 'sub' | 'total' | 'grand' | 'pct'
  label: string
  code?: string
  values: (number | null)[]   // one per month given; null = month not loaded, or % with no sales
  total: number | null        // across loaded months; for pct rows, total profit / total sales
}

type Vec = (number | null)[]
const sumLoaded = (v: Vec): number | null =>
  v.some(x => x !== null) ? round2(v.reduce<number>((s, x) => s + (x ?? 0), 0)) : null
const combine = (a: Vec, b: Vec, f: (x: number, y: number) => number): Vec =>
  a.map((x, i) => { const y = b[i]; return x === null || y === null || y === undefined ? null : round2(f(x, y)) })
const pct = (part: Vec, whole: Vec): Vec =>
  part.map((p, i) => { const w = whole[i]; return p === null || !w ? null : round2((p / w) * 100) })
const pctTotal = (part: Vec, whole: Vec): number | null => {
  const p = sumLoaded(part), w = sumLoaded(whole)
  return p === null || !w ? null : round2((p / w) * 100)
}

// `months[i]` is the account net map (debit − credit) for month i, or null when
// that month is not loaded (a future month of the current year).
export function monthlyLines(accounts: AccountLike[], months: (Map<string, number> | null)[]): MonthlyLine[] {
  const base: Vec = months.map(m => (m ? 0 : null))
  const line = (kind: MonthlyLine['kind'], label: string, values: Vec, code?: string): MonthlyLine =>
    ({ kind, label, code, values, total: sumLoaded(values) })
  const section = (s: PlSection) => {
    const sign = s === 'cost' || s === 'opex' ? 1 : -1
    const items = accounts.filter(a => plSection(a) === s)
      .map(a => line('item', a.name, months.map(m => (m ? round2(sign * (m.get(a.code) ?? 0)) : null)), a.code))
      .filter(l => l.values.some(v => v !== null && v !== 0))
    const sum = items.reduce((acc, l) => combine(acc, l.values, (x, y) => x + y), base)
    return { items, sum }
  }
  const block = (label: string, g: { items: MonthlyLine[]; sum: Vec }, totalLabel: string, always = true): MonthlyLine[] =>
    always || g.items.length ? [line('head', label, base.map(() => null)), ...g.items, line('sub', totalLabel, g.sum)] : []

  const sales = section('sales'), cost = section('cost'), service = section('service'), other = section('other'), opex = section('opex')
  const gross = combine(sales.sum, cost.sum, (x, y) => x - y)
  const net = combine(combine(combine(gross, service.sum, (x, y) => x + y), other.sum, (x, y) => x + y), opex.sum, (x, y) => x - y)
  const netTotal = sumLoaded(net)
  return [
    ...block('Sales', sales, 'Total sales'),
    ...block('Cost of sales', cost, 'Total cost of sales'),
    line('total', 'Gross profit', gross),
    ...block('Service charge', service, 'Total service charge', false),
    ...block('Other income', other, 'Total other income', false),
    ...block('Operating expenses', opex, 'Total operating expenses'),
    line('grand', netTotal !== null && netTotal < 0 ? 'Net loss' : 'Net profit', net),
    { kind: 'pct', label: 'Gross profit % of sales', values: pct(gross, sales.sum), total: pctTotal(gross, sales.sum) },
    { kind: 'pct', label: 'Net profit % of sales', values: pct(net, sales.sum), total: pctTotal(net, sales.sum) },
  ]
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:dash`
Expected: `report math ok` printed after the earlier sections, exit 0. If a `fig` assert fails on the thousands separator, the Node ICU is the cause, not the code: check `Intl.NumberFormat('en-MY').format(1234.5)` gives `1,234.5` in `node -p`, and report if it does not.

- [ ] **Step 5: Use it from the P&L statement** — in `web/src/pages/Reports.tsx`:
  - Add `import { change, fig, plSection } from '../report-math'`.
  - Delete the local `fig` and `change` definitions (the block that starts `// Statement figures: no "RM" on every cell, negatives in brackets.` through the end of `change`).
  - In `ProfitAndLoss`, replace the five `by(...)` filters:

```ts
  const sales = by(a => plSection(a) === 'sales', -1)
  const service = by(a => plSection(a) === 'service', -1)
  const other = by(a => plSection(a) === 'other', -1)
  const cost = by(a => plSection(a) === 'cost', 1)
  const opex = by(a => plSection(a) === 'opex', 1)
```

  Keep the comment above them about service charge. Nothing else in the file changes.

- [ ] **Step 6: Build checks**

Run: `npx tsc -b && npx oxlint src && npx vite build`
Expected: clean (pre-existing warnings only).

- [ ] **Step 7: Commit**

```bash
git add web/src/report-math.ts web/src/pages/Reports.tsx web/dashboard-test.mjs
git commit -m "feat: report-math — P&L sections, figures and monthly lines, shared by the statement"
```

---

### Task 2: Real Excel files everywhere (`excel.ts`, `downloadExcel`)

**Files:**
- Create: `web/src/excel.ts`
- Modify: `web/src/lib.ts` (replace `downloadCsv`, lines 119–126), `web/package.json` (dependency), every caller: `web/src/pages/Reports.tsx` (3), `web/src/pages/Books.tsx` (1), `web/src/pages/Ledger.tsx` (2), `web/src/pages/Payroll.tsx` (3), `web/src/pages/Purchase.tsx` (1), `web/src/pages/Stock.tsx` (1)
- Test: `web/dashboard-test.mjs` (append)

**Interfaces:**
- Produces: `toSheet(rows)` in `excel.ts`; `downloadExcel(filename, rows): Promise<void>` in `lib.ts` (Task 3 uses it). `downloadCsv` no longer exists.

- [ ] **Step 1: Install the library** (in `web/`):

```bash
npm install write-excel-file@4
```

Then read `node_modules/write-excel-file/index.d.ts` for the exact names of the row/cell types and the options of the default export (`writeXlsxFile(data, { columns, fileName, sheet })`).

- [ ] **Step 2: Write the failing tests** — append to `web/dashboard-test.mjs`:

```js
// --- excel cells (slice D) ---
const { toSheet } = await import('./src/excel.ts')
const sheet = toSheet([
  ['Code', 'Account', 'Debit'],
  ['1100', 'A very long account name that goes on and on and on and on and on', 1234567.5],
  ['', 'Total', 0],
])
assert.deepEqual(sheet.data[0][0], { value: 'Code', type: String, fontWeight: 'bold' }, 'header is bold')
assert.deepEqual(sheet.data[1][2], { value: 1234567.5, type: Number, format: '#,##0.00', align: 'right' }, 'money cell')
assert.equal(sheet.data[2][0], null, 'empty string is an empty cell')
assert.deepEqual(sheet.data[2][1], { value: 'Total', type: String }, 'body text is plain')
assert.deepEqual(sheet.columns.map(c => c.width), [8, 48, 14], 'widths: clamped low, clamped high, "1,234,567.50" + 2')
assert.deepEqual(toSheet([['Qty', 3]]).data[0][1], { value: 3, type: Number, format: '#,##0.00', align: 'right', fontWeight: 'bold' }, 'header numbers are bold too')
assert.deepEqual(toSheet([]), { data: [], columns: [] })
console.log('excel cells ok')
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm run test:dash`
Expected: `Cannot find module … excel.ts`.

- [ ] **Step 4: Create `web/src/excel.ts`**

```ts
// Turns report rows into write-excel-file cells: bold header, money cells formatted
// and right-aligned, columns sized to their content. Pure, so it is tested.

export type Cell = {
  value: string | number
  type?: NumberConstructor | StringConstructor
  format?: string
  fontWeight?: 'bold'
  align?: 'right'
} | null

export const MONEY = '#,##0.00'
const moneyText = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function toSheet(rows: (string | number)[][]): { data: Cell[][]; columns: { width: number }[] } {
  const widths: number[] = []
  const data = rows.map((row, r) => row.map((v, c): Cell => {
    const text = typeof v === 'number' ? moneyText(v) : String(v)
    widths[c] = Math.max(widths[c] ?? 0, text.length)
    const bold = r === 0 ? { fontWeight: 'bold' as const } : {}
    if (typeof v === 'number') return { value: v, type: Number, format: MONEY, align: 'right', ...bold }
    if (v === '') return null
    return { value: v, type: String, ...bold }
  }))
  return { data, columns: widths.map(w => ({ width: Math.min(48, Math.max(8, w + 2)) })) }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:dash`
Expected: `excel cells ok`. The `deepEqual` on header cells depends on key presence, not order; if an assert fails on an extra `fontWeight: undefined`, build the object without spreading an empty key (the code above spreads `{}` for body rows, which adds no key).

- [ ] **Step 6: Replace `downloadCsv` in `web/src/lib.ts`** — delete the whole `downloadCsv` function and put this in its place:

```ts
import writeXlsxFile from 'write-excel-file'
import { toSheet } from './excel'

// One Excel file per report: bold header, money cells formatted, columns sized to content.
export async function downloadExcel(filename: string, rows: (string | number)[][]) {
  const { data, columns } = toSheet(rows)
  await writeXlsxFile(data, { columns, fileName: filename, sheet: 'Report' })
}
```

Move the two imports to the top of `lib.ts` with the other imports. If `tsc` rejects `data` as not assignable to the library's row type, import the library's cell type (from Step 1) and make `excel.ts`'s `Cell` a structural subset of it, or narrow with `satisfies`; never `any` or a blind `as`.

- [ ] **Step 7: Switch every caller** — in each file, change the import `downloadCsv` → `downloadExcel`, the call `downloadCsv(` → `downloadExcel(`, and the filename extension `.csv` → `.xlsx`:

| File | Calls |
|---|---|
| `Reports.tsx` | `trial-balance-${asAt}.xlsx`, `profit-and-loss-${from}-${to}.xlsx`, `balance-sheet-${asAt}.xlsx` |
| `Books.tsx` | `journal-${month}.xlsx` |
| `Ledger.tsx` | `chart-of-accounts.xlsx`, `${title…}-${code}-${from}-${to}.xlsx` |
| `Payroll.tsx` | `payroll-${run?.month}.xlsx`, `payslips…-${…}.xlsx`, `payroll-year-${year}.xlsx` |
| `Purchase.tsx` | `ap-aging-${asAt}.xlsx` |
| `Stock.tsx` | `item-costs.xlsx` |

The `ReportBar` prop stays `onCsv` (rename is out of scope); the buttons already read "Excel". Then:

```bash
grep -rn "downloadCsv\|\.csv" web/src
```

Expected: no output.

- [ ] **Step 8: Build checks**

Run: `npx tsc -b && npx oxlint src && npx vite build`
Expected: clean. Note the built chunk grows (fflate + the writer); that is expected.

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/package-lock.json web/src/excel.ts web/src/lib.ts web/src/pages web/dashboard-test.mjs
git commit -m "feat: Excel exports are real .xlsx files (write-excel-file), bold header and money formats"
```

---

### Task 3: Monthly P&L screen

**Files:**
- Modify: `web/src/pages/Reports.tsx` (new `MonthlyPl`, `ROW_STYLE` gets `pct` and explicit backgrounds)
- Modify: `web/src/App.tsx` (icon import, `PAGES` entry after Profit & Loss, route after `/reports/bs`)
- Modify: `README.md` (one bullet)

**Interfaces:**
- Consumes: `monthlyLines`, `fig`, `MonthlyLine` from `report-math.ts` (Task 1); `downloadExcel` (Task 2); `accountTotals`, `addDays`, `todayMY`, `useAccounts` from `lib.ts`; `shiftMonths` from `dashboard-math.ts`; `ReportBar`, `Ready` from `ui.tsx`.
- Produces: `export function MonthlyPl()` at route `/reports/monthly`; the page root carries `print-landscape` (Task 4 defines it).

- [ ] **Step 1: `ROW_STYLE`** — in `Reports.tsx` replace the object with explicit backgrounds (the sticky first column of the monthly table inherits them) and a `pct` style:

```ts
const ROW_STYLE = {
  item: 'bg-white',
  sub: 'bg-white font-semibold [&>td]:border-t [&>td]:border-slate-300',
  total: 'bg-slate-50 font-semibold',
  grand: 'bg-white font-bold [&>td]:border-t-2 [&>td]:!border-b-4 [&>td]:border-double [&>td]:border-slate-800',
  pct: 'bg-white text-xs text-slate-500',
}
```

- [ ] **Step 2: Add `MonthlyPl`** at the end of `Reports.tsx`:

```tsx
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const lastDayOf = (ym: string) => addDays(shiftMonths(ym + '-01', 1), -1)

// Every month of one year side by side. Twelve account_totals calls in parallel;
// months after today stay blank.
export function MonthlyPl() {
  const accounts = useAccounts(true)
  const thisYear = todayMY().slice(0, 4)
  const [year, setYear] = useState(thisYear)
  const [months, setMonths] = useState<(Map<string, number> | null)[]>([])
  const [state, setState] = useState<string | null>('loading')
  useEffect(() => {
    let stale = false
    setState('loading')
    const loaded = year === thisYear ? Number(todayMY().slice(5, 7)) : year < thisYear ? 12 : 0
    Promise.all(MONTHS.map((_, i) => {
      if (i >= loaded) return null
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`
      return accountTotals(`${ym}-01`, lastDayOf(ym))
    })).then(ms => { if (!stale) { setMonths(ms); setState(null) } },
      (e: Error) => { if (!stale) setState(e.message) })
    return () => { stale = true }
  }, [year, thisYear])

  const lines = monthlyLines(accounts, months)
  const years = Array.from({ length: 5 }, (_, i) => String(Number(thisYear) - i))
  const cell = (v: number | null, isPct: boolean) => v === null ? '' : isPct ? `${v.toFixed(1)}%` : fig(v)
  const excel = () => downloadExcel(`monthly-pl-${year}.xlsx`, [
    ['Code', 'Account', ...MONTHS, 'Total'],
    ...lines.map(l => l.kind === 'head' ? ['', l.label.toUpperCase()]
      : [l.code ?? '', l.label, ...l.values.map(v => v ?? ''), l.total ?? '']),
  ])

  return (
    <div className="space-y-4 print-landscape">
      <ReportBar title="Monthly Profit & Loss" period={`Year ${year}`} onCsv={excel}>
        <div className="w-32"><label>Year</label>
          <select value={year} onChange={e => setYear(e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </ReportBar>
      <Ready states={[state]}>
        <div className="card overflow-x-auto p-0">
          <table className="min-w-[1100px] print:min-w-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-10">RM</th>
                {MONTHS.map(m => <th key={m} className="text-right">{m}</th>)}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => l.kind === 'head'
                ? <tr key={i} className="bg-white"><td colSpan={14} className="group-head pt-5 text-xs font-bold uppercase tracking-wide text-slate-600">{l.label}</td></tr>
                : (
                  <tr key={i} className={`${ROW_STYLE[l.kind]} ${l.kind === 'grand' && l.total !== null && l.total < 0 ? 'text-rose-700' : ''}`}>
                    <td className={`sticky left-0 z-10 bg-inherit ${l.kind === 'item' ? 'pl-6' : ''}`}>
                      {l.code && <span className="mr-2 font-mono text-xs text-slate-400">{l.code}</span>}{l.label}
                    </td>
                    {l.values.map((v, j) => <td key={j} className="text-right">{cell(v, l.kind === 'pct')}</td>)}
                    <td className="text-right">{cell(l.total, l.kind === 'pct')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="muted mt-2">% is of food and drink sales. Service charge is passed on to staff, so it is left out of the margins.</p>
      </Ready>
    </div>
  )
}
```

Add `monthlyLines` to the `report-math` import and `downloadExcel` is already imported from Task 2. `th` already has `bg-slate-50` from the base styles, so the sticky header cell is opaque. The hover rule `tbody tr:hover td { bg-slate-50 }` applies to the sticky cell as well, so hover stays uniform.

Also give the `StatementTable` head row cell the same `group-head` class (replace its `print:pt-3` with `group-head`; Task 4 styles it in print):

```tsx
? <tr key={i}><td colSpan={cols} className="group-head pt-5 text-xs font-bold uppercase tracking-wide text-slate-600">{l.label}</td></tr>
```

- [ ] **Step 3: Route and menu** — in `web/src/App.tsx`:
  - Add `Columns3` to the lucide import list and `MonthlyPl` to the `./pages/Reports` import.
  - `PAGES`: insert after the `/reports/pl` entry:

```ts
  { to: '/reports/monthly', label: 'Monthly P&L', subtitle: 'Each month of the year side by side', icon: Columns3, group: 'Books', section: 'Reports', roles: REPORTS },
```

  - Routes: after `<Route path="/reports/bs" element={<BalanceSheet />} />` add

```tsx
                <Route path="/reports/monthly" element={<MonthlyPl />} />
```

- [ ] **Step 4: README** — under the list of screens near line 83 (the bullet that starts "The side menu is grouped by task"), add:

```md
- **Monthly P&L** (Books › Reports) shows every month of the year side by side with group totals and margin %; it prints landscape and exports to Excel like the other reports.
```

- [ ] **Step 5: Build checks**

Run: `npx tsc -b && npx oxlint src && npx vite build && npm run test:dash`
Expected: clean, tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Reports.tsx web/src/App.tsx README.md
git commit -m "feat: Monthly P&L — twelve months side by side, margins, landscape print, Excel"
```

---

### Task 4: One print rule set, landscape pages, two payslips per page, last orange leftovers

**Files:**
- Modify: `web/src/index.css` (`@media print` block and `@page`)
- Modify: `web/src/pages/Reports.tsx` (`StatementTable` print utilities), `web/src/pages/Payroll.tsx` (landscape roots at the `PayrollRun` and `PayrollYear` page roots; payslip cards; Net pay box), `web/src/pages/Purchase.tsx` (`ApAging` root), `web/src/pages/Dashboard.tsx` (`QuickButton`), `web/src/pages/Books.tsx` ("Showing doc" chip), `README.md`

- [ ] **Step 1: `index.css`** — replace the whole `@media print { … }` block and the `@page` rule with:

```css
@media print {
  .no-print { display: none !important; }
  body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { font-size: 10.5px; }
  th, td { padding: 3px 6px; }
  td.group-head { padding-top: 10px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .card { border: 0; box-shadow: none; border-radius: 0; overflow: visible; }
  a { color: inherit; text-decoration: none; }
  .print-landscape { page: landscape; }
  /* Payslips: two per page, a dashed cut line under the first. */
  .cut-line { border-bottom: 1px dashed #94a3b8; padding-bottom: 6mm; margin-bottom: 6mm; }
  /* Payroll: the summary and the payslips print separately. */
  body:not(.printing-slips) .slips-only { display: none !important; }
  body.printing-slips .summary-only { display: none !important; }
}
@page {
  size: A4;
  margin: 14mm 12mm 16mm;
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #64748b; }
}
@page landscape { size: A4 landscape; }
```

These rules are unlayered, so they beat Tailwind utilities (which live in `@layer utilities`) without `!important`.

- [ ] **Step 2: `StatementTable`** — in `Reports.tsx` the wrapper and table lose their print utilities:

```tsx
    <div className="card overflow-x-auto p-0">
      <table>
```

(The `group-head` class on the head cell was added in Task 3.) Also drop `print:max-w-none` from the two `max-w-4xl print:max-w-none` wrappers in `ProfitAndLoss` and `BalanceSheet` and the `print:text-[9px]` on their notes: leave `max-w-4xl` and `muted mt-2`.

- [ ] **Step 3: Landscape roots** — add `print-landscape` to the page root `<div className="space-y-4">`:
  - `Payroll.tsx` `PayrollRun` (the root above `<div className="summary-only space-y-4">`)
  - `Payroll.tsx` `PayrollYear` (the root above `<ReportBar title="Payroll Yearly Summary"`)
  - `Purchase.tsx` `ApAging` (the root above `<ReportBar title="Supplier Aging (AP)"`)

- [ ] **Step 4: Payslips two per page** — in `Payroll.tsx` `Payslips`, the slip loop becomes:

```tsx
          {slips.map((p, i) => (
            <div key={p.id} className={`card break-inside-avoid ${i % 2 ? 'print:break-after-page' : 'cut-line'}`}>
```

and the Net pay box loses the orange:

```tsx
              <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3">
                <span className="font-semibold text-slate-900">Net pay</span>
                <span className="text-lg font-bold text-slate-900 tabular-nums">{rm(p.net_pay)}</span>
              </div>
```

- [ ] **Step 5: Other orange leftovers**
  - `Dashboard.tsx` `QuickButton`: `<Icon className="size-4 text-brand" />` → `<Icon className="size-4 text-slate-500" />`.
  - `Books.tsx` "Showing doc" chip: `bg-brand-soft px-3 text-[13px] text-brand-dark` → `bg-slate-100 px-3 text-[13px] text-slate-700`.

Then `grep -rn "text-brand\|bg-brand" web/src/pages` should list only the Payroll summary name hover (`hover:text-brand`), which is a link-style hover and stays.

- [ ] **Step 6: README** — after the Monthly P&L bullet from Task 3 add:

```md
- **Print / PDF** on any report uses the browser's print dialog (choose "Save as PDF" for a file). Wide tables (Monthly P&L, payroll, supplier aging) print landscape by themselves; payslips print two to a page with a cut line.
- **Excel** buttons give real `.xlsx` workbooks with formatted money columns.
```

- [ ] **Step 7: Build checks**

Run: `npx tsc -b && npx oxlint src && npx vite build && npm run test:dash && npm run test:ui`
Expected: clean, tests pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/index.css web/src/pages README.md
git commit -m "feat: one print rule set — landscape for wide tables, two payslips per page, last orange leftovers to slate"
```

---

### Task 5: Verification (controller)

- [ ] Run in `web/`: `npm run test:dash`, `npm run test:ui`, `npm run test:db`, `npm run test:rls`, `npx tsc -b`, `npx oxlint src`, `npx vite build`.
- [ ] Final whole-branch review, one fix wave if needed, merge `ux-reports` into master with `--no-ff`, push.
