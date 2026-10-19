// Checks what each role can actually see and do, the way Supabase runs it:
// queries run as the `authenticated` role with row level security on.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'

const FILES = ['001_core.sql', '002_claims.sql', '003_accounting.sql', '004_payroll.sql', '005_sales.sql',
  '006_categories.sql', '007_fiuu.sql', '008_director.sql', '009_fiuu_brands.sql', '010_item_groups.sql',
  '011_resplit.sql', '012_stock.sql', '013_accruals.sql', '014_recurring.sql', '015_fixes.sql', '016_fixes2.sql',
  '017_corkage.sql', '018_docedit.sql', '019_advance.sql', '020_timesheet.sql', '021_entertainment.sql',
  '022_usernames.sql', '023_disable_login.sql', '024_investor.sql', '025_prorate.sql', '026_company.sql',
  '027_payroll_hours.sql', '028_payroll_paid.sql', '029_payroll_payment.sql', '030_accrual_first_day.sql',
  '031_review_fixes.sql', '032_month_status.sql']

const db = new PGlite()
await db.exec(`
  create schema auth; create schema storage; create role anon; create role authenticated;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, banned_until timestamptz, updated_at timestamptz);
  create table auth.identities (id uuid, user_id uuid, provider_id text, identity_data jsonb, provider text,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
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
const waiterId = (await db.query(`insert into employees (name, profile_id, pay_type, rate) values ('Waiter', '${STAFF}', 'monthly', 2000) returning id`)).rows[0].id
const run = (await db.query(`select create_payroll_run('2026-09-01','2026-09-30') id`)).rows[0].id
await db.query(`select approve_payroll_run(${run})`)

const as = async (uid, label, sql) => {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; set app.uid = '${uid ?? ''}';`)
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

// A salary advance recovered in full: staff must see it as repaid, not still owing.
// (`as()` above leaves app.uid set to the staff member's, even after its own
// `reset role` — put it back to the owner before running these as ourselves.)
await db.exec(`set app.uid = '${OWNER}'`)
const waiterAdv = (await db.query(`select record_advance(${waiterId}, '2026-10-01', 300, '1000', null) id`)).rows[0].id
const run2ForAdv = (await db.query(`select create_payroll_run('2026-10-01','2026-10-31') id`)).rows[0].id
await db.query(`select approve_payroll_run(${run2ForAdv})`)
const officeOutstanding = (await db.query(`select outstanding::float o from advance_balances where id=${waiterAdv}`)).rows[0].o

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
r = await as(STAFF, 'staff', `select outstanding::float o from advance_balances where id=${waiterAdv}`)
check('staff sees an advance already repaid, not still owing', Array.isArray(r) && r[0]?.o === officeOutstanding && r[0]?.o === 0,
  JSON.stringify(r) + ' vs office ' + officeOutstanding)

// ---- anonymous (someone with only the public key) ----
r = await as(null, 'anon', `select count(*)::int c from journals`)
check('anonymous sees no entries', count(r) === 0 || typeof count(r) === 'string')
r = await as(null, 'anon', `select count(*)::int c from profiles`)
check('anonymous sees no people', count(r) === 0 || typeof count(r) === 'string')
r = await as(null, 'anon', `select post_journal('2026-09-21','x','manual',null,null,'[{"account":"6900","debit":5},{"account":"1000","credit":5}]'::jsonb)`)
check('anonymous cannot post entries', !!r.error, r.error ?? 'posted!')
r = await as(null, 'anon', `select month_status('2026-09-01')`)
check('anonymous cannot read month_status', !!r.error, r.error ?? 'read!')

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

// ---- investor (dashboard and summary reports only) ----
const INV = '00000000-0000-0000-0000-000000000004'
await db.exec(`reset role; insert into auth.users (id, email, raw_user_meta_data) values ('${INV}', 'inv@x.my', '{"full_name":"Investor"}');
  update profiles set role = 'investor' where id = '${INV}';`)
r = await as(INV, 'investor', `select count(*)::int c from account_totals(null, '2026-12-31')`)
check('investor can total the accounts', count(r) > 0, String(count(r)))
r = await as(INV, 'investor', `select count(*)::int c from account_balances`)
check('investor can see daily totals', count(r) > 0, String(count(r)))
r = await as(INV, 'investor', `select count(*)::int c from journals`)
check('investor cannot see journal entries', count(r) === 0, String(count(r)))
r = await as(INV, 'investor', `select count(*)::int c from journal_lines`)
check('investor cannot see journal lines', count(r) === 0, String(count(r)))
r = await as(INV, 'investor', `select count(*)::int c from payslip_view`)
check('investor cannot see payslips', count(r) === 0, String(count(r)))
r = await as(INV, 'investor', `select count(*)::int c from suppliers`)
check('investor cannot see suppliers', count(r) === 0, String(count(r)))

// ---- disabled login: loses its role at once, even mid-session ----
await db.exec(`reset role; set app.uid = '${OWNER}'`)
await db.query(`select set_login_active('${MGR}', false)`)
r = await as(MGR, 'manager', `select my_role()::text r`)
check('disabled login has no role', !Array.isArray(r) || r[0]?.r === null, JSON.stringify(r))
r = await as(MGR, 'manager', `select count(*)::int c from journals`)
check('disabled manager can no longer see the books', count(r) === 0 || typeof count(r) === 'string', String(count(r)))
r = await as(MGR, 'manager', `select post_journal('2026-09-21','x','manual',null,null,'[{"account":"6900","debit":5},{"account":"1000","credit":5}]'::jsonb)`)
check('disabled manager cannot post entries', !!r.error, r.error ?? 'posted!')
