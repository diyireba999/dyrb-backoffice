import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite()
await db.exec(`
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql as $$ select current_setting('app.uid', true)::uuid $$;
create table storage.buckets (id text, name text, public bool);
create table storage.objects (bucket_id text, owner uuid);
`)
await db.exec(fs.readFileSync(new URL('../supabase/001_core.sql', import.meta.url), 'utf8'))
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
await db.exec(`update profiles set role='staff'`)
try { await db.query(`select post_journal('2026-09-22','x','manual',null,null,'[]'::jsonb)`); console.log('FAIL staff allowed') } catch (e) { console.log('staff blocked:', e.message) }
const n = await db.query(`select count(*)::int c from journals`); console.log('journals', n.rows[0].c)
