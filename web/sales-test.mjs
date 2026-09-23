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

// Product Sales split (optional second file)
const prodFile = process.argv[3] ?? 'C:/Users/DELL/Downloads/ProductSales.xlsx'
if (fs.existsSync(prodFile)) {
  const { parseProductSales, salesLinesFor, codePrefix } = await import('./src/zeoniq.ts')
  const items = parseProductSales(await readXlsxFile(prodFile))
  console.log(`\n${items.length} item lines read from ${prodFile}`)
  const map = { AC: '4020', DC: '4020', BB: '4020', CT: '4020', OP: '4020', NA: '4010', F: '4000', T: '4000', XS: '4000' }
  const prefixes = [...new Set(items.map(i => codePrefix(i.code)))]
  const missing = prefixes.filter(p => !map[p])
  console.log(missing.length ? `FAIL unmapped item codes: ${missing.join(', ')}` : `all ${prefixes.length} item code groups mapped`)
  for (const d of days) {
    const dayItems = items.filter(i => i.date === d.date)
    if (!dayItems.length) continue
    const { lines, sum, diff } = salesLinesFor(dayItems, map, d.sales)
    const names = { '4000': 'food', '4010': 'beverage', '4020': 'liquor' }
    console.log(`${d.date} bill summary ${d.sales} | products ${sum} (diff ${diff}) | ${lines.map(l => `${names[l.account]} ${l.amount}`).join(', ')}`)
  }
}
