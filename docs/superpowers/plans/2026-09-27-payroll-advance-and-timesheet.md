# Payroll Salary Advance and Timesheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a salary advance so it leaves the books properly and comes back out of the next payslip by itself, and replace hand-keyed payroll hours with a monthly timesheet grid.

**Architecture:** Two additive migrations. `019_advance.sql` adds account `1310 Staff Advances`, a `staff_advances` table, an `advance_recoveries` link table that makes recovery fully reversible, and amends the payroll functions to deduct and post it. `020_timesheet.sql` adds a `timesheets` table and feeds its monthly totals into the payroll run. Front end adds two screens under Payroll and a recovery line on the payslip.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind, `react-router-dom`, Supabase (PostgREST + RPC), PGlite for database tests.

## Global Constraints

- Live production data exists and must survive untouched. Migrations are **additive**: new tables, new functions, `create or replace` of existing functions, `alter table ... add column if not exists`. No `drop table`, no `drop column`, no statement that rewrites existing rows.
  - **One permitted exception:** `payslip_view` must be dropped and recreated, because its definition starts `select p.*` and adding a column to `payslips` shifts the ordinals, which `create or replace view` forbids. A view holds no data; dropping and immediately recreating it in the same migration is safe. Nothing else may be dropped.
- Every new or replaced function is `language plpgsql security definer set search_path = public, pg_temp` (except pure helpers declared `stable`/`immutable`, which still pin `search_path`).
- **Copy existing function bodies from their CURRENT version, not the oldest one.** `statutory_for`, `create_payroll_run` and `save_payslip` were last replaced in `supabase/016_fixes2.sql`, not `004_payroll.sql`. Taking the 004 version would silently revert the EPF/SOCSO wage-base fix (EPF excludes OT and service charge; SOCSO includes them). This exact mistake already shipped once on the previous branch with `pay_supplier`.
- `journals` and `journal_lines` have insert/update/delete revoked from `authenticated`; all ledger writes go through `security definer` functions.
- Money columns are `numeric(12,2)`; hours are `numeric(5,2)`.
- Database tests run from `web/` with `npm run test:db` (harness `web/db-test.mjs`: plain sequential PGlite script, `console.log` assertions, failures start with `FAIL`). Every new migration must be added to its migration-loading list.
- **`web/.env.local` must exist for a meaningful front-end build.** Without it Vite dead-code-eliminates the whole application (the app loads via a dynamic `import('./App.tsx')` behind an env-var check) and `npm run build` passes while bundling nothing. It is gitignored and already present; do not delete it. After any front-end change, confirm your code reaches `dist/assets/App-*.js`.
- Front-end verification is `npm run lint` + `npm run build` + the bundle-content check; there is no front-end test suite. `oxlint` fails on unused imports.
- README's Step 2.4 migration list must name `019_advance.sql` and `020_timesheet.sql` by the end of the plan (Task 6).

### Traps already paid for on the previous branch — do not repeat

1. **`setDone(...)` followed by `setEditing(null)` batch into one render.** Never choose a success message at render time from `editing`; resolve the string at submit time into a `{ msg, doc }` state. See `PaymentVoucher` in `web/src/pages/Books.tsx`.
2. **A `try/catch` test that trips an earlier guard than the one under test still prints green.** For every rejection test, read the function top to bottom and confirm the setup gets past every earlier guard. State which guard each test lands on.
3. **Restore anything a test mutates** (roles, `cleared_on`, `accounts.active`) so later assertions are unaffected.
4. **A shared `error` state rendered in list mode must be cleared when leaving a form**, or a stale submit failure appears over a healthy list.

---

### Task 1: Advance tables and recording an advance

**Files:**
- Create: `supabase/019_advance.sql`
- Modify: `web/db-test.mjs` (append)

**Interfaces:**
- Consumes: `post_journal`, `my_role()`, `is_office()`, `employees`.
- Produces: account `1310`; tables `staff_advances`, `advance_recoveries`; view `advance_balances`; functions `record_advance(p_employee bigint, p_date date, p_amount numeric, p_from text, p_note text) returns bigint` and `delete_advance(p_id bigint) returns void`.

Recovery is modelled as a link table rather than a running total on the advance. That makes cancelling a payroll run a plain `delete from advance_recoveries where run_id = ...`, with the outstanding figure always derived and never drifting.

**This deviates from the spec deliberately.** The spec proposed a `recovered numeric` column on `staff_advances`, incremented on approve. That works until a run is cancelled, when the decrement has to be worked out again from figures that may since have changed — the kind of reversal that silently drifts. Deriving outstanding from recorded recoveries cannot drift, and costs one small table. Everything the spec promised behaviourally is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `web/db-test.mjs`:

```js
// ---- 019: staff salary advances ----
await db.exec(fs.readFileSync(new URL('../supabase/019_advance.sql', import.meta.url), 'utf8'))
await db.exec(`update profiles set role='owner'`)

const emp = (await db.query(`insert into employees (name, pay_type, rate) values ('Ahmad', 'monthly', 2000) returning id`)).rows[0].id
const adv = (await db.query(`select record_advance(${emp}, '2026-10-05', 600, '1000', 'Advance for rent') id`)).rows[0].id
const advRow = (await db.query(`select a.amount::float amount, j.source, j.doc_no,
  (select sum(l.debit)::float from journal_lines l where l.journal_id=a.journal_id and l.account='1310') dr,
  (select sum(l.credit)::float from journal_lines l where l.journal_id=a.journal_id and l.account='1000') cr
  from staff_advances a join journals j on j.id=a.journal_id where a.id=${adv}`)).rows[0]
console.log(advRow.amount === 600 && advRow.dr === 600 && advRow.cr === 600 && advRow.source === 'advance'
  ? 'advance recorded ok' : 'FAIL advance ' + JSON.stringify(advRow))

const advBal = (await db.query(`select outstanding::float o from advance_balances where id=${adv}`)).rows[0].o
console.log(advBal === 600 ? 'advance outstanding ok' : 'FAIL advance outstanding ' + advBal)

// Money must come from cash, petty cash or bank.
try { await db.query(`select record_advance(${emp}, '2026-10-05', 100, '6000', null)`)
  console.log('FAIL: advance paid from an expense account') }
catch (e) { console.log('advance from a non-money account rejected:', e.message) }

// A zero or negative advance is meaningless.
try { await db.query(`select record_advance(${emp}, '2026-10-05', 0, '1000', null)`)
  console.log('FAIL: zero advance accepted') }
catch (e) { console.log('zero advance rejected:', e.message) }

// Only owner or accountant may hand out an advance.
await db.exec(`update profiles set role='manager'`)
try { await db.query(`select record_advance(${emp}, '2026-10-05', 100, '1000', null)`)
  console.log('FAIL: manager recorded an advance') }
catch (e) { console.log('manager blocked from advances:', e.message) }
await db.exec(`update profiles set role='owner'`)

// Deleting an untouched advance takes its journal with it.
const adv2 = (await db.query(`select record_advance(${emp}, '2026-10-06', 50, '1010', null) id`)).rows[0].id
const adv2j = (await db.query(`select journal_id from staff_advances where id=${adv2}`)).rows[0].journal_id
await db.query(`select delete_advance(${adv2})`)
const gone = (await db.query(`select
  (select count(*)::int from staff_advances where id=${adv2}) a,
  (select count(*)::int from journals where id=${adv2j}) j`)).rows[0]
console.log(gone.a === 0 && gone.j === 0 ? 'advance deleted ok' : 'FAIL advance delete ' + JSON.stringify(gone))
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm run test:db
```

Expected: `ENOENT` on `019_advance.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/019_advance.sql`:

```sql
-- DYRB Back Office: staff salary advances (019)
-- Run in Supabase SQL Editor after 018_docedit.sql.
--
-- An advance is money lent to a staff member before payday. It leaves the till
-- straight away and is owed back, so it sits as an asset in 1310 until it is
-- taken out of a payslip. Recovery is recorded per run in advance_recoveries,
-- so cancelling a payroll run puts the balance back by itself.

insert into accounts (code, name, type) values
  ('1310', 'Staff Advances', 'asset')
on conflict (code) do nothing;

create table if not exists staff_advances (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees,
  date date not null,
  amount numeric(12,2) not null check (amount > 0),
  journal_id bigint not null references journals,
  note text,
  created_at timestamptz not null default now()
);

-- How much of each advance has been taken back, and by which payroll run.
create table if not exists advance_recoveries (
  advance_id bigint not null references staff_advances on delete cascade,
  run_id bigint not null references payroll_runs on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  primary key (advance_id, run_id)
);

alter table staff_advances enable row level security;
alter table advance_recoveries enable row level security;
create policy "office reads all, staff read own" on staff_advances for select
  using (is_office() or exists (select 1 from employees e where e.id = employee_id and e.profile_id = auth.uid()));
create policy "office reads" on advance_recoveries for select using (is_office());
revoke insert, update, delete on staff_advances, advance_recoveries from anon, authenticated;

-- Outstanding per advance, oldest first.
create or replace view advance_balances with (security_invoker = true) as
  select a.id, a.employee_id, a.date, a.amount, a.note, a.journal_id,
         a.amount - coalesce((select sum(r.amount) from advance_recoveries r where r.advance_id = a.id), 0) as outstanding
  from staff_advances a;

create or replace function record_advance(p_employee bigint, p_date date, p_amount numeric,
                                          p_from text, p_note text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint; adv bigint; who text;
begin
  if my_role() not in ('owner', 'accountant') then
    raise exception 'Only owner or accountant can give a salary advance'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount'; end if;
  if p_from not in ('1000', '1010', '1100') then
    raise exception 'Pay the advance from cash, petty cash or bank'; end if;
  select name into who from employees where id = p_employee;
  if who is null then raise exception 'Staff member not found'; end if;

  j := post_journal(p_date, 'Salary advance – ' || who, 'advance', null, null,
    jsonb_build_array(jsonb_build_object('account', '1310', 'debit', p_amount, 'memo', p_note),
                      jsonb_build_object('account', p_from, 'credit', p_amount)));
  insert into staff_advances (employee_id, date, amount, journal_id, note)
    values (p_employee, p_date, p_amount, j, nullif(p_note, '')) returning id into adv;
  return adv;
end $$;

-- An advance can only be removed while none of it has been taken back.
create or replace function delete_advance(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint;
begin
  if my_role() not in ('owner', 'accountant') then
    raise exception 'Only owner or accountant can remove an advance'; end if;
  if exists (select 1 from advance_recoveries where advance_id = p_id) then
    raise exception 'Part of this advance has already been taken back on a payslip'; end if;
  select journal_id into j from staff_advances where id = p_id;
  if j is null then raise exception 'Advance not found'; end if;
  delete from staff_advances where id = p_id;
  delete from journals where id = j;
end $$;
```

Note `doc_prefix` in `supabase/015_fixes.sql` maps sources to document prefixes. Check whether `'advance'` needs adding there; if unmapped sources fall back to a default, leave it, and say in your report which it was.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm run test:db
```

Expected: `advance recorded ok`, `advance outstanding ok`, `advance deleted ok`, plus three rejection lines. No line begins with `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add supabase/019_advance.sql web/db-test.mjs
git commit -m "feat: record a staff salary advance against account 1310"
```

---

### Task 2: Recovering the advance through payroll

**Files:**
- Modify: `supabase/019_advance.sql` (append)
- Modify: `web/db-test.mjs` (append)

**Interfaces:**
- Consumes: `staff_advances`, `advance_recoveries`, `advance_balances`, `payslips`, `payslip_view`, `create_payroll_run`, `save_payslip`, `approve_payroll_run`, `cancel_payroll_run`.
- Produces: column `payslips.advance_recovery`; rebuilt `payslip_view` including `advance_recovery` in `net_pay`; `create or replace` versions of `create_payroll_run`, `save_payslip`, `approve_payroll_run`, `cancel_payroll_run`.

The rule is **deduct the full outstanding advance from the next payroll**, capped at that month's net pay so it can never drive pay negative. Whatever the cap leaves behind is simply still outstanding and comes off the following month. There is no repayment schedule anywhere.

- [ ] **Step 1: Write the failing test**

Append to `web/db-test.mjs`:

```js
// Advance recovery: the whole outstanding amount comes off the next payroll.
const run1 = (await db.query(`select create_payroll_run('2026-10-01', '2026-10-31') id`)).rows[0].id
const slip1 = (await db.query(`select id from payslips where run_id=${run1} and employee_id=${emp}`)).rows[0].id
await db.query(`select save_payslip(${slip1}, '{}'::jsonb, true)`)
const rec1 = (await db.query(`select advance_recovery::float ar, net_pay::float net, gross::float gross
  from payslip_view where id=${slip1}`)).rows[0]
console.log(rec1.ar === 600 ? 'advance recovery on payslip ok' : 'FAIL recovery ' + JSON.stringify(rec1))

// Approving posts the credit to 1310 and marks the advance recovered.
const pj = (await db.query(`select approve_payroll_run(${run1}) j`)).rows[0].j
const posted = (await db.query(`select
  (select coalesce(sum(l.credit),0)::float from journal_lines l where l.journal_id=${pj} and l.account='1310') cr,
  (select outstanding::float from advance_balances where id=${adv}) o`)).rows[0]
console.log(posted.cr === 600 && posted.o === 0
  ? 'advance recovery posted ok' : 'FAIL recovery posted ' + JSON.stringify(posted))

// The payroll journal still balances with the extra line.
const bal1 = (await db.query(`select coalesce(sum(debit-credit),0)::float d from journal_lines where journal_id=${pj}`)).rows[0].d
console.log(bal1 === 0 ? 'payroll journal balances with advance ok' : 'FAIL payroll balance ' + bal1)

// Cancelling the run puts the advance back.
await db.query(`select cancel_payroll_run(${run1})`)
const back = (await db.query(`select outstanding::float o from advance_balances where id=${adv}`)).rows[0].o
console.log(back === 600 ? 'advance restored on cancel ok' : 'FAIL advance restore ' + back)
await db.query(`select delete_payroll_run(${run1})`)

// A big advance is capped at net pay and the rest carries forward.
const emp2 = (await db.query(`insert into employees (name, pay_type, rate, epf_on, socso_on, eis_on)
  values ('Siti', 'monthly', 1500, false, false, false) returning id`)).rows[0].id
const bigAdv = (await db.query(`select record_advance(${emp2}, '2026-11-02', 2000, '1100', null) id`)).rows[0].id
const run2 = (await db.query(`select create_payroll_run('2026-11-01', '2026-11-30') id`)).rows[0].id
const slip2 = (await db.query(`select id from payslips where run_id=${run2} and employee_id=${emp2}`)).rows[0].id
await db.query(`select save_payslip(${slip2}, '{}'::jsonb, true)`)
const capped = (await db.query(`select advance_recovery::float ar, net_pay::float net from payslip_view where id=${slip2}`)).rows[0]
console.log(capped.ar === 1500 && capped.net === 0
  ? 'advance capped at net pay ok' : 'FAIL cap ' + JSON.stringify(capped))
await db.query(`select approve_payroll_run(${run2})`)
const carried = (await db.query(`select outstanding::float o from advance_balances where id=${bigAdv}`)).rows[0].o
console.log(carried === 500 ? 'advance remainder carried forward ok' : 'FAIL carry ' + carried)
```

`net === 0` is the assertion that matters most: it proves the cap, not just the arithmetic. If the cap were missing, net pay would be −500.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm run test:db
```

Expected: `column "advance_recovery" does not exist`.

- [ ] **Step 3: Append the recovery machinery**

Append to `supabase/019_advance.sql`.

First the column and the rebuilt view. `payslip_view` is dropped and recreated because its `select p.*` means a new column on `payslips` shifts the ordinals, which `create or replace view` rejects. Copy the rest of the definition exactly from `supabase/004_payroll.sql` and add only `advance_recovery` to `net_pay`:

```sql
alter table payslips add column if not exists advance_recovery numeric(12,2) not null default 0;

drop view if exists payslip_view;
create view payslip_view with (security_invoker = true) as
  select p.*, e.name, e.employee_no, e.id_no, e.is_local, e.position, e.bank_name, e.bank_account,
         e.epf_no, e.socso_no, e.tax_no, e.profile_id, r.month, r.pay_date, r.status,
         (p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave) as gross,
         (p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave
          - p.epf_employee - p.socso_employee - p.eis_employee - p.pcb - p.other_deduction
          - p.advance_recovery) as net_pay,
         (p.epf_employer + p.socso_employer + p.eis_employer) as employer_cost
  from payslips p
  join employees e on e.id = p.employee_id
  join payroll_runs r on r.id = p.run_id;
```

Then the helper that works out what to deduct. Net-before-advance is the cap:

```sql
-- What this payslip should take back: everything still owed, but never more
-- than the pay left after tax and the other deductions.
create or replace function advance_to_recover(p_payslip bigint) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p payslips; owed numeric; room numeric;
begin
  select * into p from payslips where id = p_payslip;
  if p.id is null then return 0; end if;
  select coalesce(sum(b.outstanding), 0) into owed from advance_balances b
    where b.employee_id = p.employee_id and b.outstanding > 0
      and b.date <= (select (r.month + interval '1 month' - interval '1 day')::date
                       from payroll_runs r where r.id = p.run_id);
  room := p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave
          - p.epf_employee - p.socso_employee - p.eis_employee - p.pcb - p.other_deduction;
  return greatest(least(owed, room), 0);
end $$;
```

Now `create or replace` the four payroll functions. **Copy `create_payroll_run` and `save_payslip` from `supabase/016_fixes2.sql` (lines 51–114), NOT from `004_payroll.sql`** — the 016 versions carry the corrected EPF/SOCSO wage bases (`epf_wage` excludes OT and service charge; `socso_wage` includes them). Add to each, as the last statement before `end`, a refresh of the recovery figure:

```sql
  update payslips set advance_recovery = advance_to_recover(id) where id = p_id;
```

For `create_payroll_run`, which inserts many payslips, set it once after the loop instead:

```sql
  update payslips set advance_recovery = advance_to_recover(id) where run_id = run;
```

`approve_payroll_run`: copy the body from `supabase/004_payroll.sql`, add `coalesce(sum(advance_recovery), 0) adv` to the totals `select`, add the credit line, and write the recovery rows. Oldest advance first, so the longest-standing debt clears first:

```sql
  if t.adv > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object(
      'account', '1310', 'credit', t.adv, 'memo', 'Salary advance recovered'));
  end if;
```

and, after the run is marked approved, for each payslip with a recovery, walk that employee's outstanding advances oldest first:

```sql
  for slip in select s.id, s.employee_id, s.advance_recovery from payslips s
              where s.run_id = p_id and s.advance_recovery > 0 loop
    left_to_take := slip.advance_recovery;
    for b in select * from advance_balances
             where employee_id = slip.employee_id and outstanding > 0 order by date, id loop
      exit when left_to_take <= 0;
      take := least(left_to_take, b.outstanding);
      insert into advance_recoveries (advance_id, run_id, amount) values (b.id, p_id, take);
      left_to_take := left_to_take - take;
    end loop;
  end loop;
```

Declare `slip record; b record; left_to_take numeric; take numeric;` alongside the existing declarations. The loop variable is named `slip`, not `ps`, because `ps` is already the table alias inside that same query and plpgsql would resolve the reference ambiguously.

Order matters in `save_payslip`: the recovery refresh must be the **last** statement, after the statutory recalculation, because the cap is net pay and net pay depends on EPF, SOCSO, EIS and PCB being final.

`cancel_payroll_run`: copy from `004_payroll.sql` and add, before the status reset:

```sql
  delete from advance_recoveries where run_id = p_id;
```

That single line is the whole reversal — outstanding is derived, so it corrects itself.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm run test:db
```

Expected: `advance recovery on payslip ok`, `advance recovery posted ok`, `payroll journal balances with advance ok`, `advance restored on cancel ok`, `advance capped at net pay ok`, `advance remainder carried forward ok`. No `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add supabase/019_advance.sql web/db-test.mjs
git commit -m "feat: take a salary advance back out of the next payslip, capped at net pay"
```

---

### Task 3: Timesheet table feeding payroll hours

**Files:**
- Create: `supabase/020_timesheet.sql`
- Modify: `web/db-test.mjs` (append)

**Interfaces:**
- Consumes: `employees`, `payroll_rates` (`ot_normal`), `create_payroll_run`, `save_payslip`.
- Produces: table `timesheets`; view `timesheet_months`; `create or replace` versions of `create_payroll_run` and `save_payslip` that seed `hours` and `ot_hours` from the month's timesheet.

Unlike the ledger tables, `timesheets` is written directly under RLS rather than through an RPC. It has no accounting consequence of its own — it only feeds figures a human still reviews and can override before approving the run.

- [ ] **Step 1: Write the failing test**

Append to `web/db-test.mjs`:

```js
// ---- 020: timesheet feeds the payroll run ----
await db.exec(fs.readFileSync(new URL('../supabase/020_timesheet.sql', import.meta.url), 'utf8'))
await db.exec(`update profiles set role='owner'`)

const hourly = (await db.query(`insert into employees (name, pay_type, rate, epf_on, socso_on, eis_on)
  values ('Part timer', 'hourly', 10, false, false, false) returning id`)).rows[0].id
await db.exec(`insert into timesheets (employee_id, work_date, hours, ot_hours) values
  (${hourly}, '2026-12-01', 8, 0), (${hourly}, '2026-12-02', 7.5, 2), (${hourly}, '2026-12-03', 6, 0)`)

const run3 = (await db.query(`select create_payroll_run('2026-12-01', '2026-12-31') id`)).rows[0].id
const slip3 = (await db.query(`select id from payslips where run_id=${run3} and employee_id=${hourly}`)).rows[0].id
const ts = (await db.query(`select hours::float h, ot_hours::float ot, basic::float basic, ot_amount::float ota
  from payslip_view where id=${slip3}`)).rows[0]
// 21.5 hours x RM10 = 215; 2 OT hours x RM10 x 1.5 = 30
console.log(ts.h === 21.5 && ts.ot === 2 && ts.basic === 215 && ts.ota === 30
  ? 'timesheet feeds payroll ok' : 'FAIL timesheet ' + JSON.stringify(ts))

// A hand override survives a later save.
await db.query(`select save_payslip(${slip3}, '{"hours":20}'::jsonb, true)`)
const overridden = (await db.query(`select hours::float h, basic::float basic from payslip_view where id=${slip3}`)).rows[0]
console.log(overridden.h === 20 && overridden.basic === 200
  ? 'timesheet override ok' : 'FAIL override ' + JSON.stringify(overridden))

// One row per person per day.
try { await db.exec(`insert into timesheets (employee_id, work_date, hours) values (${hourly}, '2026-12-01', 5)`)
  console.log('FAIL: duplicate timesheet day accepted') }
catch (e) { console.log('duplicate timesheet day rejected:', e.message) }

// Negative hours are a typo, not a correction.
try { await db.exec(`insert into timesheets (employee_id, work_date, hours) values (${hourly}, '2026-12-04', -3)`)
  console.log('FAIL: negative hours accepted') }
catch (e) { console.log('negative hours rejected:', e.message) }
await db.query(`select delete_payroll_run(${run3})`)
```

The override test is the important one: seeding must happen when the run is created, not on every save, or a corrected figure would be overwritten the moment anything else on the payslip changed.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm run test:db
```

Expected: `ENOENT` on `020_timesheet.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/020_timesheet.sql`:

```sql
-- DYRB Back Office: monthly timesheet (020)
-- Run in Supabase SQL Editor after 019_advance.sql.
--
-- Hours used to be typed straight onto the payslip with nothing behind them.
-- They now come from a grid of days, so there is a record of where the figure
-- came from. It is a timesheet, not a clock — nobody taps in or out. Every
-- figure can still be typed over on the payslip before the run is approved.

create table if not exists timesheets (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees,
  work_date date not null,
  hours numeric(5,2) not null default 0 check (hours >= 0),
  ot_hours numeric(5,2) not null default 0 check (ot_hours >= 0),
  note text,
  unique (employee_id, work_date)
);

alter table timesheets enable row level security;
create policy "office reads all, staff read own" on timesheets for select
  using (is_office() or exists (select 1 from employees e where e.id = employee_id and e.profile_id = auth.uid()));
create policy "office writes" on timesheets for all
  using (is_office()) with check (is_office());

-- Monthly totals per person, for the payroll run to pick up.
create or replace view timesheet_months with (security_invoker = true) as
  select employee_id, date_trunc('month', work_date)::date as month,
         sum(hours) as hours, sum(ot_hours) as ot_hours
  from timesheets group by employee_id, date_trunc('month', work_date)::date;
```

Then `create or replace create_payroll_run`, copying the version you produced in Task 2 (which is itself based on `016_fixes2.sql`) and seeding the timesheet figures when each payslip is inserted. Inside the employee loop, before the insert:

```sql
    select coalesce(t.hours, 0), coalesce(t.ot_hours, 0) into ts_hours, ts_ot
      from timesheet_months t where t.employee_id = e.id and t.month = first_day;
    if not found then ts_hours := 0; ts_ot := 0; end if;
```

Include `hours`, `ot_hours` and `ot_amount` in the insert. Overtime pays at `ot_normal` against the hourly rate:

```sql
    ot_pay := round(ts_ot * (case when e.pay_type = 'hourly' then e.rate else 0 end) * rates.ot_normal, 2);
```

Declare `ts_hours numeric; ts_ot numeric; ot_pay numeric; rates payroll_rates;` and `select * into rates from payroll_rates where id = 1;` once before the loop.

For an hourly employee the existing `save_payslip` recalculation already sets `basic = hours × hourly_rate`, so seeding `hours` is enough for basic pay to follow. Set `basic` at insert time too, so the figure is right before anyone opens the payslip.

Monthly staff get `ot_amount` of 0 from this seeding, because they have no hourly rate; their OT is entered by hand as it is today. Say so in a comment.

**Do not** add timesheet seeding to `save_payslip` — seeding belongs to run creation only. Re-seeding on save would throw away a hand correction, which the test above checks for.

Rest-day (2×) and public-holiday (3×) rates exist in `payroll_rates` but need a holiday calendar to apply automatically; that is out of scope, and those cases are handled by overriding `ot_amount` on the payslip. Note this in the migration header.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm run test:db
```

Expected: `timesheet feeds payroll ok`, `timesheet override ok`, plus two rejection lines. No `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add supabase/020_timesheet.sql web/db-test.mjs
git commit -m "feat: seed payroll hours and overtime from a monthly timesheet"
```

---

### Task 4: Staff Advance screen

**Files:**
- Modify: `web/src/pages/Payroll.tsx` (add a `StaffAdvances` component and export it)
- Modify: `web/src/App.tsx` (route and nav entry)

**Interfaces:**
- Consumes: `record_advance`, `delete_advance`, view `advance_balances`, `employees`.
- Produces: exported `StaffAdvances({ role }: { role: Role })`; route `/payroll/advances`.

- [ ] **Step 1: Build the screen**

Follow the list + form shape used by `PurchaseInvoices` in `web/src/pages/Purchase.tsx` and the `{ msg, doc }` success state used by `PaymentVoucher` in `web/src/pages/Books.tsx`. Resolve the success message at submit time — see trap 1 in Global Constraints.

The list shows, per advance: date, staff name, amount, outstanding, and the note. Outstanding comes from `advance_balances`, so a partly recovered advance reads honestly. Group or sort by staff name, newest first within each.

A row offers delete only when `outstanding === amount` (nothing recovered yet); the database enforces the same rule, so the button is hidden rather than failing late. Only owner and accountant see the new-advance button and the delete, matching `record_advance`'s own check — read how `canEdit` is derived in `Employees` in the same file and reuse that expression.

The form takes: staff member (select from active employees), date, amount, paid from (Cash in Drawer / Petty Cash / Bank — the three `record_advance` accepts), and an optional note. On save, call:

```ts
const { data, error } = await supabase.rpc('record_advance', {
  p_employee: Number(f.employee), p_date: f.date, p_amount: round2(Number(f.amount)),
  p_from: f.from, p_note: f.note || null,
})
if (error) throw new Error(error.message)
```

Show a plain sentence above the form explaining what this does, in the app's existing voice — that the money leaves the till now and comes back out of the next payslip by itself.

If the person already has an advance outstanding, show it next to the staff select once one is chosen, so nobody accidentally stacks a second advance without realising.

- [ ] **Step 2: Wire the route and nav**

In `web/src/App.tsx`, add to `PAGES`, inside the `Payroll` group and after the `Staff` entry:

```tsx
{ to: '/payroll/advances', label: 'Staff Advance', subtitle: 'Money lent before payday, taken back on the payslip', icon: HandCoins, group: 'Payroll', roles: OFFICE },
```

`HandCoins` is already imported in that file. Add the route beside the other payroll routes:

```tsx
<Route path="/payroll/advances" element={<StaffAdvances role={profile.role} />} />
```

and add `StaffAdvances` to the existing `./pages/Payroll` import.

- [ ] **Step 3: Verify**

```bash
cd web && npm run lint && npm run build
```

Then confirm the code reached the bundle:

```bash
cd web && node -e "const fs=require('fs');const d='dist/assets';console.log(fs.readdirSync(d).filter(f=>f.startsWith('App')).map(f=>fs.readFileSync(d+'/'+f,'utf8').includes('Salary advance')))"
```

Must print `[ true ]`. Also confirm `npm run test:db` still passes.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Payroll.tsx web/src/App.tsx
git commit -m "feat: give out and track staff salary advances on screen"
```

---

### Task 5: Timesheet grid screen

**Files:**
- Modify: `web/src/pages/Payroll.tsx` (add a `Timesheet` component and export it)
- Modify: `web/src/App.tsx` (route and nav entry)

**Interfaces:**
- Consumes: table `timesheets` (direct PostgREST reads and writes under RLS — no RPC), `employees`.
- Produces: exported `Timesheet({ role }: { role: Role })`; route `/payroll/timesheet`.

This is the one genuinely new piece of UI in the plan; everything else follows an existing pattern.

- [ ] **Step 1: Build the grid**

A month picker (`<input type="month">`, defaulting to the current month via `todayMY().slice(0, 7)`), then a table with staff down the side and the days of that month across the top. Two figures per cell — hours and OT hours — so give each day two narrow inputs stacked, or two rows per person, whichever keeps the table readable on a laptop; a phone will scroll horizontally and that is acceptable for this screen.

Show hourly staff by default with a toggle to include monthly staff, so their overtime can be logged. Load `employees` where `active`.

A right-hand column totals each person's hours and OT for the month; a bottom row totals each day.

Saving: write on blur, not on every keystroke. Upsert against the unique key:

```ts
await supabase.from('timesheets')
  .upsert({ employee_id: id, work_date: date, hours, ot_hours }, { onConflict: 'employee_id,work_date' })
```

Show a small saved/failed indicator per cell or a single status line — a failed write must be visible, not swallowed. A cell left empty means zero, not "unknown"; write `0` rather than deleting the row, so the grid round-trips predictably.

Above the grid, one plain line explaining that these hours flow into the payroll run when it is created, and that they can still be changed on the payslip afterwards.

Only office roles reach this screen at all. Within it, follow the same `canEdit` rule the other payroll screens use for who may type; everyone else sees the figures read-only.

- [ ] **Step 2: Wire the route and nav**

In `web/src/App.tsx`, add to `PAGES` in the `Payroll` group, before `Monthly Payroll`:

```tsx
{ to: '/payroll/timesheet', label: 'Timesheet', subtitle: 'Hours worked each day, feeding the monthly payroll', icon: CalendarClock, group: 'Payroll', roles: OFFICE },
```

`CalendarClock` is already imported. Add the route and the import as in Task 4.

- [ ] **Step 3: Verify**

```bash
cd web && npm run lint && npm run build
```

Bundle check with a distinctive string from your explanatory line, then `npm run test:db`.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Payroll.tsx web/src/App.tsx
git commit -m "feat: enter monthly hours on a timesheet grid"
```

---

### Task 6: Payslip display, staff view, and README

**Files:**
- Modify: `web/src/pages/Payroll.tsx` (`PayrollRun` payslip editor and printed payslip, `MyPayslips`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `payslip_view.advance_recovery`, `advance_balances`.
- Produces: nothing new.

- [ ] **Step 1: Show the recovery on the payslip**

In the payslip editor and on the printed payslip, add a deduction line reading "Salary advance recovered" with the `advance_recovery` figure, alongside the existing deductions. It is calculated, not typed — do not add it to the editable `FIELDS` list, because `advance_to_recover` owns that number.

Where a payslip's recovery was capped — that is, the employee still has an outstanding balance after this run — show a short note on that payslip saying how much is still owed and that it comes off next month. Read the remaining figure from `advance_balances` for that employee.

- [ ] **Step 2: Show the staff member their own balance**

In `MyPayslips`, show the person's outstanding advance balance if they have one. `advance_balances` is readable by the staff member for their own rows through the RLS policy added in Task 1, joined via `employees.profile_id`.

- [ ] **Step 3: Update the README**

Add `supabase/019_advance.sql` and `supabase/020_timesheet.sql` to the ordered migration list in Step 2.4, after `018_docedit.sql`.

Under **Everyday notes**, add two short bullets in the README's plain voice:
- A salary advance is recorded on the Staff Advance screen; the money leaves the till straight away and comes off the next payslip by itself, and if it is more than one month's pay the rest carries to the month after.
- Hours go on the Timesheet before the monthly payroll is created; creating the run picks them up, and anything can still be corrected on the payslip before approving.

Also extend the existing Phase line in the Status section, or add one, to record that payroll now covers advances and timesheets.

- [ ] **Step 4: Full verification**

```bash
cd web && npm run test:db && npm run test:rls && npm run test:repair && npm run lint && npm run build
```

All five must pass with no line of output starting with `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Payroll.tsx README.md
git commit -m "feat: show advance recovery on the payslip and document the new screens"
```

---

## Deployment note

`019_advance.sql` and `020_timesheet.sql` must be run in the Supabase SQL Editor, in that order, **before** the front-end deploy carrying these screens reaches users. Both are additive and use `create or replace` / `if not exists` throughout, so running them early, or twice, is harmless. The one destructive-looking statement, `drop view if exists payslip_view`, is immediately followed by its recreation in the same file.

## Out of scope

- Clock-in/clock-out attendance, PIN devices, staff phone check-in, shift rostering
- A public-holiday calendar and automatic rest-day / public-holiday overtime multipliers
- Repayment schedules or instalment plans for advances
- Any change to how EPF, SOCSO, EIS or PCB are calculated
- Part 1 of the spec (dashboard rebuild), which gets its own plan
