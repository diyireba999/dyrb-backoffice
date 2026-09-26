# Document History and Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every posting screen opens on a searchable history of what you entered, and a wrong document can be re-opened and corrected in place instead of deleted and retyped.

**Architecture:** A new additive migration `supabase/018_docedit.sql` adds `update_journal`, `update_purchase_invoice`, `update_supplier_payment` and `replace_sales_day` — all `security definer`, mirroring the permission and validation rules of the `post_*`/`create_*` functions they correspond to. On the front end a single shared `DocumentList` component replaces the ad-hoc listing code, and each posting screen becomes a three-mode component (`list` / `new` / `edit`) following the `list ↔ new` pattern `PurchaseInvoices` already uses.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind, `react-router-dom`, Supabase (PostgREST + RPC), PGlite for database tests.

## Global Constraints

- Live data exists through **23 September 2026** and must survive untouched.
- Schema changes are **additive only**: new functions, and `alter table ... add column if not exists`. No `drop table`, no `drop column`, no backfill that rewrites existing rows.
- All new SQL goes in **one file**, `supabase/018_docedit.sql`, appended to across Tasks 1–3. Every function uses `create or replace` so the file is safe to re-run.
- Every new function is `language plpgsql security definer set search_path = public, pg_temp`.
- `journals` and `journal_lines` have `insert, update, delete` revoked from `authenticated` — all writes go through `security definer` functions. Never add a direct-write RLS policy.
- Editable sources are exactly: `manual`, `pv`, `or`, `jv`, `transfer`. Everything else is edited from the screen that created it.
- Database tests run from `web/` with `npm run test:db`. The harness is `web/db-test.mjs`: plain sequential script, assertions are `console.log` lines where a failure string **must** start with `FAIL`.
- After front-end tasks, `npm run lint` and `npm run build` must both pass before committing.
- Money columns are `numeric(12,2)`; round in JS with the existing `round2` helper before sending.
- README's Step 2.4 migration list must name `018_docedit.sql` by the end of the plan (Task 8).

---

### Task 1: `update_journal` — edit a cash-book document in place

**Files:**
- Create: `supabase/018_docedit.sql`
- Modify: `web/db-test.mjs` (append a new section at end of file)

**Interfaces:**
- Consumes: existing `is_office()`, `my_role()`, `post_journal`, `set_cleared`, the deferred `journal_balanced` constraint trigger.
- Produces: `update_journal(p_id bigint, p_date date, p_description text, p_reference text, p_attachment text, p_lines jsonb) returns void`. Columns `journals.updated_at timestamptz`, `journals.updated_by uuid`.

- [ ] **Step 1: Write the failing test**

Append to the end of `web/db-test.mjs`:

```js
// ---- 018: correcting a document in place ----
await db.exec(fs.readFileSync(new URL('../supabase/018_docedit.sql', import.meta.url), 'utf8'))
await db.exec(`update profiles set role='owner'`)

const e1 = (await db.query(`select post_journal('2026-10-10','Ice','pv',null,null,
  '[{"account":"5010","debit":20},{"account":"1000","credit":20}]'::jsonb, null, 'R1') id`)).rows[0].id
const e1doc = (await db.query(`select doc_no from journals where id=${e1}`)).rows[0].doc_no
await db.query(`select update_journal(${e1}, '2026-10-11', 'Ice (corrected)', 'R2', null,
  '[{"account":"5010","debit":18},{"account":"1000","credit":18}]'::jsonb)`)
const ed = (await db.query(`select j.doc_no, j.date::text date, j.description, j.reference,
  (select sum(l.debit)::float from journal_lines l where l.journal_id=j.id) d,
  (j.updated_at is not null) stamped from journals j where j.id=${e1}`)).rows[0]
console.log(ed.doc_no === e1doc && ed.d === 18 && ed.date === '2026-10-11'
  && ed.description === 'Ice (corrected)' && ed.reference === 'R2' && ed.stamped
  ? 'edit in place ok' : 'FAIL edit ' + JSON.stringify(ed))

// An edit that does not balance must not commit.
try { await db.query(`select update_journal(${e1}, '2026-10-11','x',null,null,
  '[{"account":"5010","debit":18},{"account":"1000","credit":17}]'::jsonb)`)
  console.log('FAIL: unbalanced edit accepted') }
catch (e) { console.log('unbalanced edit rejected:', e.message) }

// A generated document is edited from its own screen, never here.
const salesJ = (await db.query(`select id from journals where source='sales' limit 1`)).rows[0].id
try { await db.query(`select update_journal(${salesJ}, '2026-10-11','x',null,null,
  '[{"account":"1000","debit":1},{"account":"4000","credit":1}]'::jsonb)`)
  console.log('FAIL: generated document edited') }
catch (e) { console.log('generated document edit rejected:', e.message) }

// Editing would silently drop bank-reconciliation ticks, so it is refused.
const clr = (await db.query(`select id from journal_lines where journal_id=${e1} and account='1000'`)).rows[0].id
await db.query(`select set_cleared(array[${clr}]::bigint[], '2026-10-31')`)
try { await db.query(`select update_journal(${e1}, '2026-10-11','x',null,null,
  '[{"account":"5010","debit":19},{"account":"1000","credit":19}]'::jsonb)`)
  console.log('FAIL: reconciled entry edited') }
catch (e) { console.log('reconciled edit rejected:', e.message) }
await db.query(`select set_cleared(array[${clr}]::bigint[], null)`)

// A supplier line belongs to Purchase Invoice / Supplier Payment.
try { await db.query(`select update_journal(${e1}, '2026-10-11','x',null,null,
  '[{"account":"5010","debit":5},{"account":"2000","credit":5}]'::jsonb)`)
  console.log('FAIL: supplier line accepted on a cash-book edit') }
catch (e) { console.log('supplier line on edit rejected:', e.message) }

// Staff may not edit at all.
await db.exec(`update profiles set role='staff'`)
try { await db.query(`select update_journal(${e1}, '2026-10-11','x',null,null,
  '[{"account":"5010","debit":18},{"account":"1000","credit":18}]'::jsonb)`)
  console.log('FAIL: staff edited a document') }
catch (e) { console.log('staff edit rejected:', e.message) }
await db.exec(`update profiles set role='owner'`)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm run test:db
```

Expected: the run stops with an error on the `fs.readFileSync` of `018_docedit.sql` — `ENOENT: no such file or directory`.

- [ ] **Step 3: Write the migration**

Create `supabase/018_docedit.sql`:

```sql
-- DYRB Back Office: correcting a document (018)
-- Run in Supabase SQL Editor after 017_corkage.sql.
--
-- Until now a wrong entry could only be deleted and retyped. These functions let a
-- document be opened and changed while keeping its number, so PV-000012 stays
-- PV-000012. Nothing here deletes or rewrites data that is already in the books.
--
-- Only documents typed in by hand may be edited this way: manual, pv, or, jv,
-- transfer. A document produced by another screen (daily sales, payroll, a claim,
-- a card settlement, a stock count) is changed on that screen and re-posted, so
-- the record and the ledger never drift apart.

alter table journals add column if not exists updated_at timestamptz;
alter table journals add column if not exists updated_by uuid references auth.users;

create or replace function update_journal(p_id bigint, p_date date, p_description text,
                                          p_reference text, p_attachment text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare src text;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  select source into src from journals where id = p_id;
  if src is null then raise exception 'Entry not found'; end if;
  if src not in ('manual', 'pv', 'or', 'jv', 'transfer') then
    raise exception 'This document is changed on the screen that created it, not here'; end if;
  if exists (select 1 from journal_lines where journal_id = p_id and cleared_on is not null) then
    raise exception 'This entry is ticked on the bank reconciliation. Untick it there first.'; end if;
  if jsonb_array_length(p_lines) < 2 then raise exception 'An entry needs at least two lines'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             join accounts a on a.code = l->>'account' where not a.active) then
    raise exception 'Account is switched off'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where l->>'account' = '2000') then
    raise exception 'Supplier entries are changed from Purchase Invoice or Supplier Payment'; end if;

  delete from journal_lines where journal_id = p_id;
  insert into journal_lines (journal_id, account, debit, credit, memo)
    select p_id, l->>'account', coalesce((l->>'debit')::numeric, 0),
           coalesce((l->>'credit')::numeric, 0), l->>'memo'
    from jsonb_array_elements(p_lines) l;
  update journals
     set date = p_date, description = p_description,
         reference = nullif(p_reference, ''),
         attachment = coalesce(p_attachment, attachment),
         updated_at = now(), updated_by = auth.uid()
   where id = p_id;
end $$;
```

Two details that matter and are easy to get wrong:

- `attachment = coalesce(p_attachment, attachment)` keeps the existing receipt photo when the edit does not upload a new one. Passing `null` must not wipe the photo.
- The balance check is *not* written here. The existing `journal_balanced` constraint trigger on `journal_lines` is `deferrable initially deferred`, so it fires at commit — after the delete-then-insert has finished. Adding a second check would be redundant and would fire at the wrong moment.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm run test:db
```

Expected: the new section prints `edit in place ok`, then five rejection lines. No line anywhere in the output begins with `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add supabase/018_docedit.sql web/db-test.mjs
git commit -m "feat: edit a cash-book document in place, keeping its doc number"
```

---

### Task 2: `update_purchase_invoice` and `update_supplier_payment`

**Files:**
- Modify: `supabase/018_docedit.sql` (append)
- Modify: `web/db-test.mjs` (append)

**Interfaces:**
- Consumes: `purchase_invoices`, `supplier_payments`, `payment_allocations`, `purchase_invoice_status`, `category_costing`, `post_journal`.
- Produces: `update_purchase_invoice(p_id bigint, p_invoice_no text, p_date date, p_due date, p_description text, p_lines jsonb) returns void` where `p_lines` is `[{"account":"5100","amount":120.50,"memo":"..."}]`; `update_supplier_payment(p_id bigint, p_date date, p_from text, p_reference text, p_allocations jsonb) returns void` where `p_allocations` is `[{"invoice_id":1,"amount":50}]`.

- [ ] **Step 1: Write the failing test**

Append to `web/db-test.mjs`:

```js
// An unpaid purchase invoice can be corrected; a paid one cannot.
const supE = (await db.query(`insert into suppliers (name) values ('Edit Test Supplier') returning id`)).rows[0].id
const invE = (await db.query(`select create_purchase_invoice(${supE}, 'A1', '2026-10-12', '2026-11-12',
  'Napkins', '[{"account":"5100","amount":100}]'::jsonb) id`)).rows[0].id
await db.query(`select update_purchase_invoice(${invE}, 'A2', '2026-10-13', '2026-11-13',
  'Napkins and straws', '[{"account":"5100","amount":80},{"account":"6900","amount":15}]'::jsonb)`)
const pie = (await db.query(`select pi.invoice_no, pi.total::float total, pi.due_date::text due,
  j.description, j.doc_no,
  (select sum(l.credit)::float from journal_lines l where l.journal_id=pi.journal_id and l.account='2000') owed
  from purchase_invoices pi join journals j on j.id=pi.journal_id where pi.id=${invE}`)).rows[0]
console.log(pie.invoice_no === 'A2' && pie.total === 95 && pie.owed === 95
  && pie.due === '2026-11-13' && pie.description === 'Napkins and straws'
  ? 'purchase invoice edit ok' : 'FAIL pi edit ' + JSON.stringify(pie))

// Cost-of-sales accounts stay barred on an edit, exactly as on create.
try { await db.query(`select update_purchase_invoice(${invE}, 'A2', '2026-10-13', '2026-11-13',
  'Beer', '[{"account":"5020","amount":50}]'::jsonb)`)
  console.log('FAIL: edit booked a purchase to a cost account') }
catch (e) { console.log('edit to cost account rejected:', e.message.split(' —')[0]) }

const payE = (await db.query(`select pay_supplier(${supE}, '2026-10-20', '1100', 'CHQ1',
  '[{"invoice_id":${invE},"amount":40}]'::jsonb) id`)).rows[0].id
try { await db.query(`select update_purchase_invoice(${invE}, 'A3', '2026-10-13', '2026-11-13',
  'x', '[{"account":"5100","amount":80}]'::jsonb)`)
  console.log('FAIL: paid invoice edited') }
catch (e) { console.log('paid invoice edit rejected:', e.message) }

// A supplier payment can be corrected and the supplier balance follows.
await db.query(`select update_supplier_payment(${payE}, '2026-10-21', '1000', 'CHQ2',
  '[{"invoice_id":${invE},"amount":60}]'::jsonb)`)
const spe = (await db.query(`select sp.amount::float amount, sp.date::text date, j.reference,
  (select sum(l.credit)::float from journal_lines l where l.journal_id=sp.journal_id and l.account='1000') fromcash,
  (select outstanding::float from purchase_invoice_status where id=${invE}) outstanding
  from supplier_payments sp join journals j on j.id=sp.journal_id where sp.id=${payE}`)).rows[0]
console.log(spe.amount === 60 && spe.fromcash === 60 && spe.reference === 'CHQ2'
  && spe.outstanding === 35
  ? 'supplier payment edit ok' : 'FAIL sp edit ' + JSON.stringify(spe))

// Over-paying an invoice on an edit is refused, same as on create.
try { await db.query(`select update_supplier_payment(${payE}, '2026-10-21', '1000', 'CHQ2',
  '[{"invoice_id":${invE},"amount":500}]'::jsonb)`)
  console.log('FAIL: edit paid more than owed') }
catch (e) { console.log('over-payment on edit rejected:', e.message) }
```

The `outstanding === 35` figure is the check that allocations were genuinely replaced rather than added to: invoice total 95, one allocation of 60, so 35 remains. If the old 40 allocation survived, outstanding would be −5.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm run test:db
```

Expected: `function update_purchase_invoice(...) does not exist`.

- [ ] **Step 3: Append both functions to the migration**

Append to `supabase/018_docedit.sql`:

```sql
-- ---------- Purchase invoice ----------
-- Same rules as create_purchase_invoice, and only while nothing has been paid
-- against it — the same condition cancel_purchase_invoice already enforces.
create or replace function update_purchase_invoice(p_id bigint, p_invoice_no text, p_date date,
                                                   p_due date, p_description text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare inv purchase_invoices; v_total numeric; bad text;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  select * into inv from purchase_invoices where id = p_id;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if exists (select 1 from payment_allocations where invoice_id = p_id) then
    raise exception 'Invoice has payments. Cancel the payment first.'; end if;
  if p_due < p_date then raise exception 'Due date cannot be before invoice date'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l->>'amount')::numeric, 0) <= 0) then
    raise exception 'Each line needs an amount'; end if;
  select string_agg(distinct l->>'account', ', ') into bad from jsonb_array_elements(p_lines) l
    where l->>'account' in (select cost_account from category_costing);
  if bad is not null then
    raise exception 'Use the stock account instead of % — the cost is booked when the item sells', bad; end if;
  select sum((l->>'amount')::numeric) into v_total from jsonb_array_elements(p_lines) l;
  if coalesce(v_total, 0) <= 0 then raise exception 'Invoice total must be more than zero'; end if;

  delete from journal_lines where journal_id = inv.journal_id;
  insert into journal_lines (journal_id, account, debit, credit, memo)
    select inv.journal_id, l->>'account', (l->>'amount')::numeric, 0, l->>'memo'
      from jsonb_array_elements(p_lines) l;
  insert into journal_lines (journal_id, account, debit, credit)
    values (inv.journal_id, '2000', 0, v_total);
  update journals set date = p_date, description = p_description,
         reference = nullif(p_invoice_no, ''), updated_at = now(), updated_by = auth.uid()
   where id = inv.journal_id;
  update purchase_invoices set invoice_no = nullif(p_invoice_no, ''), date = p_date,
         due_date = p_due, total = v_total
   where id = p_id;
end $$;

-- ---------- Supplier payment ----------
-- Allocations are replaced wholesale. The invoice's own allocation is dropped
-- first so the outstanding check measures the invoice without this payment.
create or replace function update_supplier_payment(p_id bigint, p_date date, p_from text,
                                                   p_reference text, p_allocations jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare pay supplier_payments; a jsonb; v_total numeric := 0; owing numeric;
begin
  if my_role() not in ('owner', 'accountant', 'manager') then raise exception 'Not allowed'; end if;
  select * into pay from supplier_payments where id = p_id;
  if pay.id is null then raise exception 'Payment not found'; end if;
  if p_from not in ('1000', '1010', '1100', '3000') and not (p_from >= '2500' and p_from < '2600') then
    raise exception 'Pay from cash, petty cash, bank, a director or owner capital'; end if;
  if exists (select 1 from journal_lines where journal_id = pay.journal_id and cleared_on is not null) then
    raise exception 'This payment is ticked on the bank reconciliation. Untick it there first.'; end if;

  delete from payment_allocations where payment_id = p_id;
  for a in select * from jsonb_array_elements(p_allocations) loop
    perform 1 from purchase_invoices where id = (a->>'invoice_id')::bigint for update;
    select outstanding into owing from purchase_invoice_status
      where id = (a->>'invoice_id')::bigint and supplier_id = pay.supplier_id;
    if owing is null then raise exception 'Invoice does not belong to this supplier'; end if;
    if (a->>'amount')::numeric > owing then raise exception 'Paying more than owed on an invoice'; end if;
    v_total := v_total + (a->>'amount')::numeric;
  end loop;
  if v_total <= 0 then raise exception 'Enter an amount to pay'; end if;

  insert into payment_allocations (payment_id, invoice_id, amount)
    select p_id, (a2->>'invoice_id')::bigint, (a2->>'amount')::numeric
      from jsonb_array_elements(p_allocations) a2 where (a2->>'amount')::numeric > 0;
  delete from journal_lines where journal_id = pay.journal_id;
  insert into journal_lines (journal_id, account, debit, credit) values
    (pay.journal_id, '2000', v_total, 0),
    (pay.journal_id, p_from, 0, v_total);
  update journals set date = p_date, reference = nullif(p_reference, ''),
         updated_at = now(), updated_by = auth.uid()
   where id = pay.journal_id;
  update supplier_payments set date = p_date, amount = v_total where id = p_id;
end $$;
```

Both functions must also reject a line against a switched-off account, the way `post_journal` does — they write `journal_lines` directly, so they do not inherit that check:

```sql
  if exists (select 1 from jsonb_array_elements(p_lines) l
             join accounts a on a.code = l->>'account' where not a.active) then
    raise exception 'Account is switched off'; end if;
```

(For `update_supplier_payment` the equivalent check is on `p_from`: `if not exists (select 1 from accounts where code = p_from and active) then raise exception 'Account is switched off'; end if;`)

The `p_from` allow-list matches `pay_supplier` **as it stands now** in `supabase/008_director.sql:18`, which widened the original rule to let a director pay from their own pocket (2500–2599). Checking against the older `003_accounting.sql` version would make any director-funded payment impossible to edit afterwards.

The `delete from payment_allocations` happens **before** the loop on purpose. `purchase_invoice_status.outstanding` subtracts all allocations, so leaving the old ones in place would make an unchanged payment look like an over-payment of itself.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm run test:db
```

Expected: `purchase invoice edit ok`, `supplier payment edit ok`, and three rejection lines. No `FAIL` in the output.

- [ ] **Step 5: Commit**

```bash
git add supabase/018_docedit.sql web/db-test.mjs
git commit -m "feat: correct an unpaid purchase invoice and a supplier payment"
```

---

### Task 3: `replace_sales_day`

**Files:**
- Modify: `supabase/018_docedit.sql` (append)
- Modify: `web/db-test.mjs` (append)

**Interfaces:**
- Consumes: `post_sales_day(p_date, p_sales, p_service, p_tax, p_rounding, p_payments, p_sales_lines)`, the `journals` unique constraint on `(source, source_ref)`.
- Produces: `replace_sales_day(p_date date, p_sales numeric, p_service numeric, p_tax numeric, p_rounding numeric, p_payments jsonb, p_sales_lines jsonb default null) returns bigint`.

- [ ] **Step 1: Write the failing test**

Append to `web/db-test.mjs`:

```js
// A posted day can be replaced outright, leaving exactly one sales entry for it.
await db.exec(`update profiles set role='owner'`)
await db.query(`select post_sales_day('2026-10-14', 1000, 100, 0, 0,
  '[{"code":"CASH","amount":1100}]'::jsonb)`)
await db.query(`select replace_sales_day('2026-10-14', 1200, 120, 0, 0,
  '[{"code":"CASH","amount":1320}]'::jsonb)`)
const day = (await db.query(`select count(*)::int c,
  coalesce(sum(l.debit),0)::float cash from journals j
  join journal_lines l on l.journal_id=j.id and l.account='1000'
  where j.source='sales' and j.source_ref='2026-10-14'`)).rows[0]
const dayN = (await db.query(`select count(*)::int c from journals
  where source='sales' and source_ref='2026-10-14'`)).rows[0].c
console.log(dayN === 1 && day.cash === 1320
  ? 'replace sales day ok' : `FAIL replace day ${dayN} ${day.cash}`)

// Only the owner may replace a day that is already in the books.
await db.exec(`update profiles set role='manager'`)
try { await db.query(`select replace_sales_day('2026-10-14', 900, 90, 0, 0,
  '[{"code":"CASH","amount":990}]'::jsonb)`)
  console.log('FAIL: manager replaced a posted day') }
catch (e) { console.log('manager blocked from replacing a day:', e.message) }
await db.exec(`update profiles set role='owner'`)

// A day whose cash line is reconciled must be unticked first.
const dayLine = (await db.query(`select l.id from journal_lines l join journals j on j.id=l.journal_id
  where j.source='sales' and j.source_ref='2026-10-14' and l.account='1000' limit 1`)).rows[0].id
await db.query(`select set_cleared(array[${dayLine}]::bigint[], '2026-10-31')`)
try { await db.query(`select replace_sales_day('2026-10-14', 800, 80, 0, 0,
  '[{"code":"CASH","amount":880}]'::jsonb)`)
  console.log('FAIL: replaced a reconciled day') }
catch (e) { console.log('reconciled day replace rejected:', e.message) }
await db.query(`select set_cleared(array[${dayLine}]::bigint[], null)`)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm run test:db
```

Expected: `function replace_sales_day(...) does not exist`.

- [ ] **Step 3: Append the function to the migration**

Append to `supabase/018_docedit.sql`:

```sql
-- ---------- Replacing a day's sales ----------
-- A day can only be posted once, so correcting one used to mean deleting it and
-- re-uploading as two separate steps. This does both in one transaction: if the
-- new figures are rejected, the old day is still there.
create or replace function replace_sales_day(p_date date, p_sales numeric, p_service numeric,
                                             p_tax numeric, p_rounding numeric, p_payments jsonb,
                                             p_sales_lines jsonb default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if my_role() <> 'owner' then
    raise exception 'Only the owner can replace a day that is already posted'; end if;
  if exists (select 1 from journal_lines l join journals j on j.id = l.journal_id
             where j.source = 'sales' and j.source_ref = p_date::text and l.cleared_on is not null) then
    raise exception 'This day is ticked on the bank reconciliation. Untick it there first.'; end if;
  -- The day's cost of sales belongs to the day, and goes with it.
  delete from journals where source = 'cogs' and source_ref = p_date::text;
  delete from journals where source = 'sales' and source_ref = p_date::text;
  return post_sales_day(p_date, p_sales, p_service, p_tax, p_rounding, p_payments, p_sales_lines);
end $$;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm run test:db
```

Expected: `replace sales day ok` plus two rejection lines. No `FAIL` in the output.

- [ ] **Step 5: Commit**

```bash
git add supabase/018_docedit.sql web/db-test.mjs
git commit -m "feat: replace a posted sales day in one step"
```

---

### Task 4: Shared `DocumentList`, and Payment Voucher gets history and edit

**Files:**
- Create: `web/src/DocumentList.tsx`
- Modify: `web/src/lib.ts` (append `EDITABLE_SOURCES`, `updateJournal`, `loadDocuments`)
- Modify: `web/src/pages/Books.tsx` (`PaymentVoucher`)

**Interfaces:**
- Consumes: `update_journal` (Task 1), `supabase`, `rowsOf`, `rm`, `dmy`, `openReceipt`, `Empty`, `ReportBar`.
- Produces:
  - `lib.ts`: `EDITABLE_SOURCES: string[]`; `updateJournal(id: number, date: string, description: string, lines: Line[], opts?: { reference?: string; attachment?: string }): Promise<void>`; `type DocRow`; `loadDocuments(source: string, months?: number): Promise<DocRow[]>`.
  - `DocumentList.tsx`: `<DocumentList source={...} title={...} rows={...} loading={...} onNew={...} onOpen={...} onDelete={...} canDelete={...} />`.

- [ ] **Step 1: Add the data helpers to `lib.ts`**

Append to `web/src/lib.ts`:

```ts
// Documents typed in by hand. Anything else is changed on the screen that made it.
export const EDITABLE_SOURCES = ['manual', 'pv', 'or', 'jv', 'transfer']

export async function updateJournal(id: number, date: string, description: string, lines: Line[],
                                    opts: { reference?: string; attachment?: string } = {}) {
  const { error } = await supabase.rpc('update_journal', {
    p_id: id, p_date: date, p_description: description,
    p_reference: opts.reference ?? null, p_attachment: opts.attachment ?? null, p_lines: lines,
  })
  if (error) throw new Error(error.message)
}

export type DocRow = {
  id: number; doc_no: string; date: string; description: string
  reference: string | null; source: string; attachment: string | null
  updated_at: string | null
  journal_lines: { account: string; debit: number; credit: number; memo: string | null; cleared_on: string | null }[]
}

// One document type, newest first. Default window is the last three whole months.
export async function loadDocuments(source: string, months = 3): Promise<DocRow[]> {
  const [y, m] = monthStart().split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1 - (months - 1), 1)).toISOString().slice(0, 10)
  const { data, error } = await supabase.from('journals')
    .select('id, doc_no, date, description, reference, source, attachment, updated_at, journal_lines(account, debit, credit, memo, cleared_on)')
    .eq('source', source).gte('date', from)
    .order('date', { ascending: false }).order('id', { ascending: false })
  if (error) console.error('Could not load the document list:', error.message)
  return (data as unknown as DocRow[]) ?? []
}

// Total of a document, for the list column. Debits and credits are equal.
export const docTotal = (d: DocRow) => d.journal_lines.reduce((s, l) => s + Number(l.debit), 0)

export const isReconciled = (d: DocRow) => d.journal_lines.some(l => l.cleared_on !== null)
```

- [ ] **Step 2: Write the shared list component**

Create `web/src/DocumentList.tsx`:

```tsx
import { useState } from 'react'
import { Paperclip, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { dmy, docTotal, isReconciled, openReceipt, rm, type DocRow } from './lib'
import { Empty } from './ui'

export function DocumentList({ rows, newLabel, emptyText, onNew, onEdit, onDelete, canEdit, canDelete }: {
  rows: DocRow[]
  newLabel: string
  emptyText: string
  onNew: () => void
  onEdit: (d: DocRow) => void
  onDelete: (d: DocRow) => void
  canEdit: boolean
  canDelete: boolean
}) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? rows.filter(d => d.doc_no.toLowerCase().includes(needle)
        || d.description.toLowerCase().includes(needle)
        || (d.reference ?? '').toLowerCase().includes(needle)
        || docTotal(d).toFixed(2).includes(needle))
    : rows

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <input className="w-64" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search number, description or amount" />
        <button className="btn-light ml-auto" onClick={() => window.print()}>
          <Printer className="size-4" />Print / PDF</button>
        <button className="btn" onClick={onNew}><Plus className="size-4" />{newLabel}</button>
      </div>
      <div className="card overflow-x-auto p-0">
        {shown.length === 0 && <Empty text={needle ? 'Nothing matches that search.' : emptyText} />}
        {shown.length > 0 && (
          <table>
            <thead><tr>
              <th className="w-28">Doc No</th><th className="w-24">Date</th><th>Description</th>
              <th className="text-right">Amount</th><th className="no-print"></th>
            </tr></thead>
            <tbody>
              {shown.map(d => (
                <tr key={d.id} className="hover:bg-slate-50/60">
                  <td className="font-mono text-xs font-medium">{d.doc_no}</td>
                  <td className="text-slate-500">{dmy(d.date)}</td>
                  <td>
                    <div className="font-medium">{d.description}</div>
                    {d.reference && <div className="text-xs text-slate-500">Ref: {d.reference}</div>}
                    {isReconciled(d) && <div className="text-xs text-slate-400">Ticked on the bank reconciliation</div>}
                    {d.updated_at && <div className="text-xs text-slate-400">Changed {dmy(d.updated_at.slice(0, 10))}</div>}
                  </td>
                  <td className="text-right font-medium">{rm(docTotal(d))}</td>
                  <td className="no-print whitespace-nowrap text-right">
                    {d.attachment && <button title="View receipt"
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand"
                      onClick={() => openReceipt(d.attachment!)}><Paperclip className="size-4" /></button>}
                    {canEdit && !isReconciled(d) && <button title="Edit"
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand"
                      onClick={() => onEdit(d)}><Pencil className="size-4" /></button>}
                    {canDelete && <button title="Delete"
                      className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                      onClick={() => onDelete(d)}><Trash2 className="size-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Convert `PaymentVoucher` to list / new / edit**

In `web/src/pages/Books.tsx`, replace the whole `PaymentVoucher` function. Keep `docNo`, `money` and `waiting` as they are.

```tsx
export function PaymentVoucher() {
  const accounts = useAccounts()
  const blank = { date: todayMY(), payee: '', what: '', amount: '', from: '1100', reference: '', note: '' }
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<DocRow | null>(null)
  const [rows, setRows] = useState<DocRow[]>([])
  const [f, setF] = useState(blank)
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  const load = () => { loadDocuments('pv').then(setRows) }
  useEffect(load, [])

  // A payment voucher is always one debit (what for) and one credit (paid from).
  function startEdit(d: DocRow) {
    const debit = d.journal_lines.find(l => Number(l.debit) > 0)
    const credit = d.journal_lines.find(l => Number(l.credit) > 0)
    if (!debit || !credit) return alert('This voucher has an unusual shape. Use Journal Entry to correct it.')
    const dash = d.description.indexOf(' – ')
    setEditing(d)
    setF({
      date: d.date, payee: dash >= 0 ? d.description.slice(0, dash) : d.description,
      what: debit.account, amount: String(Number(debit.debit)), from: credit.account,
      reference: d.reference ?? '', note: dash >= 0 ? d.description.slice(dash + 3) : '',
    })
    setPhoto(null); setError(''); setMode('form')
  }

  function startNew() {
    setEditing(null); setF(blank); setPhoto(null); setError(''); setMode('form')
  }

  async function remove(d: DocRow) {
    if (!confirm(`Delete ${d.doc_no}? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return alert(error.message)
    load()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const attachment = photo ? await uploadReceipt(photo) : undefined
      const desc = [f.payee, f.note].filter(Boolean).join(' – ') || 'Payment'
      const lines = [
        { account: f.what, debit: amount, memo: f.note },
        { account: f.from, credit: amount },
      ]
      if (editing) {
        await updateJournal(editing.id, f.date, desc, lines, { reference: f.reference, attachment })
        setDone({ msg: `${editing.doc_no} changed to ${rm(amount)}`, doc: editing.doc_no })
      } else {
        const id = await postJournal(f.date, desc, lines, { source: 'pv', attachment, reference: f.reference })
        setDone({ msg: `Payment of ${rm(amount)} saved`, doc: await docNo(id) })
      }
      setF({ ...blank, date: f.date, from: f.from }); setPhoto(null); setEditing(null)
      load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc}
    again={() => { setDone(null); setMode('list') }} />

  if (mode === 'list') return (
    <DocumentList rows={rows} newLabel="New payment voucher"
      emptyText="No payment vouchers in the last three months."
      onNew={startNew} onEdit={startEdit} onDelete={remove} canEdit canDelete />
  )

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <button type="button" className="link" onClick={() => setMode('list')}>← Back to list</button>
      {editing
        ? <p className="muted">Changing <b className="font-mono">{editing.doc_no}</b>. It keeps the same number.</p>
        : <p className="muted">For bills bought on credit use <b>Purchase Invoice</b>; to pay those later use <b>Supplier Payment</b>.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
        <div><label>Cheque / Ref no.</label><input value={f.reference} onChange={e => set('reference', e.target.value)} placeholder="Optional" /></div>
        <div className="sm:col-span-2"><label>Pay to</label><input value={f.payee} onChange={e => set('payee', e.target.value)} placeholder="Shop, TNB, landlord…" required /></div>
        <div><label>Account (what for)</label>
          <AccountSelect accounts={accounts} value={f.what} onChange={v => set('what', v)}
            filter={a => a.type === 'expense' || a.code === '3100' || (a.type === 'asset' && a.code >= '1300')
              || ['2300', '2310', '2320', '2330', '2340', '2600'].includes(a.code) || isDirector(a.code)} />
        </div>
        <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
        <div><label>Paid from</label>
          <select value={f.from} onChange={e => set('from', e.target.value)}>
            {accounts.filter(money).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            {accounts.filter(a => isDirector(a.code)).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name} (director paid, we owe them)</option>)}
            <option value="3000">3000 · Owner capital (not to be paid back)</option>
          </select>
        </div>
        <div><label>Description</label><input value={f.note} onChange={e => set('note', e.target.value)} placeholder="Optional" /></div>
        <div className="sm:col-span-2"><label>Receipt / bill photo</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
          {editing?.attachment && !photo && <p className="muted mt-1">A photo is already attached. Choosing a new one replaces it.</p>}
        </div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save payment'}</button>
      </div>
    </form>
  )
}
```

Update the imports at the top of `Books.tsx` — add `DocumentList`, and add `loadDocuments`, `updateJournal`, `type DocRow` to the existing `../lib` import:

```tsx
import { DocumentList } from '../DocumentList'
import { MONEY_ACCOUNTS, accountTotals, dmy, docTotal, downloadCsv, isDirector, loadDocuments, openReceipt, postJournal, rm, round2, supabase, todayMY, updateJournal, uploadReceipt, useAccounts, type Account, type DocRow } from '../lib'
```

- [ ] **Step 4: Check it compiles and lints**

```bash
cd web && npm run lint && npm run build
```

Expected: both pass with no errors. If `docTotal` or `dmy` end up unused in `Books.tsx`, remove them from the import — oxlint will flag it.

- [ ] **Step 5: Check it by hand against the real database**

```bash
cd web && npm run dev
```

Open Payment Voucher. Confirm: the list appears first; creating a voucher returns to the list with the new row present; the pencil re-opens it; changing the amount keeps the same PV number; a voucher ticked on the bank reconciliation shows the note and has no pencil.

- [ ] **Step 6: Commit**

```bash
git add web/src/DocumentList.tsx web/src/lib.ts web/src/pages/Books.tsx
git commit -m "feat: payment vouchers open on a searchable history and can be corrected"
```

---

### Task 5: Official Receipt and Bank Transfer get history and edit

**Files:**
- Modify: `web/src/pages/Books.tsx` (`OfficialReceipt`, `Transfer`)

**Interfaces:**
- Consumes: `DocumentList`, `loadDocuments`, `updateJournal`, `DocRow` (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Convert `OfficialReceipt`**

Same three-mode shape as `PaymentVoucher`. Replace the whole function:

```tsx
export function OfficialReceipt() {
  const accounts = useAccounts()
  const blank = { date: todayMY(), from: '', kind: '4900', amount: '', into: '1100', reference: '' }
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<DocRow | null>(null)
  const [rows, setRows] = useState<DocRow[]>([])
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  const load = () => { loadDocuments('or').then(setRows) }
  useEffect(load, [])

  // A receipt is one debit (received into) and one credit (what kind of money).
  function startEdit(d: DocRow) {
    const debit = d.journal_lines.find(l => Number(l.debit) > 0)
    const credit = d.journal_lines.find(l => Number(l.credit) > 0)
    if (!debit || !credit) return alert('This receipt has an unusual shape. Use Journal Entry to correct it.')
    setEditing(d)
    setF({ date: d.date, from: d.description, kind: credit.account,
           amount: String(Number(debit.debit)), into: debit.account, reference: d.reference ?? '' })
    setError(''); setMode('form')
  }

  async function remove(d: DocRow) {
    if (!confirm(`Delete ${d.doc_no}? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return alert(error.message)
    load()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const lines = [{ account: f.into, debit: amount }, { account: f.kind, credit: amount }]
      if (editing) {
        await updateJournal(editing.id, f.date, f.from || 'Receipt', lines, { reference: f.reference })
        setDone({ msg: `${editing.doc_no} changed to ${rm(amount)}`, doc: editing.doc_no })
      } else {
        const id = await postJournal(f.date, f.from || 'Receipt', lines, { source: 'or', reference: f.reference })
        setDone({ msg: `Receipt of ${rm(amount)} saved`, doc: await docNo(id) })
      }
      setF({ ...blank, date: f.date }); setEditing(null); load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc} again={() => { setDone(null); setMode('list') }} />

  if (mode === 'list') return (
    <DocumentList rows={rows} newLabel="New official receipt"
      emptyText="No official receipts in the last three months."
      onNew={() => { setEditing(null); setF(blank); setError(''); setMode('form') }}
      onEdit={startEdit} onDelete={remove} canEdit canDelete />
  )

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <button type="button" className="link" onClick={() => setMode('list')}>← Back to list</button>
      {editing
        ? <p className="muted">Changing <b className="font-mono">{editing.doc_no}</b>. It keeps the same number.</p>
        : <p className="muted">Daily sales come from Upload Sales. Use this for other money received: event deposits, owner capital, refunds.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
        <div><label>Ref no.</label><input value={f.reference} onChange={e => set('reference', e.target.value)} placeholder="Optional" /></div>
        <div className="sm:col-span-2"><label>Received from</label><input value={f.from} onChange={e => set('from', e.target.value)} required /></div>
        <div><label>Account</label>
          <AccountSelect accounts={accounts} value={f.kind} onChange={v => set('kind', v)}
            filter={a => a.type === 'income' || a.code === '3000' || a.code === '1300' || isDirector(a.code)} />
        </div>
        <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
        <div><label>Received into</label><AccountSelect accounts={accounts} value={f.into} onChange={v => set('into', v)} filter={money} /></div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save receipt'}</button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Convert `Transfer`**

Replace the whole function. Note the `balances` effect now depends on `mode` as well as `done`, so the "sitting there now" figure is fresh each time the form opens.

```tsx
export function Transfer() {
  const accounts = useAccounts()
  const blank = { date: todayMY(), from: '1000', to: '1100', amount: '', reference: '' }
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<DocRow | null>(null)
  const [rows, setRows] = useState<DocRow[]>([])
  const [f, setF] = useState(blank)
  const [balances, setBalances] = useState<Map<string, number>>(new Map())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  const load = () => { loadDocuments('transfer').then(setRows) }
  useEffect(load, [])
  useEffect(() => { accountTotals(null, todayMY()).then(setBalances) }, [done, mode])

  function startEdit(d: DocRow) {
    const debit = d.journal_lines.find(l => Number(l.debit) > 0)
    const credit = d.journal_lines.find(l => Number(l.credit) > 0)
    if (!debit || !credit) return alert('This transfer has an unusual shape. Use Journal Entry to correct it.')
    setEditing(d)
    setF({ date: d.date, from: credit.account, to: debit.account,
           amount: String(Number(debit.debit)), reference: d.reference ?? '' })
    setError(''); setMode('form')
  }

  async function remove(d: DocRow) {
    if (!confirm(`Delete ${d.doc_no}? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return alert(error.message)
    load()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (f.from === f.to) return setError('From and To must be different')
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const name = (c: string) => accounts.find(a => a.code === c)?.name
      const desc = `Transfer ${name(f.from)} to ${name(f.to)}`
      const lines = [{ account: f.to, debit: amount }, { account: f.from, credit: amount }]
      if (editing) {
        await updateJournal(editing.id, f.date, desc, lines, { reference: f.reference })
        setDone({ msg: `${editing.doc_no} changed to ${rm(amount)}`, doc: editing.doc_no })
      } else {
        const id = await postJournal(f.date, desc, lines, { source: 'transfer', reference: f.reference })
        setDone({ msg: `Moved ${rm(amount)}`, doc: await docNo(id) })
      }
      setF({ ...f, amount: '', reference: '' }); setEditing(null); load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc} again={() => { setDone(null); setMode('list') }} />

  if (mode === 'list') return (
    <DocumentList rows={rows} newLabel="New transfer"
      emptyText="No transfers in the last three months."
      onNew={() => { setEditing(null); setF(blank); setError(''); setMode('form') }}
      onEdit={startEdit} onDelete={remove} canEdit canDelete />
  )

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <button type="button" className="link" onClick={() => setMode('list')}>← Back to list</button>
      {editing
        ? <p className="muted">Changing <b className="font-mono">{editing.doc_no}</b>. It keeps the same number.</p>
        : <p className="muted">Also use this when e-wallet money (TNG and the like) reaches the bank: From <b>1210 E-Wallet</b>, To <b>Bank</b>. E-wallets have no fee, so the full amount moves across. Card money is handled on the Card Settlement screen, because Fiuu takes a fee.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
        <div><label>Ref no. (bank-in slip)</label><input value={f.reference} onChange={e => set('reference', e.target.value)} placeholder="Optional" /></div>
        <div><label>From</label><AccountSelect accounts={accounts} value={f.from} onChange={v => set('from', v)} filter={a => money(a) || waiting(a)} />
          <p className="muted mt-1">Sitting there now: {rm(balances.get(f.from) ?? 0)}
            {waiting({ code: f.from } as Account) && <button type="button" className="link ml-2"
              onClick={() => set('amount', String(round2(balances.get(f.from) ?? 0)))}>Move it all</button>}
          </p>
        </div>
        <div><label>To</label><AccountSelect accounts={accounts} value={f.to} onChange={v => set('to', v)} filter={money} /></div>
        <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save transfer'}</button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Check it compiles and lints**

```bash
cd web && npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 4: Check it by hand**

```bash
cd web && npm run dev
```

Open Official Receipt and Bank Transfer. Both land on a list. Create one of each, re-open it, change the amount, confirm the document number is unchanged and the ledger figure follows.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Books.tsx
git commit -m "feat: official receipts and transfers open on history and can be corrected"
```

---

### Task 6: Journal Entry gets history and edit

**Files:**
- Modify: `web/src/pages/Ledger.tsx` (`JournalEntry`)

**Interfaces:**
- Consumes: `DocumentList`, `loadDocuments`, `updateJournal`, `DocRow`, the existing `JvLine` type and `emptyLine()` helper in `Ledger.tsx`.
- Produces: nothing new.

JV is the one editable type with a variable number of lines, so `startEdit` rebuilds the line array from the document rather than mapping two fixed lines.

- [ ] **Step 1: Add list and edit mode to `JournalEntry`**

Replace the state block and add the three functions, keeping the existing form body unchanged apart from the two marked edits:

```tsx
export function JournalEntry() {
  const accounts = useAccounts()
  const { list: suppliers } = useSuppliers()
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<DocRow | null>(null)
  const [rows, setRows] = useState<DocRow[]>([])
  const [head, setHead] = useState({ date: todayMY(), description: '', reference: '', supplier: '' })
  const [lines, setLines] = useState<JvLine[]>([emptyLine(), emptyLine()])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState('')
  const load = () => { loadDocuments('jv').then(setRows) }
  useEffect(load, [])

  function startNew() {
    setEditing(null)
    setHead({ date: todayMY(), description: '', reference: '', supplier: '' })
    setLines([emptyLine(), emptyLine()])
    setError(''); setMode('form')
  }

  function startEdit(d: DocRow) {
    setEditing(d)
    setHead({ date: d.date, description: d.description, reference: d.reference ?? '', supplier: '' })
    setLines(d.journal_lines.map(l => ({
      account: l.account, memo: l.memo ?? '',
      debit: Number(l.debit) ? String(Number(l.debit)) : '',
      credit: Number(l.credit) ? String(Number(l.credit)) : '',
    })))
    setError(''); setMode('form')
  }

  async function remove(d: DocRow) {
    if (!confirm(`Delete ${d.doc_no}? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return alert(error.message)
    load()
  }
```

Keep `setLine`, `dr`, `cr`, `balanced`, `needsSupplier` exactly as they are.

- [ ] **Step 2: Branch `submit` on edit vs new**

Replace the body of the `try` block in `submit`:

```tsx
      const payload = used.map(l => ({
        account: l.account, memo: l.memo || undefined,
        ...(Number(l.debit) ? { debit: round2(Number(l.debit)) } : { credit: round2(Number(l.credit)) }),
      }))
      if (editing) {
        await updateJournal(editing.id, head.date, head.description, payload, { reference: head.reference })
        setDone(editing.doc_no)
      } else {
        const id = await postJournal(head.date, head.description, payload,
          { source: 'jv', reference: head.reference, supplier: head.supplier ? Number(head.supplier) : undefined })
        const { data } = await supabase.from('journals').select('doc_no').eq('id', id).single()
        setDone(data?.doc_no ?? '')
      }
      setEditing(null)
      setHead({ ...head, description: '', reference: '', supplier: '' })
      setLines([emptyLine(), emptyLine()])
      load()
```

`update_journal` rejects any line on account 2000, so a JV that touches Suppliers Owed cannot be edited here. That is deliberate — the error message from the database says where to go instead.

- [ ] **Step 3: Add the list branch and the back link**

Immediately after the `if (done !== null) return <Done .../>` line, change that line and add the list branch:

```tsx
  if (done !== null) return <Done msg={editing ? 'Journal entry changed' : 'Journal entry saved'} doc={done}
    again={() => { setDone(null); setMode('list') }} />

  if (mode === 'list') return (
    <DocumentList rows={rows} newLabel="New journal entry"
      emptyText="No journal entries in the last three months."
      onNew={startNew} onEdit={startEdit} onDelete={remove} canEdit canDelete />
  )
```

Then add as the first child inside the returned `<form>`:

```tsx
      <button type="button" className="link" onClick={() => setMode('list')}>← Back to list</button>
      {editing && <p className="muted">Changing <b className="font-mono">{editing.doc_no}</b>. It keeps the same number.</p>}
```

Add to the imports at the top of `Ledger.tsx`: `DocumentList` from `../DocumentList`, and `loadDocuments`, `updateJournal`, `type DocRow` to the existing `../lib` import.

- [ ] **Step 4: Check it compiles and lints**

```bash
cd web && npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 5: Check it by hand**

```bash
cd web && npm run dev
```

Open Journal Entry. Create a three-line entry. Re-open it — all three lines come back with their accounts, memos and amounts. Remove a line, add a different one, save; the document number is unchanged and the Trial Balance still balances.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Ledger.tsx
git commit -m "feat: journal entries open on history and can be corrected"
```

---

### Task 7: Purchase Invoice and Supplier Payment edit buttons

**Files:**
- Modify: `web/src/pages/Purchase.tsx` (`NewPurchaseInvoice`, `PurchaseInvoices`, `SupplierPayments` and its form)

**Interfaces:**
- Consumes: `update_purchase_invoice`, `update_supplier_payment` (Task 2).
- Produces: nothing new.

These two screens already have their `list ↔ new` shape, so this task adds an `edit` mode to the existing components rather than restructuring them.

- [ ] **Step 1: Let `NewPurchaseInvoice` take an invoice to edit**

Change its props and initial state so the same form serves both. Add to the props type:

```tsx
{ onSaved, editing }: { onSaved: (doc: string) => void; editing?: InvoiceForEdit | null }
```

Define next to the other types in `Purchase.tsx`:

```tsx
export type InvoiceForEdit = {
  id: number; supplier_id: number; invoice_no: string | null; date: string; due_date: string
  description: string; lines: { account: string; amount: string; memo: string }[]
}
```

Seed the form state from `editing` when present, and branch the save call:

```tsx
      if (editing) {
        const { error } = await supabase.rpc('update_purchase_invoice', {
          p_id: editing.id, p_invoice_no: f.invoice_no, p_date: f.date, p_due: f.due_date,
          p_description: f.description, p_lines: payload,
        })
        if (error) throw new Error(error.message)
        onSaved(`Invoice ${editing.invoice_no ?? ''} changed`)
      } else {
        // existing create_purchase_invoice call, unchanged
      }
```

The supplier cannot be changed on an edit — `update_purchase_invoice` takes no supplier argument, because moving an invoice between suppliers would silently move the balance too. Disable the supplier select when `editing` is set and show "To move this to another supplier, cancel it and enter it again."

- [ ] **Step 2: Add the edit button to the invoice list**

In `PurchaseInvoices`, widen the mode and add the handler:

```tsx
  const [mode, setMode] = useState<'list' | 'new' | 'edit'>('list')
  const [editing, setEditing] = useState<InvoiceForEdit | null>(null)

  async function startEdit(inv: Invoice) {
    const { data, error } = await supabase.from('purchase_invoices')
      .select('id, supplier_id, invoice_no, date, due_date, journals(description, journal_lines(account, debit, memo))')
      .eq('id', inv.id).single()
    if (error || !data) return alert(error?.message ?? 'Could not open the invoice')
    const j = data.journals as unknown as { description: string; journal_lines: { account: string; debit: number; memo: string | null }[] }
    setEditing({
      id: data.id, supplier_id: data.supplier_id, invoice_no: data.invoice_no,
      date: data.date, due_date: data.due_date, description: j.description,
      lines: j.journal_lines.filter(l => l.account !== '2000' && Number(l.debit) > 0)
        .map(l => ({ account: l.account, amount: String(Number(l.debit)), memo: l.memo ?? '' })),
    })
    setMode('edit')
  }
```

Render the form for both modes, and show the pencil only on unpaid invoices — the same `Number(r.paid) === 0` test the cancel button already uses:

```tsx
  if (mode !== 'list') return (
    <div className="space-y-4">
      <button className="link" onClick={() => { setMode('list'); setEditing(null) }}>← Back to list</button>
      <NewPurchaseInvoice editing={editing}
        onSaved={doc => { setSaved(doc); setMode('list'); setEditing(null); load() }} />
    </div>
  )
```

In the row actions, before the cancel button:

```tsx
{canCancel(role) && Number(r.paid) === 0 && <button title="Edit invoice"
  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand"
  onClick={() => startEdit(r)}><Pencil className="size-4" /></button>}
```

Add `Pencil` to the `lucide-react` import at the top of `Purchase.tsx`.

- [ ] **Step 3: Add editing to `SupplierPayments`**

`SupplierPayments` is one form above a history table, not a list/new pair, so editing loads a history row back into the form in place.

Add the state and the two functions:

```tsx
  const [editing, setEditing] = useState<{ id: number; doc_no: string } | null>(null)

  async function startEdit(p: Payment) {
    const { data, error } = await supabase.from('supplier_payments')
      .select('id, supplier_id, date, journals(reference, journal_lines(account, credit)), payment_allocations(invoice_id, amount)')
      .eq('id', p.id).single()
    if (error || !data) return alert(error?.message ?? 'Could not open the payment')
    const d = data as unknown as {
      id: number; supplier_id: number; date: string
      journals: { reference: string | null; journal_lines: { account: string; credit: number }[] }
      payment_allocations: { invoice_id: number; amount: number }[]
    }
    // The money came out of the credit line that is not Suppliers Owed.
    const from = d.journals.journal_lines.find(l => l.account !== '2000' && Number(l.credit) > 0)?.account ?? '1100'
    setEditing({ id: d.id, doc_no: p.journals.doc_no })
    setSupplier(String(d.supplier_id))
    setHead({ date: d.date, from, reference: d.journals.reference ?? '' })
    setPendingPay(Object.fromEntries(d.payment_allocations.map(a => [a.invoice_id, String(Number(a.amount))])))
    window.scrollTo({ top: 0 })
  }

  function cancelEdit() {
    setEditing(null); setSupplier(''); setPay({})
    setHead({ date: todayMY(), from: '1100', reference: '' })
  }
```

The existing effect on `supplier` clears `pay` whenever the supplier changes, which would wipe the allocations `startEdit` just loaded. Hold them in a staging value and apply them after the invoice list arrives. Replace that effect with:

```tsx
  const [pendingPay, setPendingPay] = useState<Record<number, string> | null>(null)

  useEffect(() => {
    if (!supplier) { setPay({}); setOpen([]); return }
    // While editing, this payment's own invoices are already settled, so show them all.
    loadInvoices({ supplier: Number(supplier), open: !editing }).then(r => {
      setOpen(r.reverse())
      setPay(pendingPay ?? {})
      setPendingPay(null)
    })
  }, [supplier, editing, pendingPay])
```

Branch `submit` on `editing`:

```tsx
    const allocations = Object.entries(pay).filter(([, v]) => Number(v) > 0)
      .map(([id, v]) => ({ invoice_id: Number(id), amount: round2(Number(v)) }))
    if (editing) {
      const { error } = await supabase.rpc('update_supplier_payment', {
        p_id: editing.id, p_date: head.date, p_from: head.from,
        p_reference: head.reference, p_allocations: allocations,
      })
      setBusy(false)
      if (error) return setError(error.message)
      setDone(editing.doc_no)
      cancelEdit(); loadHistory()
      return
    }
```

The supplier select is disabled while editing — `update_supplier_payment` takes no supplier argument, because moving a payment between suppliers would move the balance with it. Add under the select:

```tsx
{editing && <p className="muted mt-1">Changing <b className="font-mono">{editing.doc_no}</b>. To move it to another supplier, cancel it and enter it again.</p>}
```

Add the pencil to each history row, beside the existing cancel button:

```tsx
{canCancel(role) && <button title="Edit payment"
  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand"
  onClick={() => startEdit(p)}><Pencil className="size-4" /></button>}
```

And change the success message so an edit does not claim a new payment was saved:

```tsx
  if (done !== null) return <Done msg={editing ? 'Supplier payment changed' : 'Supplier payment saved'}
    doc={done} again={() => { setDone(null); cancelEdit() }} />
```

- [ ] **Step 4: Check it compiles and lints**

```bash
cd web && npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 5: Check it by hand**

```bash
cd web && npm run dev
```

Enter a purchase invoice, edit it, confirm Supplier Aging and the supplier's owed figure both move. Pay part of it — the pencil disappears. Edit the payment to a different amount and confirm the invoice's outstanding figure follows.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Purchase.tsx
git commit -m "feat: correct an unpaid purchase invoice or a supplier payment on screen"
```

---

### Task 8: "Replace this day" on Upload Sales, edit links on generated documents, README

**Files:**
- Modify: `web/src/pages/Sales.tsx` (`UploadSales`)
- Modify: `web/src/pages/Books.tsx` (`JournalListing`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `replace_sales_day` (Task 3), `EDITABLE_SOURCES` (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Offer replacement for days already posted**

In `UploadSales`, days already in the books are currently marked `posted` and skipped. Add a per-day "Replace" tick, shown only when `role === 'owner'`, and send those days through `replace_sales_day` instead of `post_sales_day`:

```tsx
      const rpc = d.posted ? 'replace_sales_day' : 'post_sales_day'
      const { error } = await supabase.rpc(rpc, {
        p_date: d.date, p_sales: d.sales, p_service: d.service, p_tax: d.tax,
        p_rounding: d.rounding, p_payments: d.payments,
      })
      if (error) console.error(rpc, d.date, error)
```

Next to the existing note about days not going in twice, add: "A day already posted can be replaced — tick **Replace** and the old entry is swapped for the new one. Only the owner can do this."

- [ ] **Step 2: Point generated documents at the screen that owns them**

In `JournalListing` in `Books.tsx`, add an "Open" link per row that routes to the screen for that document's source, so a wrong payroll or claim is fixed where it lives. Add next to the existing delete button:

```tsx
const OWNER_SCREEN: Record<string, string> = {
  pv: '/cash/payment', or: '/cash/receipt', transfer: '/cash/transfer', jv: '/gl/journal',
  pi: '/ap/invoices', sp: '/ap/payments', sales: '/sales/upload', fiuu: '/sales/fiuu',
  payroll: '/payroll/run', claim: '/claims', accrual: '/gl/accruals', stock: '/stock/count',
  cogs: '/sales/upload',
}
```

```tsx
{OWNER_SCREEN[r.source] && <Link to={OWNER_SCREEN[r.source]} className="link mr-2"
  title={EDITABLE_SOURCES.includes(r.source) ? 'Open this document' : 'Change this on the screen that made it'}>
  {EDITABLE_SOURCES.includes(r.source) ? 'Open' : 'Fix here'}</Link>}
```

Add `Link` from `react-router-dom` and `EDITABLE_SOURCES` from `../lib` to the imports in `Books.tsx`.

- [ ] **Step 3: Add the migration to the README**

In `README.md`, Step 2.4, the run-these-in-order list currently ends `...and `supabase/017_corkage.sql``. Change it to end `..., `supabase/017_corkage.sql` and `supabase/018_docedit.sql``.

Under **Everyday notes**, add:

```markdown
- A wrong Payment Voucher, Official Receipt, Transfer or Journal Entry can be re-opened from its own screen and corrected — it keeps the same document number. An entry already ticked on the Bank Reconciliation must be unticked there first.
```

- [ ] **Step 4: Run the full test suite**

```bash
cd web && npm run test:db && npm run test:rls && npm run test:repair && npm run lint && npm run build
```

Expected: all five pass, and no line of output begins with `FAIL`.

- [ ] **Step 5: Check it by hand**

```bash
cd web && npm run dev
```

Upload a Zeoniq file containing a day that is already posted. Confirm: the Replace tick appears for the owner and not for a manager; replacing it leaves one sales entry and one cost-of-sales entry for that day; the Journal Listing shows "Fix here" against payroll and claim rows and "Open" against PV rows.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Sales.tsx web/src/pages/Books.tsx README.md
git commit -m "feat: replace a posted sales day, and route generated documents to their own screen"
```

---

## Deployment note

`supabase/018_docedit.sql` must be run in the Supabase SQL Editor **before** the Cloudflare Pages deploy that contains the front-end changes reaches users — otherwise the edit buttons call functions that do not exist yet. The file is `create or replace` throughout and additive, so running it early, or twice, is harmless.

## Not in this plan

Part 3 (payroll salary advance and timesheet) and Part 1 (dashboard) of the spec each get their own plan. Part 1 depends on nothing here; Part 3 depends on nothing here.
