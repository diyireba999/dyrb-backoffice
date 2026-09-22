import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite()
await db.exec(`
create schema auth; create schema storage; create role anon; create role authenticated;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql as $$ select current_setting('app.uid', true)::uuid $$;
create table storage.buckets (id text, name text, public bool);
create table storage.objects (bucket_id text, owner uuid);
`)
for (const f of ['001_core.sql', '002_claims.sql'])
  await db.exec(fs.readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8'))
const owner = '00000000-0000-0000-0000-000000000001'
await db.exec(`insert into auth.users values ('${owner}', 'o@x.my', '{"full_name":"Boss"}');
  update profiles set role='owner'; set app.uid = '${owner}';`)
const ok = await db.query(`select post_journal('2026-09-22','TNB','manual',null,null,'[{"account":"6110","debit":350},{"account":"1100","credit":350}]'::jsonb) id`)
console.log('balanced ok, id', ok.rows[0].id)
try { await db.query(`select post_journal('2026-09-22','bad','manual',null,null,'[{"account":"6110","debit":350},{"account":"1100","credit":300}]'::jsonb)`); console.log('FAIL: unbalanced accepted') }
catch (e) { console.log('unbalanced rejected:', e.message) }
try { await db.query(`select post_journal('2026-09-22','dup','sales','2026-09-21',null,'[{"account":"1000","debit":1},{"account":"4000","credit":1}]'::jsonb)`);
      await db.query(`select post_journal('2026-09-22','dup','sales','2026-09-21',null,'[{"account":"1000","debit":1},{"account":"4000","credit":1}]'::jsonb)`); console.log('FAIL: duplicate accepted') }
catch (e) { console.log('duplicate rejected:', e.message) }
// Claims: must be approved before paying, pays once, books expense.
const c = (await db.query(`insert into claims (date, account, description, amount) values ('2026-09-20','6800','Grab to supplier',18.50) returning id`)).rows[0].id
try { await db.query(`select pay_claim(${c}, '1010', '2026-09-22')`); console.log('FAIL: unapproved claim paid') } catch (e) { console.log('unapproved pay rejected:', e.message) }
await db.exec(`update claims set status='approved' where id=${c}`)
await db.query(`select pay_claim(${c}, '1010', '2026-09-22')`)
const paid = (await db.query(`select c.status, sum(l.debit)::float d from claims c join journal_lines l on l.journal_id=c.paid_journal_id where c.id=${c} group by 1`)).rows[0]
console.log(paid.status === 'paid' && paid.d === 18.5 ? 'claim paid ok' : 'FAIL claim ' + JSON.stringify(paid))
try { await db.query(`select pay_claim(${c}, '1010', '2026-09-22')`); console.log('FAIL: paid twice') } catch (e) { console.log('double pay rejected:', e.message) }
// Suppliers owed: bill on credit then part-pay; needs a supplier.
try { await db.query(`select post_journal('2026-09-22','no sup','manual',null,null,'[{"account":"5000","debit":100},{"account":"2000","credit":100}]'::jsonb)`); console.log('FAIL: owed without supplier') } catch (e) { console.log('owed without supplier rejected:', e.message) }
const sup = (await db.query(`insert into suppliers (name) values ('Ah Seng Veg') returning id`)).rows[0].id
await db.query(`select post_journal('2026-09-22','bill','manual',null,null,'[{"account":"5000","debit":100},{"account":"2000","credit":100}]'::jsonb, ${sup})`)
await db.query(`select post_journal('2026-09-23','pay','manual',null,null,'[{"account":"2000","debit":60},{"account":"1100","credit":60}]'::jsonb, ${sup})`)
const owed = Number((await db.query(`select owed from supplier_balances where id=${sup}`)).rows[0].owed)
console.log(owed === 40 ? 'supplier owed ok' : 'FAIL supplier owed ' + owed)
// Delete: manager may delete manual entries only.
await db.exec(`update profiles set role='manager'`)
const m = (await db.query(`select post_journal('2026-09-22','oops','manual',null,null,'[{"account":"6900","debit":5},{"account":"1000","credit":5}]'::jsonb) id`)).rows[0].id
await db.query(`select delete_journal(${m})`); console.log('manager deleted manual ok')
const sales = (await db.query(`select id from journals where source='sales'`)).rows[0].id
try { await db.query(`select delete_journal(${sales})`); console.log('FAIL: manager deleted sales entry') } catch (e) { console.log('manager blocked on sales:', e.message) }
await db.exec(`update profiles set role='staff'`)
try { await db.query(`select post_journal('2026-09-22','x','manual',null,null,'[]'::jsonb)`); console.log('FAIL staff allowed') } catch (e) { console.log('staff blocked:', e.message) }
await db.exec(`update profiles set role='owner'`)
try { await db.query(`select post_journal('2026-09-22','empty','manual',null,null,'[]'::jsonb)`); console.log('FAIL: empty entry accepted') } catch (e) { console.log('empty rejected:', e.message) }
const n = await db.query(`select count(*)::int c from journals`); console.log(n.rows[0].c === 5 ? 'journal count ok' : 'FAIL journal count ' + n.rows[0].c)
