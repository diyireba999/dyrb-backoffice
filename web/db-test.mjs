import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const round = n => Math.round(n * 100) / 100
const db = new PGlite()
await db.exec(`
create schema auth; create schema storage; create role anon; create role authenticated;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql as $$ select current_setting('app.uid', true)::uuid $$;
create table storage.buckets (id text, name text, public bool);
create table storage.objects (bucket_id text, owner uuid, name text);
create function storage.foldername(p text) returns text[] language sql immutable as $$ select string_to_array(p, '/') $$;
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

// ---- 014: monthly accruals ----
await db.exec(fs.readFileSync(new URL('../supabase/013_accruals.sql', import.meta.url), 'utf8'))
await db.exec(fs.readFileSync(new URL('../supabase/014_recurring.sql', import.meta.url), 'utf8'))
await db.query(`select post_accruals('2026-09-01',
  '[{"account":"6100","amount":8000,"name":"Rent"},{"account":"6110","amount":600,"name":"TNB"}]'::jsonb)`)
let accrued = await acctBal('2600')
const rentCost = await acctBal('6100')
console.log(accrued === -8600 && rentCost === 8000 ? 'accruals ok' : `FAIL accruals ${accrued} ${rentCost}`)
// Posting the month again replaces it.
await db.query(`select post_accruals('2026-09-20', '[{"account":"6100","amount":8000,"name":"Rent"}]'::jsonb)`)
accrued = await acctBal('2600')
console.log(accrued === -8000 ? 'accrual repost ok' : 'FAIL accrual repost ' + accrued)
// The date used is the last day of that month.
const accDate = (await db.query(`select date::text d from journals where source='accrual'`)).rows[0].d
console.log(accDate === '2026-09-30' ? 'accrual date ok' : 'FAIL accrual date ' + accDate)

// ---- 015 / 016: fixes found in the pre-launch review ----
for (const f of ['015_fixes.sql', '016_fixes2.sql'])
  await db.exec(fs.readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8'))

// EPF leaves out overtime and service charge; SOCSO and EIS include them.
await db.exec(`insert into employees (name, is_local, pay_type, rate) values ('Mei', true, 'monthly', 2000)`)
const run2 = (await db.query(`select create_payroll_run('2026-10-01','2026-10-31') id`)).rows[0].id
const meiId = (await db.query(`select id from payslip_view where run_id=${run2} and name='Mei'`)).rows[0].id
await db.query(`select save_payslip(${meiId}, '{"ot_amount":300,"service_charge":200}'::jsonb)`)
const mei = (await db.query(`select epf_employee::float ee, socso_employee::float se from payslip_view where id=${meiId}`)).rows[0]
// EPF on 2000 = 220; SOCSO on 2500 = 12.50
console.log(mei.ee === 220 && mei.se === 12.5 ? 'statutory wage base ok' : 'FAIL wage base ' + JSON.stringify(mei))

// Deleting a sales day takes its cost of sales with it.
await db.query(`select post_sales_day('2026-10-05', 500, 50, 0, 0, '[{"code":"CASH","amount":550}]'::jsonb)`)
await db.query(`select post_cogs_day('2026-10-05', '[{"sales_account":"4020","amount":150}]'::jsonb)`)
const salesId = (await db.query(`select id from journals where source='sales' and source_ref='2026-10-05'`)).rows[0].id
await db.query(`select delete_journal(${salesId})`)
const leftover = (await db.query(`select count(*)::int c from journals where source='cogs' and source_ref='2026-10-05'`)).rows[0].c
console.log(leftover === 0 ? 'cogs removed with its sales day ok' : 'FAIL orphan cogs ' + leftover)

// Posting nothing must not wipe what is already there.
await db.query(`select post_accruals('2026-11-01','[{"account":"6100","amount":5000,"name":"Rent"}]'::jsonb)`)
await db.query(`select post_accruals('2026-11-01','[{"account":"6100","amount":0,"name":"Rent"}]'::jsonb)`)
const kept = (await db.query(`select count(*)::int c from journals where source='accrual' and source_ref='2026-11-01'`)).rows[0].c
console.log(kept === 1 ? 'empty repost keeps the entry ok' : 'FAIL accrual wiped ' + kept)

// A purchase of stock may not be booked straight to cost.
try { await db.query(`select create_purchase_invoice(${s2}, 'X1', '2026-10-01', '2026-10-31', 'Beer',
  '[{"account":"5020","amount":100}]'::jsonb)`); console.log('FAIL: purchase booked to cost account') }
catch (e) { console.log('purchase to cost account rejected:', e.message.split(' —')[0]) }

// A re-split may only touch sales accounts.
await db.query(`select post_sales_day('2026-10-06', 600, 60, 0, 0, '[{"code":"CASH","amount":660}]'::jsonb)`)
try { await db.query(`select resplit_sales_day('2026-10-06','[{"account":"4100","amount":600}]'::jsonb)`)
  console.log('FAIL: re-split wrote to the service charge account') }
catch (e) { console.log('re-split to a non-sales account rejected:', e.message) }

// Cancelling a payment that is not there is an error, not a quiet success.
try { await db.query(`select cancel_supplier_payment(999999)`); console.log('FAIL: cancelled a payment that does not exist') }
catch (e) { console.log('missing payment rejected:', e.message) }

// ---- 017: corkage has no cost ----
await db.exec(fs.readFileSync(new URL('../supabase/017_corkage.sql', import.meta.url), 'utf8'))
const corkAcct = (await db.query(`select account from item_category_map where prefix='OP'`)).rows[0].account
const hasCosting = (await db.query(`select count(*)::int c from category_costing where sales_account='4030'`)).rows[0].c
console.log(corkAcct === '4030' && hasCosting === 0 ? 'corkage income ok' : `FAIL corkage ${corkAcct} ${hasCosting}`)
// A day can still be split with corkage in it.
await db.query(`select post_sales_day('2026-10-08', 700, 70, 0, 0, '[{"code":"CASH","amount":770}]'::jsonb)`)
await db.query(`select resplit_sales_day('2026-10-08','[{"account":"4020","amount":500},{"account":"4030","amount":200}]'::jsonb)`)
const cork = Number((await db.query(`select coalesce(sum(l.credit),0)::float v from journal_lines l
  join journals j on j.id=l.journal_id where j.source_ref='2026-10-08' and l.account='4030'`)).rows[0].v)
console.log(cork === 200 ? 'corkage split ok' : 'FAIL corkage split ' + cork)

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
const genDoc = (await db.query(`select id from journals where source='sales' limit 1`)).rows[0].id
try { await db.query(`select update_journal(${genDoc}, '2026-10-11','x',null,null,
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

// A supplier payment funded from a director account can be edited.
const supDir = (await db.query(`insert into suppliers (name) values ('Dir Test Supplier') returning id`)).rows[0].id
const invDir = (await db.query(`select create_purchase_invoice(${supDir}, 'DIR1', '2026-10-15', '2026-11-15',
  'Director purchase', '[{"account":"5100","amount":200}]'::jsonb) id`)).rows[0].id
const payDir = (await db.query(`select pay_supplier(${supDir}, '2026-10-20', '2500', 'DIRPAY',
  '[{"invoice_id":${invDir},"amount":200}]'::jsonb) id`)).rows[0].id
await db.query(`select update_supplier_payment(${payDir}, '2026-10-22', '2500', 'DIRPAY2',
  '[{"invoice_id":${invDir},"amount":200}]'::jsonb)`)
const dirpay = (await db.query(`select sp.date::text date, j.reference from supplier_payments sp
  join journals j on j.id=sp.journal_id where sp.id=${payDir}`)).rows[0]
console.log(dirpay.date === '2026-10-22' && dirpay.reference === 'DIRPAY2'
  ? 'director account payment edit ok' : 'FAIL dir pay ' + JSON.stringify(dirpay))

// Deactivated account rejects purchase invoice edit.
const supDeact = (await db.query(`insert into suppliers (name) values ('Deact Test Supplier') returning id`)).rows[0].id
const invDeact = (await db.query(`select create_purchase_invoice(${supDeact}, 'DEACT1', '2026-10-15', '2026-11-15',
  'Test deactivation', '[{"account":"5100","amount":50}]'::jsonb) id`)).rows[0].id
await db.exec(`update accounts set active=false where code='5100'`)
try { await db.query(`select update_purchase_invoice(${invDeact}, 'DEACT2', '2026-10-13', '2026-11-13',
  'x', '[{"account":"5100","amount":80}]'::jsonb)`)
  console.log('FAIL: deactivated account accepted on invoice edit') }
catch (e) { console.log('deactivated account on invoice edit rejected:', e.message) }
await db.exec(`update accounts set active=true where code='5100'`)

// Deactivated account rejects supplier payment edit.
const supPayDeact = (await db.query(`insert into suppliers (name) values ('Pay Deact Test Supplier') returning id`)).rows[0].id
const invPayDeact = (await db.query(`select create_purchase_invoice(${supPayDeact}, 'PAYDEACT1', '2026-10-15', '2026-11-15',
  'Test pay deactivation', '[{"account":"5100","amount":100}]'::jsonb) id`)).rows[0].id
const payPayDeact = (await db.query(`select pay_supplier(${supPayDeact}, '2026-10-20', '1100', 'CHQ_DEACT',
  '[{"invoice_id":${invPayDeact},"amount":100}]'::jsonb) id`)).rows[0].id
await db.exec(`update accounts set active=false where code='1100'`)
try { await db.query(`select update_supplier_payment(${payPayDeact}, '2026-10-21', '1100', 'CHQ_DEACT2',
  '[{"invoice_id":${invPayDeact},"amount":100}]'::jsonb)`)
  console.log('FAIL: deactivated account accepted on payment edit') }
catch (e) { console.log('deactivated account on payment edit rejected:', e.message) }
await db.exec(`update accounts set active=true where code='1100'`)

// A posted day can be replaced outright, leaving exactly one sales entry for it.
await db.exec(`update profiles set role='owner'`)
await db.query(`select post_sales_day('2026-10-14', 1000, 100, 0, 0,
  '[{"code":"CASH","amount":1100}]'::jsonb)`)
await db.query(`select replace_sales_day('2026-10-14', 1200, 120, 0, 0,
  '[{"code":"CASH","amount":1320}]'::jsonb)`)
const repDay = (await db.query(`select count(*)::int c,
  coalesce(sum(l.debit),0)::float cash from journals j
  join journal_lines l on l.journal_id=j.id and l.account='1000'
  where j.source='sales' and j.source_ref='2026-10-14'`)).rows[0]
const repDayN = (await db.query(`select count(*)::int c from journals
  where source='sales' and source_ref='2026-10-14'`)).rows[0].c
console.log(repDayN === 1 && repDay.cash === 1320
  ? 'replace sales day ok' : `FAIL replace day ${repDayN} ${repDay.cash}`)

// Only the owner may replace a day that is already in the books.
await db.exec(`update profiles set role='manager'`)
try { await db.query(`select replace_sales_day('2026-10-14', 900, 90, 0, 0,
  '[{"code":"CASH","amount":990}]'::jsonb)`)
  console.log('FAIL: manager replaced a posted day') }
catch (e) { console.log('manager blocked from replacing a day:', e.message) }
await db.exec(`update profiles set role='owner'`)

// A day whose cash line is reconciled must be unticked first.
const repDayLine = (await db.query(`select l.id from journal_lines l join journals j on j.id=l.journal_id
  where j.source='sales' and j.source_ref='2026-10-14' and l.account='1000' limit 1`)).rows[0].id
await db.query(`select set_cleared(array[${repDayLine}]::bigint[], '2026-10-31')`)
try { await db.query(`select replace_sales_day('2026-10-14', 800, 80, 0, 0,
  '[{"code":"CASH","amount":880}]'::jsonb)`)
  console.log('FAIL: replaced a reconciled day') }
catch (e) { console.log('reconciled day replace rejected:', e.message) }
await db.query(`select set_cleared(array[${repDayLine}]::bigint[], null)`)

// ---- Final review fixes: a reconciled document could be deleted around the edit guard ----

// A manual entry ticked on the bank reconciliation cannot be deleted; unticking allows it.
const delRecId = (await db.query(`select post_journal('2026-10-17','Test recon delete','manual',null,null,
  '[{"account":"6900","debit":9},{"account":"1000","credit":9}]'::jsonb) id`)).rows[0].id
const delRecLine = (await db.query(`select id from journal_lines where journal_id=${delRecId} and account='1000'`)).rows[0].id
await db.query(`select set_cleared(array[${delRecLine}]::bigint[], '2026-10-31')`)
try { await db.query(`select delete_journal(${delRecId})`); console.log('FAIL: deleted a reconciled entry') }
catch (e) { console.log('reconciled entry delete rejected:', e.message) }
await db.query(`select set_cleared(array[${delRecLine}]::bigint[], null)`)
await db.query(`select delete_journal(${delRecId})`)
const delRecGone = (await db.query(`select count(*)::int c from journals where id=${delRecId}`)).rows[0].c
console.log(delRecGone === 0 ? 'reconciled entry deleted after unticking ok' : 'FAIL reconciled delete after untick ' + delRecGone)

// A purchase invoice ticked on the bank reconciliation cannot be cancelled.
const supRecPi = (await db.query(`insert into suppliers (name) values ('Recon Test Supplier') returning id`)).rows[0].id
const invRecPi = (await db.query(`select create_purchase_invoice(${supRecPi}, 'RECON1', '2026-10-17', '2026-11-17',
  'Recon test', '[{"account":"5100","amount":40}]'::jsonb) id`)).rows[0].id
const invRecPiJournal = (await db.query(`select journal_id from purchase_invoices where id=${invRecPi}`)).rows[0].journal_id
const invRecPiLine = (await db.query(`select id from journal_lines where journal_id=${invRecPiJournal} and account='2000'`)).rows[0].id
await db.query(`select set_cleared(array[${invRecPiLine}]::bigint[], '2026-10-31')`)
try { await db.query(`select cancel_purchase_invoice(${invRecPi})`); console.log('FAIL: cancelled a reconciled purchase invoice') }
catch (e) { console.log('reconciled purchase invoice cancel rejected:', e.message) }
await db.query(`select set_cleared(array[${invRecPiLine}]::bigint[], null)`)

// A supplier payment ticked on the bank reconciliation cannot be cancelled.
const supRecSp = (await db.query(`insert into suppliers (name) values ('Recon Pay Supplier') returning id`)).rows[0].id
const invRecSp = (await db.query(`select create_purchase_invoice(${supRecSp}, 'RECON2', '2026-10-17', '2026-11-17',
  'Recon pay test', '[{"account":"5100","amount":60}]'::jsonb) id`)).rows[0].id
const payRecSp = (await db.query(`select pay_supplier(${supRecSp}, '2026-10-18', '1100', 'RECONPAY',
  '[{"invoice_id":${invRecSp},"amount":60}]'::jsonb) id`)).rows[0].id
const payRecSpJournal = (await db.query(`select journal_id from supplier_payments where id=${payRecSp}`)).rows[0].journal_id
const payRecSpLine = (await db.query(`select id from journal_lines where journal_id=${payRecSpJournal} and account='1100'`)).rows[0].id
await db.query(`select set_cleared(array[${payRecSpLine}]::bigint[], '2026-10-31')`)
try { await db.query(`select cancel_supplier_payment(${payRecSp})`); console.log('FAIL: cancelled a reconciled supplier payment') }
catch (e) { console.log('reconciled supplier payment cancel rejected:', e.message) }
await db.query(`select set_cleared(array[${payRecSpLine}]::bigint[], null)`)

// A JV with a 2000 line is fine when the journal already has a supplier attached.
const jvWithSupplier = (await db.query(`select post_journal('2026-10-17','JV with supplier','jv',null,null,
  '[{"account":"5000","debit":50},{"account":"2000","credit":50}]'::jsonb, ${sup}) id`)).rows[0].id
await db.query(`select update_journal(${jvWithSupplier}, '2026-10-17','JV with supplier (edited)',null,null,
  '[{"account":"5000","debit":70},{"account":"2000","credit":70}]'::jsonb)`)
const jvSupChk = (await db.query(`select supplier_id::int supplier_id,
  (select sum(l.credit)::float from journal_lines l where l.journal_id=journals.id and l.account='2000') owed
  from journals where id=${jvWithSupplier}`)).rows[0]
console.log(jvSupChk.supplier_id === sup && jvSupChk.owed === 70
  ? '2000 line with a supplier edited ok' : 'FAIL jv 2000 edit ' + JSON.stringify(jvSupChk))

// A journal with a 2000 line and no supplier is refused, with post_journal's own message.
try { await db.query(`select update_journal(${e1}, '2026-10-11','x',null,null,
  '[{"account":"5010","debit":5},{"account":"2000","credit":5}]'::jsonb)`)
  console.log('FAIL: 2000 line without a supplier accepted on edit') }
catch (e) { console.log(e.message === 'Choose which supplier (add them in Suppliers first)'
  ? '2000 line without a supplier on edit rejected correctly' : 'FAIL wrong message: ' + e.message) }

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

const advDoc = (await db.query(`select j.doc_no from staff_advances a join journals j on j.id=a.journal_id where a.id=${adv}`)).rows[0].doc_no
console.log(advDoc.startsWith('SA-') ? 'advance doc number ok' : 'FAIL advance doc no ' + advDoc)

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

// Advance recovery: the whole outstanding amount comes off the next payroll.
const run1 = (await db.query(`select create_payroll_run('2026-12-01', '2026-12-31') id`)).rows[0].id
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
const run3 = (await db.query(`select create_payroll_run('2026-11-01', '2026-11-30') id`)).rows[0].id
const slip2 = (await db.query(`select id from payslips where run_id=${run3} and employee_id=${emp2}`)).rows[0].id
await db.query(`select save_payslip(${slip2}, '{}'::jsonb, true)`)
const capped = (await db.query(`select advance_recovery::float ar, net_pay::float net from payslip_view where id=${slip2}`)).rows[0]
console.log(capped.ar === 1500 && capped.net === 0
  ? 'advance capped at net pay ok' : 'FAIL cap ' + JSON.stringify(capped))
await db.query(`select approve_payroll_run(${run3})`)
const carried = (await db.query(`select outstanding::float o from advance_balances where id=${bigAdv}`)).rows[0].o
console.log(carried === 500 ? 'advance remainder carried forward ok' : 'FAIL carry ' + carried)

// ---- 020: timesheet feeds the payroll run ----
await db.exec(fs.readFileSync(new URL('../supabase/020_timesheet.sql', import.meta.url), 'utf8'))
await db.exec(`update profiles set role='owner'`)

const hourlyTs = (await db.query(`insert into employees (name, pay_type, rate, epf_on, socso_on, eis_on)
  values ('Part timer', 'hourly', 10, false, false, false) returning id`)).rows[0].id
await db.exec(`insert into timesheets (employee_id, work_date, hours, ot_hours) values
  (${hourlyTs}, '2027-01-01', 8, 0), (${hourlyTs}, '2027-01-02', 7.5, 2), (${hourlyTs}, '2027-01-03', 6, 0)`)

const run4 = (await db.query(`select create_payroll_run('2027-01-01', '2027-01-31') id`)).rows[0].id
const slip3 = (await db.query(`select id from payslips where run_id=${run4} and employee_id=${hourlyTs}`)).rows[0].id
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
try { await db.exec(`insert into timesheets (employee_id, work_date, hours) values (${hourlyTs}, '2027-01-01', 5)`)
  console.log('FAIL: duplicate timesheet day accepted') }
catch (e) { console.log('duplicate timesheet day rejected:', e.message) }

// Negative hours are a typo, not a correction.
try { await db.exec(`insert into timesheets (employee_id, work_date, hours) values (${hourlyTs}, '2027-01-04', -3)`)
  console.log('FAIL: negative hours accepted') }
catch (e) { console.log('negative hours rejected:', e.message) }
await db.query(`select delete_payroll_run(${run4})`)

// A LOCAL hourly employee with statutory contributions switched on must get
// real EPF/SOCSO from their timesheet-derived basic, not 0. (The fixture
// employee above has epf_on/socso_on/eis_on all false, which hid this bug —
// use a fresh one with the (true) defaults instead.)
const hourlyLocal = (await db.query(`insert into employees (name, pay_type, rate)
  values ('Timesheet EPF Check', 'hourly', 10) returning id`)).rows[0].id
await db.exec(`insert into timesheets (employee_id, work_date, hours, ot_hours) values (${hourlyLocal}, '2027-02-01', 160, 0)`)
const run5 = (await db.query(`select create_payroll_run('2027-02-01', '2027-02-28') id`)).rows[0].id
const slip5 = (await db.query(`select basic::float basic, epf_employee::float epf, epf_employer::float epf_er,
  socso_employee::float socso, socso_employer::float socso_er
  from payslip_view where run_id=${run5} and employee_id=${hourlyLocal}`)).rows[0]
// 160 hours x RM10 = RM1,600 basic. EPF 11%/13% of 1600 rounded up; SOCSO 0.5%/1.75% of 1600.
console.log(slip5.basic === 1600 && slip5.epf === 176 && slip5.epf_er === 208 && slip5.socso === 8 && slip5.socso_er === 28
  ? 'hourly staff get real EPF/SOCSO from timesheet basic ok' : 'FAIL hourly statutory ' + JSON.stringify(slip5))
await db.query(`select delete_payroll_run(${run5})`)

// ---- 019/020 fix wave: stale advance recovery must not double-deduct ----

// (a) Two draft runs against the same advance: approving the first recovers
// it; the second must recover nothing, not a phantom second RM800.
const kumar = (await db.query(`insert into employees (name, pay_type, rate, epf_on, socso_on, eis_on)
  values ('Kumar', 'monthly', 2000, false, false, false) returning id`)).rows[0].id
const kumarAdv = (await db.query(`select record_advance(${kumar}, '2027-03-01', 800, '1000', null) id`)).rows[0].id
const run6 = (await db.query(`select create_payroll_run('2027-03-01', '2027-03-31') id`)).rows[0].id
const run7 = (await db.query(`select create_payroll_run('2027-04-01', '2027-04-30') id`)).rows[0].id
await db.query(`select approve_payroll_run(${run6})`)
const afterFirst = (await db.query(`select outstanding::float o from advance_balances where id=${kumarAdv}`)).rows[0].o
console.log(afterFirst === 0 ? 'first draft run recovered the advance ok' : 'FAIL first recovery ' + afterFirst)
await db.query(`select approve_payroll_run(${run7})`)
const slip7 = (await db.query(`select advance_recovery::float ar, net_pay::float net, gross::float gross
  from payslip_view where run_id=${run7} and employee_id=${kumar}`)).rows[0]
// Other active employees also get payroll runs here, some with their own
// outstanding advances — check the recovery row for THIS advance and run
// specifically, not the run's whole 1310 credit.
const run7Recovered = (await db.query(`select count(*)::int c from advance_recoveries where advance_id=${kumarAdv} and run_id=${run7}`)).rows[0].c
console.log(slip7.ar === 0 && slip7.net === slip7.gross && run7Recovered === 0
  ? 'second draft run on the same advance recovers nothing ok' : 'FAIL second recovery ' + JSON.stringify(slip7) + ' recovered rows ' + run7Recovered)

// (b) An advance deleted out from under a draft run must not still take money
// off that payslip when the run is approved.
const lim = (await db.query(`insert into employees (name, pay_type, rate, epf_on, socso_on, eis_on)
  values ('Lim', 'monthly', 2000, false, false, false) returning id`)).rows[0].id
const limAdv = (await db.query(`select record_advance(${lim}, '2027-05-01', 500, '1000', null) id`)).rows[0].id
const run8 = (await db.query(`select create_payroll_run('2027-05-01', '2027-05-31') id`)).rows[0].id
await db.query(`select delete_advance(${limAdv})`)
await db.query(`select approve_payroll_run(${run8})`)
const slip8 = (await db.query(`select advance_recovery::float ar, net_pay::float net, gross::float gross
  from payslip_view where run_id=${run8} and employee_id=${lim}`)).rows[0]
console.log(slip8.ar === 0 && slip8.net === slip8.gross
  ? 'advance deleted under a draft run recovers nothing on approval ok' : 'FAIL deleted-advance recovery ' + JSON.stringify(slip8))

// ---- 019 fix wave: delete_advance must respect a closed bank reconciliation ----
// Lands on the NEW reconciliation guard, not the earlier "already recovered"
// guard — this advance has no payroll recovery against it at all.
const farah = (await db.query(`insert into employees (name, pay_type, rate)
  values ('Farah', 'monthly', 2000) returning id`)).rows[0].id
const farahAdv = (await db.query(`select record_advance(${farah}, '2027-06-01', 300, '1100', null) id`)).rows[0].id
const farahJ = (await db.query(`select journal_id from staff_advances where id=${farahAdv}`)).rows[0].journal_id
const farahLine = (await db.query(`select id from journal_lines where journal_id=${farahJ} and account='1100'`)).rows[0].id
await db.query(`select set_cleared(array[${farahLine}]::bigint[], '2027-06-30')`)
try { await db.query(`select delete_advance(${farahAdv})`)
  console.log('FAIL: advance ticked on bank reconciliation was deleted') }
catch (e) { console.log(e.message === 'This entry is ticked on the bank reconciliation. Untick it there first.'
  ? 'advance on a closed reconciliation blocked from deletion ok' : 'FAIL wrong message: ' + e.message) }
