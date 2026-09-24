// Checks what each role can actually see and do, the way Supabase runs it:
// queries run as the `authenticated` role with row level security on.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'

const FILES = ['001_core.sql', '002_claims.sql', '003_accounting.sql', '004_payroll.sql', '005_sales.sql',
  '006_categories.sql', '007_fiuu.sql', '008_director.sql', '009_fiuu_brands.sql', '010_item_groups.sql',
  '011_resplit.sql', '012_stock.sql', '013_accruals.sql', '014_recurring.sql', '015_fixes.sql']

const db = new PGlite()
await db.exec(`
  create schema auth; create schema storage; create role anon; create role authenticated;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql as $$ select current_setting('app.uid', true)::uuid $$;
  create table storage.buckets (id text, name text, public bool);
  create table storage.objects (bucket_id text, owner uuid, name text);
create function storage.foldername(p text) returns text[] language sql immutable as $$ select string_to_array(p, '/') $$;
  grant usage on schema public, auth to anon, authenticated;
`)
for (const f of FILES) await db.exec(fs.readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8'))

// Supabase grants everything on public to anon/authenticated; RLS is what protects the data.
await db.exec(`
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;
  grant select on auth.users to anon, authenticated;
  revoke insert, update, delete on journals, journal_lines, payroll_runs, payslips,
    purchase_invoices, supplier_payments, payment_allocations from anon, authenticated;
`)

const OWNER = '00000000-0000-0000-0000-000000000001'
const STAFF = '00000000-0000-0000-0000-000000000002'
await db.exec(`
  insert into auth.users values ('${OWNER}', 'owner@x.my', '{"full_name":"Boss"}'), ('${STAFF}', 'staff@x.my', '{"full_name":"Waiter"}');
  update profiles set role = 'owner' where id = '${OWNER}';
  set app.uid = '${OWNER}';
  insert into suppliers (name) values ('Beer Co');
`)
// A day of sales, an employee linked to the staff login, and an approved payroll.
await db.query(`select post_sales_day('2026-09-20', 1000, 100, 0, 0, '[{"code":"CASH","amount":1100}]'::jsonb)`)
await db.exec(`insert into employees (name, profile_id, pay_type, rate) values ('Waiter', '${STAFF}', 'monthly', 2000)`)
const run = (await db.query(`select create_payroll_run('2026-09-01','2026-09-30') id`)).rows[0].id
await db.query(`select approve_payroll_run(${run})`)

const as = async (uid, label, sql) => {
  await db.exec(`set role authenticated; set app.uid = '${uid}';`)
  try { const r = await db.query(sql); await db.exec('reset role'); return r.rows }
  catch (e) { await db.exec('reset role'); return { error: e.message } }
}
const count = rows => Array.isArray(rows) ? Number(rows[0]?.c ?? rows.length) : `error: ${rows.error}`
const check = (label, ok, detail = '') => console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' :: ' + detail : ''}`)

// ---- staff (a waiter) ----
let r = await as(STAFF, 'staff', `select count(*)::int c from journals`)
check('staff cannot see journal entries', count(r) === 0, String(count(r)))
r = await as(STAFF, 'staff', `select count(*)::int c from journal_lines`)
check('staff cannot see journal lines', count(r) === 0, String(count(r)))
r = await as(STAFF, 'staff', `select count(*)::int c from account_totals(null, '2026-12-31')`)
check('staff cannot total the accounts', count(r) === 0, String(count(r)))
r = await as(STAFF, 'staff', `select count(*)::int c from suppliers`)
check('staff cannot see suppliers', count(r) === 0, String(count(r)))
r = await as(STAFF, 'staff', `select count(*)::int c from employees`)
check('staff sees only their own staff record', count(r) === 1, String(count(r)))
r = await as(STAFF, 'staff', `select count(*)::int c from payslip_view`)
check('staff CAN see their own payslip', count(r) === 1, String(count(r)))
r = await as(STAFF, 'staff', `insert into claims (date, account, description, amount) values ('2026-09-21','6800','Grab',12)`)
check('staff can submit a claim', !r.error, r.error ?? '')
r = await as(STAFF, 'staff', `select post_journal('2026-09-21','x','manual',null,null,'[{"account":"6900","debit":5},{"account":"1000","credit":5}]'::jsonb)`)
check('staff cannot post entries', !!r.error, r.error ?? 'posted!')
r = await as(STAFF, 'staff', `update accounts set name = 'hacked' where code = '1000'`)
check('staff cannot rename accounts', !!r.error || (await db.query(`select name from accounts where code='1000'`)).rows[0].name !== 'hacked')
r = await as(STAFF, 'staff', `update profiles set role = 'owner' where id = '${STAFF}'`)
const role = (await db.query(`select role from profiles where id='${STAFF}'`)).rows[0].role
check('staff cannot make themselves owner', role === 'staff', role)
r = await as(STAFF, 'staff', `select count(*)::int c from item_costs`)
check('staff cannot see item costs', count(r) === 0, String(count(r)))

// ---- anonymous (someone with only the public key) ----
r = await as(null, 'anon', `select count(*)::int c from journals`)
check('anonymous sees no entries', count(r) === 0 || typeof count(r) === 'string')
r = await as(null, 'anon', `select count(*)::int c from profiles`)
check('anonymous sees no people', count(r) === 0 || typeof count(r) === 'string')

// ---- manager (office, but not owner) ----
const MGR = '00000000-0000-0000-0000-000000000003'
await db.exec(`reset role; insert into auth.users values ('${MGR}', 'mgr@x.my', '{"full_name":"Manager"}');
  update profiles set role = 'manager' where id = '${MGR}';`)
r = await as(MGR, 'manager', `select count(*)::int c from journals`)
check('manager can see the books', count(r) > 0, String(count(r)))
r = await as(MGR, 'manager', `select approve_payroll_run(${run})`)
check('manager cannot approve payroll', !!r.error, r.error ?? 'approved!')
r = await as(MGR, 'manager', `update item_costs set unit_cost = 1`)
check('manager cannot change item costs', !!r.error || (await db.query(`select coalesce(max(unit_cost),0)::float m from item_costs`)).rows[0].m === 0)
r = await as(MGR, 'manager', `select post_stock_count('2026-09-30','[{"stock_account":"1420","counted":100}]'::jsonb)`)
check('manager cannot post a stock count', !!r.error, r.error ?? 'posted!')
