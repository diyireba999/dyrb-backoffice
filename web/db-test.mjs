import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const round = n => Math.round(n * 100) / 100
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

// ---- 003: upgrade an existing database, then document numbers, AP and bank rec ----
await db.exec(`update profiles set role='owner'`)
await db.exec(fs.readFileSync(new URL('../supabase/003_accounting.sql', import.meta.url), 'utf8'))
const nums = (await db.query(`select count(*)::int c from journals where doc_no is null`)).rows[0].c
console.log(nums === 0 ? 'existing entries numbered ok' : 'FAIL unnumbered ' + nums)
const pvId = (await db.query(`select post_journal('2026-09-24','Ice','pv',null,null,'[{"account":"5010","debit":20},{"account":"1000","credit":20}]'::jsonb, null, 'R123') id`)).rows[0].id
const pv = (await db.query(`select doc_no from journals where id=${pvId}`)).rows[0].doc_no
console.log(pv === 'PV-000001' ? 'doc number ok' : 'FAIL doc number ' + pv)
const s2 = (await db.query(`insert into suppliers (name) values ('Brew Co') returning id`)).rows[0].id
const i1 = (await db.query(`select create_purchase_invoice(${s2}, 'INV-9', '2026-08-01', '2026-08-31', 'Beer', '[{"account":"5020","amount":300},{"account":"5010","amount":100}]'::jsonb) id`)).rows[0].id
const i2 = (await db.query(`select create_purchase_invoice(${s2}, 'INV-10', '2026-09-01', '2026-09-30', 'Beer', '[{"account":"5020","amount":200}]'::jsonb) id`)).rows[0].id
try { await db.query(`select pay_supplier(${s2}, '2026-09-25', '1100', 'CHQ1', '[{"invoice_id":${i1},"amount":500}]'::jsonb)`); console.log('FAIL: overpaid invoice') } catch (e) { console.log('overpay rejected:', e.message) }
await db.query(`select pay_supplier(${s2}, '2026-09-25', '1100', 'CHQ1', '[{"invoice_id":${i1},"amount":400},{"invoice_id":${i2},"amount":50}]'::jsonb)`)
const st = (await db.query(`select id, outstanding::float o from purchase_invoice_status where supplier_id=${s2} order by id`)).rows
const owed2 = Number((await db.query(`select owed from supplier_balances where id=${s2}`)).rows[0].owed)
console.log(st[0].o === 0 && st[1].o === 150 && owed2 === 150 ? 'AP outstanding ok' : 'FAIL AP ' + JSON.stringify(st) + ' ' + owed2)
try { await db.query(`select cancel_purchase_invoice(${i1})`); console.log('FAIL: cancelled paid invoice') } catch (e) { console.log('cancel paid invoice rejected:', e.message) }
const tb = (await db.query(`select sum(debit - credit)::float d from journal_lines`)).rows[0].d
console.log(tb === 0 ? 'trial balance zero ok' : 'FAIL trial balance ' + tb)
const line = (await db.query(`select id from journal_lines where account='1100' limit 1`)).rows[0].id
await db.query(`select set_cleared(array[${line}]::bigint[], '2026-09-30')`)
const cl = (await db.query(`select cleared_on::text c from journal_lines where id=${line}`)).rows[0].c
console.log(cl === '2026-09-30' ? 'bank rec tick ok' : 'FAIL bank rec ' + cl)
const tot = (await db.query(`select code, (debit - credit)::float net from account_totals(null, '2026-12-31') where code = '1100'`)).rows[0].net
const direct = (await db.query(`select sum(debit - credit)::float n from journal_lines where account = '1100'`)).rows[0].n
console.log(tot === direct ? 'account totals ok' : `FAIL account totals ${tot} vs ${direct}`)
const ct = Number((await db.query(`select cleared_total('1100', '2026-09-30') c`)).rows[0].c)
console.log(ct !== 0 ? 'cleared total ok' : 'FAIL cleared total')

// ---- 004: payroll ----
await db.exec(fs.readFileSync(new URL('../supabase/004_payroll.sql', import.meta.url), 'utf8'))
await db.exec(`insert into employees (name, is_local, pay_type, rate) values ('Siti', true, 'monthly', 3000)`)
await db.exec(`insert into employees (name, is_local, pay_type, rate, eis_on) values ('Aung', false, 'monthly', 1800, false)`)
await db.exec(`insert into employees (name, is_local, pay_type, rate) values ('Lim', true, 'hourly', 12)`)
const run = (await db.query(`select create_payroll_run('2026-09-05', '2026-09-30') id`)).rows[0].id
const local = (await db.query(`select epf_employee::float ee, epf_employer::float er, socso_employee::float se, socso_employer::float sr, eis_employee::float ie from payslip_view where run_id=${run} and name='Siti'`)).rows[0]
console.log(local.ee === 330 && local.er === 390 && local.se === 15 && local.sr === 52.5 && local.ie === 6
  ? 'local statutory ok' : 'FAIL local ' + JSON.stringify(local))
const foreign = (await db.query(`select epf_employee::float ee, epf_employer::float er, socso_employee::float se, socso_employer::float sr, eis_employer::float ir from payslip_view where run_id=${run} and name='Aung'`)).rows[0]
console.log(foreign.ee === 36 && foreign.er === 36 && foreign.se === 0 && foreign.sr === 22.5 && foreign.ir === 0
  ? 'foreign statutory ok' : 'FAIL foreign ' + JSON.stringify(foreign))
const hourlyId = (await db.query(`select id from payslip_view where run_id=${run} and name='Lim'`)).rows[0].id
await db.query(`select save_payslip(${hourlyId}, '{"hours":100}'::jsonb)`)
const hourly = (await db.query(`select basic::float b, net_pay::float n from payslip_view where id=${hourlyId}`)).rows[0]
console.log(hourly.b === 1200 ? 'hourly pay ok' : 'FAIL hourly ' + JSON.stringify(hourly))
const jid = (await db.query(`select approve_payroll_run(${run}) j`)).rows[0].j
const jbal = (await db.query(`select coalesce(sum(debit - credit), 0)::float d from journal_lines where journal_id=${jid}`)).rows[0].d
const payable = (await db.query(`select sum(credit)::float c from journal_lines where journal_id=${jid} and account='2300'`)).rows[0].c
const netTotal = Number((await db.query(`select sum(net_pay)::float n from payslip_view where run_id=${run}`)).rows[0].n)
console.log(jbal === 0 && payable === netTotal ? 'payroll journal ok' : `FAIL payroll journal ${jbal} ${payable} vs ${netTotal}`)
try { await db.query(`select save_payslip(${hourlyId}, '{"hours":120}'::jsonb)`); console.log('FAIL: edited approved payroll') } catch (e) { console.log('approved payroll locked:', e.message) }
await db.query(`select cancel_payroll_run(${run})`)
const after = (await db.query(`select count(*)::int c from journals where id=${jid}`)).rows[0].c
console.log(after === 0 ? 'cancel payroll ok' : 'FAIL cancel payroll')

// ---- 005: daily sales import (figures from a real Zeoniq Bill Summary) ----
await db.exec(fs.readFileSync(new URL('../supabase/005_sales.sql', import.meta.url), 'utf8'))
const day = `select post_sales_day('2026-09-22', 1835.80, 183.58, 0, 0.02,
  '[{"code":"CASH","amount":165},{"code":"TNG","amount":158.20},{"code":"VISA","amount":1696.20}]'::jsonb) id`
const salesJ = (await db.query(day)).rows[0].id
const bal = (await db.query(`select coalesce(sum(debit - credit), 0)::float d from journal_lines where journal_id=${salesJ}`)).rows[0].d
const cash = (await db.query(`select sum(debit)::float d from journal_lines where journal_id=${salesJ} and account='1000'`)).rows[0].d
const card = (await db.query(`select sum(debit)::float d from journal_lines where journal_id=${salesJ} and account='1200'`)).rows[0].d
console.log(bal === 0 && cash === 165 && card === 1696.2 ? 'sales day ok' : `FAIL sales day ${bal} ${cash} ${card}`)
try { await db.query(day); console.log('FAIL: same day posted twice') } catch (e) { console.log('duplicate day rejected:', e.message.split('\n')[0]) }
try { await db.query(`select post_sales_day('2026-09-23', 500, 50, 0, 0,
  '[{"code":"CASH","amount":500}]'::jsonb)`); console.log('FAIL: payments not matching accepted') }
catch (e) { console.log('mismatch rejected:', e.message) }
try { await db.query(`select post_sales_day('2026-09-23', 500, 0, 0, 0,
  '[{"code":"BITCOIN","amount":500}]'::jsonb)`); console.log('FAIL: unknown payment accepted') }
catch (e) { console.log('unknown payment rejected:', e.message) }
await db.query(`select post_sales_day('2026-09-23', 522.80, 52.28, 0, 0.02,
  '[{"code":"TNG","amount":575.10}]'::jsonb, '[{"account":"4000","amount":300},{"account":"4010","amount":222.80}]'::jsonb)`)
const bev = (await db.query(`select sum(credit)::float c from journal_lines l join journals j on j.id=l.journal_id
  where j.source_ref='2026-09-23' and l.account='4010'`)).rows[0].c
console.log(bev === 222.8 ? 'category split ok' : 'FAIL category split ' + bev)

// ---- 007: Fiuu settlement (figures from a real Fiuu transaction listing) ----
await db.exec(fs.readFileSync(new URL('../supabase/007_fiuu.sql', import.meta.url), 'utf8'))
const fj = (await db.query(`select post_fiuu_settlement('2026-09-22', 3012.20, 45.18, 2967.02) id`)).rows[0].id
const fbal = (await db.query(`select coalesce(sum(debit - credit), 0)::float d from journal_lines where journal_id=${fj}`)).rows[0].d
const bank = (await db.query(`select sum(debit)::float d from journal_lines where journal_id=${fj} and account='1100'`)).rows[0].d
const fee = (await db.query(`select sum(debit)::float d from journal_lines where journal_id=${fj} and account='6200'`)).rows[0].d
console.log(fbal === 0 && bank === 2967.02 && fee === 45.18 ? 'fiuu settlement ok' : `FAIL fiuu ${fbal} ${bank} ${fee}`)
try { await db.query(`select post_fiuu_settlement('2026-09-23', 100, 5, 90)`); console.log('FAIL: gross/fee/net mismatch accepted') }
catch (e) { console.log('fiuu mismatch rejected:', e.message) }

// ---- 008: director's account ----
await db.exec(fs.readFileSync(new URL('../supabase/008_director.sql', import.meta.url), 'utf8'))
const sup3 = (await db.query(`insert into suppliers (name) values ('Ice Supplier') returning id`)).rows[0].id
const inv3 = (await db.query(`select create_purchase_invoice(${sup3}, 'INV-77', '2026-09-20', '2026-10-20', 'Ice', '[{"account":"5100","amount":180}]'::jsonb) id`)).rows[0].id
await db.query(`select pay_supplier(${sup3}, '2026-09-25', '2500', 'director paid', '[{"invoice_id":${inv3},"amount":180}]'::jsonb)`)
const owedDirector = Number((await db.query(`select coalesce(sum(credit - debit), 0)::float d from journal_lines where account='2500'`)).rows[0].d)
const supOwing = Number((await db.query(`select outstanding::float o from purchase_invoice_status where id=${inv3}`)).rows[0].o)
console.log(owedDirector === 180 && supOwing === 0 ? 'director paid supplier ok' : `FAIL director ${owedDirector} ${supOwing}`)
// Paying the director back from the bank clears it.
await db.query(`select post_journal('2026-09-30','Repay director','pv',null,null,
  '[{"account":"2500","debit":180},{"account":"1100","credit":180}]'::jsonb)`)
const after8 = Number((await db.query(`select coalesce(sum(credit - debit), 0)::float d from journal_lines where account='2500'`)).rows[0].d)
console.log(after8 === 0 ? 'director repaid ok' : 'FAIL director repaid ' + after8)

// ---- 009: Fiuu settlement split by card type ----
await db.exec(fs.readFileSync(new URL('../supabase/009_fiuu_brands.sql', import.meta.url), 'utf8'))
const bj = (await db.query(`select post_fiuu_settlement('2026-09-26', 1000, 15, 985, '1100', 'test',
  '[{"brand":"Visa","gross":600,"fee":9},{"brand":"MyDebit Card Present","gross":400,"fee":6}]'::jsonb) id`)).rows[0].id
const bbal = (await db.query(`select coalesce(sum(debit - credit), 0)::float d from journal_lines where journal_id=${bj}`)).rows[0].d
const visaFee = (await db.query(`select sum(debit)::float d from journal_lines where journal_id=${bj} and account='6200' and memo='Visa fee'`)).rows[0].d
const byType = (await db.query(`select count(*)::int c from card_fees_by_type where date='2026-09-26'`)).rows[0].c
console.log(bbal === 0 && visaFee === 9 && byType === 2 ? 'fiuu by card type ok' : `FAIL fiuu brands ${bbal} ${visaFee} ${byType}`)
try { await db.query(`select post_fiuu_settlement('2026-09-27', 1000, 15, 985, '1100', null,
  '[{"brand":"Visa","gross":600,"fee":9}]'::jsonb)`); console.log('FAIL: card type totals not checked') }
catch (e) { console.log('card type mismatch rejected:', e.message.split(' do not')[0] + ' do not match') }

// ---- 011: re-split a day that was posted as one line ----
for (const f of ['006_categories.sql', '010_item_groups.sql', '011_resplit.sql'])
  await db.exec(fs.readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8'))
await db.query(`select post_sales_day('2026-09-28', 1000, 100, 0, 0,
  '[{"code":"CASH","amount":1100}]'::jsonb)`)
await db.query(`select resplit_sales_day('2026-09-28',
  '[{"account":"4000","amount":300},{"account":"4010","amount":200},{"account":"4020","amount":500}]'::jsonb)`)
const rs = (await db.query(`select l.account, l.credit::float c from journal_lines l
  join journals j on j.id = l.journal_id where j.source_ref='2026-09-28' and l.credit > 0 order by l.account`)).rows
const rsBal = (await db.query(`select coalesce(sum(l.debit - l.credit), 0)::float d from journal_lines l
  join journals j on j.id = l.journal_id where j.source_ref='2026-09-28'`)).rows[0].d
const liquor = rs.find(r => r.account === '4020')?.c
console.log(rsBal === 0 && liquor === 500 && rs.length === 4 ? 'resplit ok' : `FAIL resplit ${rsBal} ${JSON.stringify(rs)}`)
try { await db.query(`select resplit_sales_day('2026-09-28', '[{"account":"4000","amount":999}]'::jsonb)`)
  console.log('FAIL: resplit total not checked') }
catch (e) { console.log('resplit mismatch rejected:', e.message.split(' does not')[0] + ' does not match') }

// ---- 012: stock and cost of sales ----
await db.exec(fs.readFileSync(new URL('../supabase/012_stock.sql', import.meta.url), 'utf8'))
await db.query(`select note_items('[{"code":"ac01","name":"CARLSBERG (1 MUG)","date":"2026-09-19"},
  {"code":"F05","name":"CHICKEN CHOP","date":"2026-09-19"}]'::jsonb)`)
await db.query(`update item_costs set unit_cost = 6.50 where code = 'AC01'`)
await db.query(`select note_items('[{"code":"AC01","name":"other name","date":"2026-09-20"}]'::jsonb)`)
const ic = (await db.query(`select name, unit_cost::float c, last_seen::text s from item_costs where code='AC01'`)).rows[0]
console.log(ic.c === 6.5 && ic.name === 'CARLSBERG (1 MUG)' && ic.s === '2026-09-20' ? 'item costs ok' : 'FAIL item costs ' + JSON.stringify(ic))

// Buy stock, sell some of it, count what is left.
const acctBal = async acct => Number((await db.query(`select coalesce(sum(debit - credit), 0)::float v from journal_lines where account='${acct}'`)).rows[0].v)
const costBefore = await acctBal('5020')
await db.query(`select create_purchase_invoice(${s2}, 'BEER-1', '2026-09-19', '2026-10-19', 'Beer stock',
  '[{"account":"1420","amount":1000}]'::jsonb)`)
await db.query(`select post_cogs_day('2026-09-20', '[{"sales_account":"4020","amount":400}]'::jsonb)`)
let stock = await acctBal('1420')
let cost = round(await acctBal('5020') - costBefore)
console.log(stock === 600 && cost === 400 ? 'cogs ok' : `FAIL cogs stock ${stock} cost ${cost}`)
// Posting the same day again replaces it, never doubles.
await db.query(`select post_cogs_day('2026-09-20', '[{"sales_account":"4020","amount":450}]'::jsonb)`)
stock = await acctBal('1420')
console.log(stock === 550 ? 'cogs repost ok' : 'FAIL cogs repost ' + stock)
// Count says 500 on the shelf: the missing 50 becomes cost.
await db.query(`select post_stock_count('2026-09-30', '[{"stock_account":"1420","counted":500}]'::jsonb)`)
stock = await acctBal('1420')
cost = round(await acctBal('5020') - costBefore)
console.log(stock === 500 && cost === 500 ? 'stock count ok' : `FAIL stock count ${stock} ${cost}`)
