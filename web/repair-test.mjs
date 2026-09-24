// Checks 003b_repair.sql in two situations:
//   A) 003 never ran (only 001 + 002) - the repair must build everything.
//   B) 003 already ran in full - the repair must change nothing and must not fail.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'

const sql = f => fs.readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8')
const owner = '00000000-0000-0000-0000-000000000001'

async function fresh(files) {
  const db = new PGlite()
  await db.exec(`
    create schema auth; create schema storage; create role anon; create role authenticated;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as $$ select current_setting('app.uid', true)::uuid $$;
    create table storage.buckets (id text, name text, public bool);
    create table storage.objects (bucket_id text, owner uuid, name text);
create function storage.foldername(p text) returns text[] language sql immutable as $$ select string_to_array(p, '/') $$;
  `)
  for (const f of files) await db.exec(sql(f))
  await db.exec(`insert into auth.users values ('${owner}', 'o@x.my', '{"full_name":"Boss"}');
    update profiles set role='owner'; set app.uid = '${owner}';`)
  return db
}

async function works(db, label) {
  await db.query(`select post_journal('2026-09-22','Daily sales','sales','2026-09-22',null,
    '[{"account":"1000","debit":396},{"account":"4000","credit":360},{"account":"4100","credit":36}]'::jsonb)`)
  const doc = (await db.query(`select doc_no from journals where source_ref='2026-09-22'`)).rows[0].doc_no
  const income = Number((await db.query(`select coalesce(sum(credit - debit), 0)::float v from account_totals(null,'2026-12-31') t
    join accounts a on a.code = t.code where a.type = 'income'`)).rows[0].v)
  const cleared = (await db.query(`select count(*)::int c from information_schema.columns
    where table_name='journal_lines' and column_name='cleared_on'`)).rows[0].c
  const ok = doc === 'SL-000001' && income === 396 && cleared === 1
  console.log(ok ? `${label}: repair ok (doc ${doc}, income ${income})` : `FAIL ${label}: doc ${doc}, income ${income}, cleared_on ${cleared}`)
}

// A) 003 missing entirely
let db = await fresh(['001_core.sql', '002_claims.sql'])
await db.exec(sql('003b_repair.sql'))
await works(db, 'after repair from scratch')

// B) everything already applied, then the repair run again
db = await fresh(['001_core.sql', '002_claims.sql', '003_accounting.sql', '004_payroll.sql',
                  '005_sales.sql', '006_categories.sql', '007_fiuu.sql', '008_director.sql'])
await db.exec(sql('003b_repair.sql'))
await db.exec(sql('003b_repair.sql'))   // twice, to be sure it is safe to repeat
await works(db, 'repair over a complete database')
