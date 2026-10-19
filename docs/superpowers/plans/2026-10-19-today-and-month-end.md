# UX Slice B: Today and Month-end Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today tells the owner whether the month is making money and what is waiting; a new Month-end screen lists the nine close steps with live done/not-done status and a "Close month" mark.

**Architecture:** One Postgres function `month_status(p_month)` (migration `032_month_status.sql`) computes every check for a month; two tiny tables hold the owner's own marks. A pure `todoItems()` in `dashboard-math.ts` turns statuses into sentences (tested with Node asserts). `Dashboard.tsx` gains a To-do card and four re-cut tiles; `pages/MonthEnd.tsx` is a new screen at `/month-end` using the slice A shell parts (`PageActions`, `toast`, `Pill`, `MonthInput`).

**Tech Stack:** React 19, react-router-dom 7, Tailwind v4, lucide-react, Supabase (PostgREST + plpgsql), Node assert tests via `node --experimental-strip-types`, PGlite for `db-test.mjs`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-19-today-and-month-end-design.md`. Every key, sentence and rule below comes from it.
- No new npm packages. No change to any existing posting function, query, RPC or route. The only SQL is the new file `supabase/032_month_status.sql`, safe to run again (`create table if not exists`, `create or replace`, policies in `do $$ … exception when duplicate_object`), with no `$` anywhere except the `$$` delimiters.
- `month_status` reads only and raises `Not allowed` unless `is_office()`.
- Orange `#e0481c` only on primary buttons, active nav, focus ring, links. Compact density from slice A (13px text, 32px controls).
- Every task ends with `npx tsc -b`, `npx oxlint` (warnings only) and `npm run build` passing in `web/`, plus the named test scripts, then one commit on branch `ux-today` ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Dates: "today" in SQL is `(now() at time zone 'Asia/Kuala_Lumpur')::date`; in the browser `todayMY()`.

## File map

| File | Responsibility |
|---|---|
| `supabase/032_month_status.sql` (new) | `closed_days`, `month_closes`, `month_status()` |
| `web/db-test.mjs` | 032 section: builds a month and asserts the function |
| `web/src/lib.ts` | `MonthStatus` type, `monthStatus()` RPC wrapper |
| `web/src/dashboard-math.ts` | `TodoItem`, `listDays`, `todoItems` (pure) |
| `web/dashboard-test.mjs` | `todoItems` asserts |
| `web/src/pages/Dashboard.tsx` | tiles, To-do card |
| `web/src/pages/MonthEnd.tsx` (new) | the checklist screen |
| `web/src/App.tsx` | `PAGES` entry and route for `/month-end` |
| `README.md` | two notes |

---

### Task 1: `month_status` migration and database test

**Files:**
- Create: `supabase/032_month_status.sql`
- Modify: `web/db-test.mjs` (append after the 031 section, which ends with the `unsplit sales go to 4090…` line)

**Interfaces:**
- Produces `month_status(p_month date) returns jsonb` with keys `month, days_missing, days_closed, card_unsettled, card_since, timesheet_rows, active_staff, payroll{status,run_id}, accruals_posted, stock_count_posted, bank_uncleared, invoices_entered, closed_at`; tables `closed_days(day)` and `month_closes(month, invoices_entered, closed_at, updated_at)`.

- [ ] **Step 1: Branch**

```bash
cd "C:/Users/DELL/Documents/DYRB Accounting" && git checkout -b ux-today master
```

- [ ] **Step 2: Write the failing test**

Append to `web/db-test.mjs`:

```js
// ---- 032: month status for the to-do list and the Month-end checklist ----
for (let i = 0; i < 2; i++)  // safe to run again
  await db.exec(fs.readFileSync(new URL('../supabase/032_month_status.sql', import.meta.url), 'utf8'))
await db.exec(`update profiles set role='owner'`)
// June 2025 is in the past for every clock, so days_missing is deterministic. Two sales
// days with a gap, one closed day, a draft payroll, an unticked bank line.
await db.query(`select post_sales_day('2025-06-01', 100, 0, 0, 0, '[{"code":"CASH","amount":100}]'::jsonb)`)
await db.query(`select post_sales_day('2025-06-03', 100, 0, 0, 0, '[{"code":"VISA","amount":100}]'::jsonb)`)
await db.exec(`insert into closed_days (day) values ('2025-06-04')`)
await db.query(`select post_journal('2025-06-10','Rent June','pv',null,null,'[{"account":"6100","debit":500},{"account":"1100","credit":500}]'::jsonb)`)
const msRun = (await db.query(`select create_payroll_run('2025-06-01', '2025-06-30') id`)).rows[0].id
let ms = (await db.query(`select month_status('2025-06-15') s`)).rows[0].s
console.log(ms.month === '2025-06-01' ? 'month_status month ok' : 'FAIL month ' + ms.month)
console.log(ms.days_missing.length === 27 && ms.days_missing.includes('2025-06-02') && !ms.days_missing.includes('2025-06-01')
  && !ms.days_missing.includes('2025-06-03') && !ms.days_missing.includes('2025-06-04')
  ? 'missing sales days ok' : 'FAIL days_missing ' + JSON.stringify(ms.days_missing))
console.log(JSON.stringify(ms.days_closed) === '["2025-06-04"]' ? 'closed days ok' : 'FAIL days_closed ' + JSON.stringify(ms.days_closed))
console.log(Number(ms.card_unsettled) === 100 && ms.card_since === '2025-06-03' ? 'card unsettled ok' : `FAIL card ${ms.card_unsettled} ${ms.card_since}`)
console.log(ms.payroll.status === 'draft' && ms.payroll.run_id === msRun ? 'payroll draft ok' : 'FAIL payroll ' + JSON.stringify(ms.payroll))
console.log(ms.bank_uncleared >= 1 ? 'bank uncleared ok' : 'FAIL bank_uncleared ' + ms.bank_uncleared)
console.log(ms.accruals_posted === false && ms.stock_count_posted === false && ms.invoices_entered === false && ms.closed_at === null
  ? 'nothing posted yet ok' : 'FAIL flags ' + JSON.stringify(ms))
console.log(ms.active_staff > 0 && ms.timesheet_rows === 0 ? 'staff counts ok' : `FAIL staff ${ms.active_staff} ${ms.timesheet_rows}`)
// Settle the card, post accruals, tick invoices, close.
await db.query(`select post_fiuu_settlement('2025-06-05', 100, 2, 98)`)
await db.query(`select post_accruals('2025-06-01', '[{"account":"6100","amount":1,"name":"Rent"}]'::jsonb)`)
await db.exec(`insert into month_closes (month, invoices_entered, closed_at) values ('2025-06-01', true, now())
  on conflict (month) do update set invoices_entered = excluded.invoices_entered, closed_at = excluded.closed_at`)
ms = (await db.query(`select month_status('2025-06-01') s`)).rows[0].s
console.log(Number(ms.card_unsettled) === 0 && ms.card_since === null ? 'card settled ok' : `FAIL card after settle ${ms.card_unsettled}`)
console.log(ms.accruals_posted === true && ms.invoices_entered === true && ms.closed_at !== null ? 'accruals, tick and close ok' : 'FAIL after close ' + JSON.stringify(ms))
// A month that has not started has no missing days.
const future = (await db.query(`select month_status('2099-01-01') s`)).rows[0].s
console.log(future.days_missing.length === 0 && future.payroll.status === 'none' ? 'future month quiet ok' : 'FAIL future ' + JSON.stringify(future))
// Staff get nothing.
await db.exec(`update profiles set role='staff'`)
try { await db.query(`select month_status('2025-06-01')`); console.log('FAIL: staff read month_status') }
catch (e) { console.log(e.message.includes('Not allowed') ? 'staff blocked from month_status ok' : 'FAIL wrong error ' + e.message) }
await db.exec(`update profiles set role='owner'`)
```

- [ ] **Step 3: Run it to see it fail**

Run in `web/`: `npm run test:db 2>&1 | tail -5`
Expected: an error that `032_month_status.sql` cannot be read (ENOENT).

- [ ] **Step 4: Write the migration**

Create `supabase/032_month_status.sql`:

```sql
-- DYRB Back Office: month status for the Today to-do list and the Month-end checklist (032)
-- Run in Supabase SQL Editor after 031_review_fixes.sql. Safe to run again.
--
-- month_status(month) answers, in one call, every question the Today page and the
-- Month-end screen ask: which sales days are missing, is card money still unsettled,
-- where payroll stands, are accruals / stock count / bank reconciliation done.
-- Two small tables hold what only the owner knows: days the bar was shut, and the
-- owner's own marks for a month (supplier invoices all in; month closed).

create table if not exists closed_days (
  day date primary key,
  created_at timestamptz not null default now()
);

create table if not exists month_closes (
  month date primary key,                   -- always the 1st
  invoices_entered boolean not null default false,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table closed_days enable row level security;
alter table month_closes enable row level security;
do $$ begin create policy "office all" on closed_days for all using (is_office()) with check (is_office());
exception when duplicate_object then null; end $$;
do $$ begin create policy "office all" on month_closes for all using (is_office()) with check (is_office());
exception when duplicate_object then null; end $$;

create or replace function month_status(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare first_day date := date_trunc('month', p_month)::date;
        last_day date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
        today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
        card_as_at date;
        v_missing jsonb; v_closed jsonb; v_card numeric := 0; v_since date;
        v_ts int; v_staff int; v_run payroll_runs; v_bank int; v_close month_closes;
begin
  if not is_office() then raise exception 'Not allowed'; end if;

  -- Days with no sales entry and not marked closed, up to yesterday.
  select coalesce(jsonb_agg(to_char(g.d, 'YYYY-MM-DD') order by g.d), '[]'::jsonb) into v_missing
    from generate_series(first_day, least(last_day, today - 1), interval '1 day') g(d)
    where not exists (select 1 from journals j where j.source = 'sales' and j.source_ref = to_char(g.d, 'YYYY-MM-DD'))
      and not exists (select 1 from closed_days c where c.day = g.d::date);

  select coalesce(jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day), '[]'::jsonb) into v_closed
    from closed_days where day between first_day and last_day;

  -- Card takings still sitting in 1200. Fiuu pays within a few days, so money taken in
  -- the last three days is normal; money from before that should have landed.
  card_as_at := least(last_day + 7, today - 3);
  if card_as_at >= first_day then
    select coalesce(sum(l.debit - l.credit), 0) into v_card
      from journal_lines l join journals j on j.id = l.journal_id
      where l.account = '1200' and j.date <= card_as_at;
    if v_card < 0 then v_card := 0; end if;
    if v_card > 0 then
      select min(j.date) into v_since
        from journals j join journal_lines l on l.journal_id = j.id
        where j.source = 'sales' and l.account = '1200' and l.debit > 0
          and j.date between first_day and last_day;
    end if;
  end if;

  select count(*) into v_ts from timesheets where work_date between first_day and last_day;
  select count(*) into v_staff from employees where active;
  select * into v_run from payroll_runs where month = first_day;
  select count(*) into v_bank
    from journal_lines l join journals j on j.id = l.journal_id
    where l.account = '1100' and l.cleared_on is null and j.date <= last_day;
  select * into v_close from month_closes where month = first_day;

  return jsonb_build_object(
    'month', to_char(first_day, 'YYYY-MM-DD'),
    'days_missing', v_missing,
    'days_closed', v_closed,
    'card_unsettled', round(v_card, 2),
    'card_since', to_char(v_since, 'YYYY-MM-DD'),
    'timesheet_rows', v_ts,
    'active_staff', v_staff,
    'payroll', jsonb_build_object(
      'status', case when v_run.id is null then 'none'
                     when v_run.status = 'draft' then 'draft'
                     when v_run.paid_on is null then 'approved'
                     else 'paid' end,
      'run_id', v_run.id),
    'accruals_posted', exists (select 1 from journals where source = 'accrual' and source_ref = to_char(first_day, 'YYYY-MM-DD')),
    'stock_count_posted', exists (select 1 from journals where source = 'stock' and date between first_day and last_day),
    'bank_uncleared', v_bank,
    'invoices_entered', coalesce(v_close.invoices_entered, false),
    'closed_at', v_close.closed_at);
end $$;
```

- [ ] **Step 5: Run the test**

Run in `web/`: `npm run test:db 2>&1 | grep -E "FAIL|month_status|missing sales|closed days|card|payroll draft|bank uncleared|nothing posted|staff counts|accruals, tick|future month|staff blocked"`
Expected: every line ends in `ok`, no `FAIL`. (The whole suite must still print 0 FAIL: `npm run test:db 2>&1 | grep -c FAIL` → `0`.)

- [ ] **Step 6: Commit**

```bash
git add supabase/032_month_status.sql web/db-test.mjs
git commit -m "feat: month_status function, closed days and month close marks (032)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `monthStatus()` wrapper and pure `todoItems()`

**Files:**
- Modify: `web/src/lib.ts` (append after `supplierDue`)
- Modify: `web/src/dashboard-math.ts` (append at the end)
- Modify: `web/dashboard-test.mjs` (append after `console.log('due label ok')`)

**Interfaces:**
- Produces `MonthStatus` type and `monthStatus(month: string): Promise<MonthStatus>` from `lib.ts`; `TodoItem`, `listDays(days)`, `todoItems(statuses, today)` from `dashboard-math.ts` (the type `MonthStatus` is declared in `dashboard-math.ts` and re-exported from `lib.ts`, so the pure module stays React- and Supabase-free).

- [ ] **Step 1: Write the failing test**

Append to `web/dashboard-test.mjs`:

```js
// --- to-do sentences from month statuses ---
const { todoItems, listDays } = await import('./src/dashboard-math.ts')
const done = { days_missing: [], days_closed: [], card_unsettled: 0, card_since: null, timesheet_rows: 0, active_staff: 2,
  payroll: { status: 'paid', run_id: 1 }, accruals_posted: true, stock_count_posted: true, bank_uncleared: 0,
  invoices_entered: true, closed_at: '2026-10-03T00:00:00Z' }
const oct = { ...done, month: '2026-10-01' }, sep = { ...done, month: '2026-09-01' }
const T = '2026-10-19'
assert.deepEqual(todoItems([oct, sep], T), [], 'all done: nothing waiting')
assert.equal(listDays(['2026-10-16', '2026-10-17']), '16 Oct, 17 Oct')
assert.equal(listDays(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']), '10 Oct, 11 Oct, 12 Oct and 2 more')
let items = todoItems([{ ...oct, days_missing: ['2026-10-16', '2026-10-17'] }, sep], T)
assert.equal(items[0].text, 'Sales not uploaded: 16 Oct, 17 Oct')
assert.deepEqual([items[0].to, items[0].action, items[0].days], ['/sales/upload', 'Upload', ['2026-10-16', '2026-10-17']])
assert.equal(todoItems([{ ...oct, card_unsettled: 1234, card_since: '2026-10-14' }, sep], T)[0].text, 'Card takings RM 1,234.00 waiting since 14 Oct')
assert.equal(todoItems([{ ...oct, card_unsettled: 50.5, card_since: null }, sep], T)[0].text, 'Card takings RM 50.50 waiting')
assert.equal(todoItems([oct, { ...sep, card_unsettled: 99 }], T).length, 0, 'card check is for this month only')
items = todoItems([{ ...oct, payroll: { status: 'draft', run_id: 9 } }, sep], T)
assert.deepEqual([items[0].text, items[0].action], ['October payroll is a draft', 'Open'])
items = todoItems([oct, { ...sep, payroll: { status: 'approved', run_id: 8 }, closed_at: null }], T)
assert.deepEqual([items[0].text, items[0].action], ['September payroll approved, not paid', 'Pay'])
assert.equal(items.length, 1, 'payroll approved but everything else done: no "not closed" row')
items = todoItems([oct, { ...sep, closed_at: null, accruals_posted: false, bank_uncleared: 3 }], T)
assert.deepEqual([items[0].text, items[0].to, items[0].action], ['September not closed: accruals, bank', '/month-end', 'Month-end'])
assert.equal(todoItems([oct, { ...sep, closed_at: null, payroll: { status: 'none', run_id: null }, stock_count_posted: false }], T)[0].text, 'September not closed: stock count, payroll')
assert.equal(todoItems([{ ...oct, month: '2026-11-01', payroll: { status: 'draft', run_id: 1 } }, sep], T).length, 0, 'a month not started is quiet')
console.log('todo items ok')
```

- [ ] **Step 2: Run to see it fail**

Run in `web/`: `npm run test:dash`
Expected: fails at the `todoItems` import (not a function).

- [ ] **Step 3: Implement in `dashboard-math.ts`**

Append:

```ts
// ---- Today to-do list, built from month_status() (032_month_status.sql) ----
export type MonthStatus = {
  month: string                     // YYYY-MM-01
  days_missing: string[]
  days_closed: string[]
  card_unsettled: number
  card_since: string | null
  timesheet_rows: number
  active_staff: number
  payroll: { status: 'none' | 'draft' | 'approved' | 'paid'; run_id: number | null }
  accruals_posted: boolean
  stock_count_posted: boolean
  bank_uncleared: number
  invoices_entered: boolean
  closed_at: string | null
}
export type TodoItem = { key: string; text: string; to: string; action: string; days?: string[] }

// No `rm` here: lib.ts pulls in Supabase, and this file must stay testable in plain Node.
const money = (v: number) => 'RM ' + n(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dMon = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthOf = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', timeZone: 'UTC' })

// "16 Oct, 17 Oct" or, past four days, "10 Oct, 11 Oct, 12 Oct and 2 more".
export const listDays = (days: string[]) =>
  days.length <= 4 ? days.map(dMon).join(', ') : `${days.slice(0, 3).map(dMon).join(', ')} and ${days.length - 3} more`

// statuses[0] is this month, statuses[1] last month. Order of the output is the order
// the owner should deal with things: sales first, then card, payroll, then last month's close.
export function todoItems(statuses: MonthStatus[], today: string): TodoItem[] {
  const out: TodoItem[] = []
  statuses.forEach((s, i) => {
    if (s.days_missing.length > 0) {
      out.push({ key: `sales-${s.month}`, text: `Sales not uploaded: ${listDays(s.days_missing)}`, to: '/sales/upload', action: 'Upload', days: s.days_missing })
    }
    if (i === 0 && s.card_unsettled > 0) {
      out.push({ key: 'card', text: `Card takings ${money(s.card_unsettled)} waiting${s.card_since ? ` since ${dMon(s.card_since)}` : ''}`, to: '/sales/fiuu', action: 'Settle' })
    }
    if (s.month <= today) {
      if (s.payroll.status === 'draft') out.push({ key: `payroll-${s.month}`, text: `${monthOf(s.month)} payroll is a draft`, to: '/payroll/run', action: 'Open' })
      if (s.payroll.status === 'approved') out.push({ key: `payroll-${s.month}`, text: `${monthOf(s.month)} payroll approved, not paid`, to: '/payroll/run', action: 'Pay' })
    }
    if (i === 1 && !s.closed_at) {
      const open = [
        !s.accruals_posted && 'accruals',
        !s.stock_count_posted && 'stock count',
        s.bank_uncleared > 0 && 'bank',
        s.payroll.status === 'none' && 'payroll',
      ].filter((x): x is string => typeof x === 'string')
      if (open.length > 0) out.push({ key: `close-${s.month}`, text: `${monthOf(s.month)} not closed: ${open.join(', ')}`, to: '/month-end', action: 'Month-end' })
    }
  })
  return out
}
```

(`n` is the existing `const n = (v) => Number(v ?? 0) || 0` at the top of the file.)

- [ ] **Step 4: Run the test**

Run: `npm run test:dash`
Expected: `todo items ok` after the earlier ok lines.

- [ ] **Step 5: Wrapper in `lib.ts`**

Change the type import line at the top of `web/src/lib.ts` to `import type { DayAmount, MonthStatus } from './dashboard-math'` and add `export type { MonthStatus }` right under it. Append at the end of the file:

```ts
// Everything the Today to-do list and the Month-end checklist need for one month,
// from month_status() in 032_month_status.sql. Thrown, not swallowed, like accountTotals.
export async function monthStatus(month: string): Promise<MonthStatus> {
  const { data, error } = await supabase.rpc('month_status', { p_month: month })
  if (error) throw new Error('Could not check the month: ' + error.message)
  return data as MonthStatus
}
```

- [ ] **Step 6: Build and commit**

Run in `web/`: `npm run test:dash && npx tsc -b && npx oxlint && npm run build`

```bash
git add web/src/lib.ts web/src/dashboard-math.ts web/dashboard-test.mjs
git commit -m "feat: monthStatus wrapper and todoItems sentences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Today — tiles and the To-do card

**Files:**
- Modify: `web/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes `monthStatus`, `todoItems`, `listDays`, `toast`, `supabase`, `pctChange`.

- [ ] **Step 1: Imports and state**

Add to the imports: `monthStatus` and `type MonthStatus` from `../lib`; `todoItems` from `../dashboard-math`; `import { toast } from '../feedback'`; and the lucide icons `Wallet, ClipboardList, TrendingUp` (keep the existing ones; `Landmark` and `Banknote` can go if no longer used after Step 3).

After `const [loaded, setLoaded] = useState(false)` add:

```tsx
  // To-do list: this month and last month from month_status(). undefined = loading,
  // null = the RPC failed (shown as text), [] = nothing waiting.
  const [todo, setTodo] = useState<MonthStatus[] | null | undefined>(undefined)
  const [todoError, setTodoError] = useState('')
  const loadTodo = () => {
    Promise.all([monthStatus(monthStart()), monthStatus(monthStartOffset(todayMY(), 1))])
      .then(setTodo, (e: Error) => { setTodo(null); setTodoError(e.message) })
  }
  useEffect(() => { if (office && !investor) loadTodo() }, [office, investor])

  async function closeDay(day: string) {
    const { error } = await supabase.from('closed_days').insert({ day })
    if (error) return toast(error.message, { kind: 'error' })
    toast(`${dmy(day)} marked as closed`)
    loadTodo()
  }
```

Add `dmy` to the `../lib` import.

- [ ] **Step 2: Figures for the new tiles**

After the `const income = …` line add:

```tsx
  // Profit this month (to month end, like the month card) against the same days last month.
  const profit = income - costOfSales - expense
  const lastIncome = -sumCodes(accounts, lastMonth, '4000', '5000')
  const lastProfit = lastIncome - sumCodes(accounts, lastMonth, '5000', '6000') - sumCodes(accounts, lastMonth, '6000', '7000')
  const profitChange = pctChange(profit, lastProfit)
  const bank = bal(['1100'])
  const cashOnHand = bal(['1000', '1010'])
  const billsDue = due ? round2(due.dueSoon + due.overdue) : 0
```

- [ ] **Step 3: Replace the tile grid**

Replace the whole `<div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">…</div>` block with:

```tsx
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi icon={TrendingUp} label="Profit this month"
          value={loaded && !accountsError ? <span className={profit < 0 ? 'text-rose-600' : ''}>{rm(profit)}</span> : '—'}
          note={loaded ? (profitChange === null ? 'no figure to compare' : `${profitChange > 0 ? '+' : ''}${profitChange}% vs last month`) : undefined}
          tone="bg-emerald-50 text-emerald-600" />
        <Kpi icon={Wallet} label="Cash" value={kpiValue(bank + cashOnHand)}
          note={!loaded ? undefined : billsDue > 0 ? <span className="text-amber-700">{rm(billsDue)} bills due this week</span> : `Bank ${rm(bank)} · Cash ${rm(cashOnHand)}`}
          tone="bg-blue-50 text-blue-600" />
        <Kpi icon={Truck} label="Owed to suppliers" value={kpiValue(bal(['2000'], -1))} note={investor ? undefined : supplierDueNote(due)} tone="bg-rose-50 text-rose-600" />
        <Kpi icon={HandCoins} label="Owed to director" value={accountsError ? '—' : kpiValue(directorOwed)} note={accountsError ? 'Could not be loaded' : 'Paid from their own pocket'} tone="bg-violet-50 text-violet-600" />
        {!investor && openClaims.length > 0 && <Kpi icon={Receipt} label="Claims to settle" value={kpiValue(claimsTotal)} note={`${openClaims.length} pending or approved`} tone="bg-amber-50 text-amber-600" />}
      </div>
```

Change the `Kpi` prop type so `value` accepts a node: `value: ReactNode`.

- [ ] **Step 4: The To-do card**

Directly after the tile grid (before the `<div className="grid gap-6 lg:grid-cols-3">`) add:

```tsx
      {!investor && (
        <div className="card">
          <div className="flex items-center gap-2"><ClipboardList className="size-4 text-slate-400" /><h3 className="font-semibold">To do</h3></div>
          {todo === undefined ? <p className="muted mt-3">Checking…</p>
            : todo === null ? <p className="alert-error mt-3">Could not check what is waiting: {todoError}</p>
            : (() => {
              const items = todoItems(todo, todayMY())
              if (items.length === 0) return <p className="muted mt-3">Nothing waiting. Up to date.</p>
              return (
                <ul className="mt-3 divide-y divide-slate-100">
                  {items.map(it => (
                    <li key={it.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <span className="min-w-0 flex-1">{it.text}</span>
                      <Link to={it.to} className="btn-light">{it.action}</Link>
                      {it.days && (
                        <div className="basis-full text-xs text-slate-500">
                          Bar closed that day?{' '}
                          {it.days.slice(0, 8).map(d => <button key={d} type="button" className="link mr-2" onClick={() => closeDay(d)}>{dmy(d)}</button>)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            })()}
        </div>
      )}
```

- [ ] **Step 5: Build, lint, commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`. Remove any icon import oxlint now reports unused.

```bash
git add web/src/pages/Dashboard.tsx
git commit -m "feat: Today shows profit, cash and a to-do list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Month-end screen, route, README

**Files:**
- Create: `web/src/pages/MonthEnd.tsx`
- Modify: `web/src/App.tsx` (`PAGES`, imports, one `<Route>`)
- Modify: `README.md`

**Interfaces:**
- Consumes `monthStatus`, `MonthStatus`, `listDays`, `PageActions`, `toast`, `confirmDialog`, `MonthInput`, `supabase`.

- [ ] **Step 1: Create `web/src/pages/MonthEnd.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, Circle, Minus } from 'lucide-react'
import { dmy, monthStatus, rm, supabase, todayMY, type MonthStatus } from '../lib'
import { Empty, MonthInput } from '../ui'
import { PageActions } from '../page'
import { confirmDialog, toast } from '../feedback'
import { listDays } from '../dashboard-math'

type State = 'done' | 'open' | 'skip'
type Step = { name: string; state: State; detail: ReactNode; to: string; link: string }

const monthLabel = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) }
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

// The nine steps of the close, each read from month_status() (032_month_status.sql).
// "Close month" is a mark for the owner, not a lock: posting into a closed month still works.
export function MonthEnd() {
  const thisMonth = todayMY().slice(0, 7)
  const [month, setMonth] = useState<string | null>(null)   // chosen after the first look at last month
  const [s, setS] = useState<MonthStatus | null>(null)
  const [error, setError] = useState('')
  const load = (ym: string) => monthStatus(`${ym}-01`).then(st => { setS(st); setError('') }, (e: Error) => setError(e.message))

  // Default to last month until it is closed, then this month.
  useEffect(() => {
    monthStatus(`${prevMonth(thisMonth)}-01`)
      .then(st => setMonth(st.closed_at ? thisMonth : prevMonth(thisMonth)), () => setMonth(thisMonth))
  }, [thisMonth])
  useEffect(() => { if (month) { setS(null); load(month) } }, [month])

  async function setClosedDay(day: string, closed: boolean) {
    const { error } = closed
      ? await supabase.from('closed_days').insert({ day })
      : await supabase.from('closed_days').delete().eq('day', day)
    if (error) return toast(error.message, { kind: 'error' })
    toast(closed ? `${dmy(day)} marked as closed` : `${dmy(day)} is a trading day again`)
    if (month) load(month)
  }

  async function mark(patch: { invoices_entered?: boolean; closed_at?: string | null }, msg: string) {
    const { error } = await supabase.from('month_closes')
      .upsert({ month: `${month}-01`, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'month' })
    if (error) return toast(error.message, { kind: 'error' })
    toast(msg)
    if (month) load(month)
  }

  async function closeMonth() {
    if (!month) return
    if (!await confirmDialog({ title: `Close ${monthLabel(month)}?`, body: 'A mark for you that the month is done. Entries can still be posted into it.', confirmLabel: 'Close month' })) return
    mark({ closed_at: new Date().toISOString() }, `${monthLabel(month)} closed`)
  }

  const steps: Step[] = !s || !month ? [] : [
    { name: 'Sales uploaded', state: s.days_missing.length === 0 ? 'done' : 'open', to: '/sales/upload', link: 'Upload',
      detail: s.days_missing.length === 0 ? 'All days in' : <>
        Missing {listDays(s.days_missing)}
        <div className="mt-1 text-xs text-slate-500">Bar closed that day?{' '}
          {s.days_missing.slice(0, 10).map(d => <button key={d} type="button" className="link mr-2" onClick={() => setClosedDay(d, true)}>{dmy(d)}</button>)}
        </div>
      </> },
    { name: 'Card settled', state: s.card_unsettled > 0 ? 'open' : 'done', to: '/sales/fiuu', link: 'Settle',
      detail: s.card_unsettled > 0 ? `${rm(s.card_unsettled)}${s.card_since ? ` since ${dmy(s.card_since)}` : ''} still in 1200` : 'Nothing waiting' },
    { name: 'Supplier invoices entered', state: s.invoices_entered ? 'done' : 'open', to: '/ap/invoices', link: 'Invoices',
      detail: <label className="mb-0 flex items-center gap-2 font-normal">
        <input type="checkbox" checked={s.invoices_entered} onChange={e => mark({ invoices_entered: e.target.checked }, e.target.checked ? 'Invoices marked as all in' : 'Invoices tick removed')} />
        All bills for the month are in
      </label> },
    { name: 'Timesheet', state: s.active_staff === 0 ? 'skip' : s.timesheet_rows > 0 ? 'done' : 'open', to: '/payroll/timesheet', link: 'Timesheet',
      detail: s.active_staff === 0 ? 'No active staff' : `${s.timesheet_rows} day${s.timesheet_rows === 1 ? '' : 's'} entered for ${s.active_staff} staff` },
    { name: 'Payroll', state: s.active_staff === 0 ? 'skip' : s.payroll.status === 'paid' ? 'done' : 'open', to: '/payroll/run', link: 'Payroll',
      detail: s.active_staff === 0 ? 'No active staff' : { none: 'Not started', draft: 'Draft', approved: 'Approved, not paid', paid: 'Paid' }[s.payroll.status] },
    { name: 'Accruals', state: s.accruals_posted ? 'done' : 'open', to: '/gl/accruals', link: 'Accruals', detail: s.accruals_posted ? 'Posted' : 'Not posted' },
    { name: 'Stock count', state: s.stock_count_posted ? 'done' : 'open', to: '/stock/count', link: 'Stock count', detail: s.stock_count_posted ? 'Posted' : 'No count this month' },
    { name: 'Bank reconciled', state: s.bank_uncleared === 0 ? 'done' : 'open', to: '/cash/bank-rec', link: 'Bank rec',
      detail: s.bank_uncleared === 0 ? 'All ticked' : `${s.bank_uncleared} line${s.bank_uncleared === 1 ? '' : 's'} not ticked` },
    { name: 'Review P&L', state: 'open', to: `/reports/pl?from=${month}-01&to=${lastDay(month)}`, link: 'P&L', detail: 'Open the statement for the month' },
  ]
  const ready = steps.length > 0 && steps.slice(0, 8).every(st => st.state !== 'open')
  const closed = !!s?.closed_at

  const Mark = ({ state }: { state: State }) => state === 'done'
    ? <span className="grid size-6 place-items-center rounded-full bg-green-50 text-green-700"><Check className="size-4" /></span>
    : state === 'skip'
    ? <span className="grid size-6 place-items-center rounded-full bg-slate-100 text-slate-400"><Minus className="size-4" /></span>
    : <span className="grid size-6 place-items-center rounded-full bg-slate-100 text-slate-400"><Circle className="size-3.5" /></span>

  return (
    <div className="space-y-4">
      <PageActions>
        {month && closed && <button className="btn-light" onClick={() => mark({ closed_at: null }, `${monthLabel(month)} reopened`)}>Reopen</button>}
        {month && !closed && <button className="btn" disabled={!ready} title={ready ? '' : 'Finish steps 1 to 8 first'} onClick={closeMonth}>Close month</button>}
      </PageActions>
      <div className="card flex flex-wrap items-end gap-4">
        <div className="w-44"><label>Month</label>{month ? <MonthInput value={month} onChange={setMonth} /> : <input disabled value="…" />}</div>
        {closed && s?.closed_at && <p className="pb-2 text-[13px] text-green-700">Closed on {dmy(s.closed_at.slice(0, 10))}</p>}
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="card p-0">
        {!s && !error && <Empty text="Checking the month…" />}
        {s && (
          <ol className="divide-y divide-slate-100">
            {steps.map((st, i) => (
              <li key={st.name} className="flex items-start gap-3 px-4 py-3">
                <Mark state={st.state} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i + 1}. {st.name}</div>
                  <div className="text-[13px] text-slate-600">{st.detail}</div>
                </div>
                <Link to={st.to} className="btn-light shrink-0">{st.link}</Link>
              </li>
            ))}
          </ol>
        )}
        {s && s.days_closed.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Closed days: {s.days_closed.map(d => <span key={d} className="mr-2">{dmy(d)} <button type="button" className="link" onClick={() => setClosedDay(d, false)}>undo</button></span>)}
          </p>
        )}
      </div>
      <p className="muted">Closing is a mark for you. Nothing is locked: a late bill can still be posted into a closed month.</p>
    </div>
  )
}
```

Note on step 9: `/reports/pl?from=…&to=…` — `ProfitAndLoss` ignores the query today; the link still opens the P&L. Reading `from`/`to` from the URL is a two-line addition in `web/src/pages/Reports.tsx`: `const [params] = useSearchParams()` and `useState(params.get('from') ?? todayMY().slice(0, 8) + '01')` / `useState(params.get('to') ?? monthEnd())`. Do it in this task (import `useSearchParams` from `react-router-dom`).

- [ ] **Step 2: Route and menu**

In `web/src/App.tsx`: import `ListChecks` from lucide-react and `import { MonthEnd } from './pages/MonthEnd'`. Insert as the first Month-end entry in `PAGES` (before the Timesheet line):

```tsx
  { to: '/month-end', label: 'Checklist', subtitle: 'Close the month, step by step', icon: ListChecks, group: 'Month-end', roles: OFFICE },
```

Add inside the `{office && <>…</>}` route block: `<Route path="/month-end" element={<MonthEnd />} />`.

- [ ] **Step 3: README**

Under "Everyday notes" add:

```markdown
- **Today** lists what is waiting: sales days not uploaded (press the date if the bar was closed), card money not yet settled, payroll to approve or pay, and last month's close. **Month-end › Checklist** walks the nine steps of closing a month and lets you mark it closed; closing is a note for you, it does not lock anything.
- After pulling this update run `supabase/032_month_status.sql` in Supabase → SQL Editor, or Today and the Checklist will show "Could not check the month".
```

- [ ] **Step 4: Build, lint, commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`

```bash
git add web/src/pages/MonthEnd.tsx web/src/App.tsx web/src/pages/Reports.tsx README.md
git commit -m "feat: Month-end checklist screen with Close month; P&L opens on a month from the URL

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Final verification

**Files:** none new.

- [ ] **Step 1: Run everything**

Run in `web/`: `npm run test:dash && npm run test:ui && npm run test:db && npm run test:rls && npx tsc -b && npx oxlint && npm run build`
Expected: every script prints its ok lines, `grep -c FAIL` is 0 for db and rls, build succeeds.

- [ ] **Step 2: Hand over**

No commit here; the controller runs the whole-branch review, merges `ux-today` into `master` and pushes. The owner then runs `supabase/032_month_status.sql` in the SQL Editor and checks Today and Month-end on the live site.

---

## Self-review

**Spec coverage:** tables and function keys (Task 1, each key asserted); `todoItems` rules 1–4 and `listDays` (Task 2 tests cover ≤4 and >4 days, card with/without date, draft/approved, not-closed list order, not-started month, card only for this month); `monthStatus` wrapper (Task 2); Today tiles incl. Claims-only-when-open, Cash note variants, Profit note, To-do states and "Closed that day" (Task 3); Month-end route/menu/default month/nine rows/Close/Reopen/closed-days undo/muted lock note (Task 4); README (Task 4); P&L link (Task 4 note). Investors never call `month_status` (`!investor` guard).

**Placeholders:** none.

**Type consistency:** `MonthStatus` declared once in `dashboard-math.ts`, re-exported from `lib.ts`; `monthStatus(month: 'YYYY-MM-01')` used with `monthStart()` / `monthStartOffset()` (both return `-01` dates) and `${ym}-01`; `todoItems(statuses, today)` and `listDays(days)` signatures match between Tasks 2–4; `Kpi.value` widened to `ReactNode` before Task 3 passes a span.
