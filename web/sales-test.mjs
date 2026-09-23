// Checks the Zeoniq parser against a real export: node sales-test.mjs <file.xlsx>
import readXlsxFile from 'read-excel-file/node'
import { parseBillSummary, dayTotal, paymentTotal, daySuspect } from './src/zeoniq.ts'

import fs from 'fs'
const file = process.argv[2] ?? 'C:/Users/DELL/Downloads/BillSummary.xlsx'
if (!fs.existsSync(file)) { console.log(`No file at ${file} - pass one: npm run test:sales -- <file.xlsx>`); process.exit(0) }
const days = parseBillSummary(await readXlsxFile(file))
console.log(`${days.length} days read from ${file}`)
let bad = 0
for (const d of days) {
  const ok = !daySuspect(d)
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${d.date} sales ${d.sales} + service ${d.service} + tax ${d.tax} + rounding ${d.rounding} = ${dayTotal(d)} | report ${d.netTotal} | payments ${paymentTotal(d)} (${d.payments.map(p => p.code + ' ' + p.amount).join(', ')})`)
}
console.log(bad === 0 ? 'all days add up ok' : `FAIL ${bad} day(s) do not add up`)
