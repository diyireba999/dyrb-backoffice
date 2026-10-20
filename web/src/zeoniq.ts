// Reading the Zeoniq "Bill Summary Listing" export (one row per business day).
export type Day = {
  date: string            // YYYY-MM-DD
  sales: number           // net sales, after discount
  service: number         // service charge
  tax: number
  rounding: number
  netTotal: number        // what the report says the day comes to
  payments: { code: string; amount: number }[]
  posted?: boolean
  result?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

const num = (v: unknown) => {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Zeoniq writes 9/21/26 (month first) or 21/9/2026 (day first) depending on the
// export. Guessing row by row put 8/9/2026 in the wrong month, so the order is
// decided once for the whole file: day-first unless some row proves otherwise.
export type DateOrder = 'dmy' | 'mdy'

const parts = (v: unknown) => {
  const m = String(v ?? '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  return m ? [m[1], m[2], m[3]] : null
}

export function dateOrderOf(values: unknown[]): DateOrder {
  const ps = values.map(parts).filter((p): p is string[] => p !== null)
  for (const p of ps) {
    if (Number(p[0]) > 12) return 'dmy'
    if (Number(p[1]) > 12) return 'mdy'
  }
  // Nothing settles it (every day 1-12). A report covers one short range, so
  // take the order whose dates span fewer days: 10/1..10/12 read day-first
  // would stretch over eleven months.
  const span = (order: DateOrder) => {
    const d = ps.map(p => Date.parse(isoDate(p.join('/'), order)))
    return d.length ? Math.max(...d) - Math.min(...d) : 0
  }
  return span('mdy') < span('dmy') ? 'mdy' : 'dmy'
}

export const isoDate = (v: unknown, order: DateOrder = 'dmy') => {
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10)
  const p = parts(v)
  if (!p) return ''
  const y = p[2].length === 2 ? '20' + p[2] : p[2]
  const [day, month] = order === 'dmy' ? [p[0], p[1]] : [p[1], p[0]]
  return `${y}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

// The reader returns either rows, or one entry per sheet - accept both.
export function toRows(input: unknown): unknown[][] {
  const arr = (input ?? []) as unknown[]
  const first = arr[0] as { data?: unknown[][] } | undefined
  if (first && !Array.isArray(first) && Array.isArray(first.data)) {
    const sheets = arr as { data: unknown[][] }[]
    return sheets.flatMap(s => s.data)
  }
  return arr as unknown[][]
}

// ---- Which export is this? The daily close takes all three in one drop. ----
export type FileKind = 'bill' | 'items' | 'fiuu'

// Fiuu listings carry Settlement Date and Bill Amt on the first row. Both Zeoniq
// exports have a Business Date header; the Product Sales one is told apart by its
// "Item:" group rows or its Item Qty column (it also has a Net Total column, so that
// test comes last).
export function detectFile(input: unknown): FileKind | null {
  if (isFiuuReport(input)) return 'fiuu'
  const rows = toRows(input)
  const cell = (v: unknown) => String(v ?? '').trim()
  const first = (rows[0] ?? []).map(cell)
  if (first.includes('Settlement Date') && first.includes('Bill Amt')) return 'fiuu'
  const headIndex = rows.findIndex(r => r.some(c => cell(c) === 'Business Date'))
  if (headIndex < 0) return null
  const head = rows[headIndex].map(cell)
  if (rows.slice(headIndex + 1).some(r => cell(r[1]).startsWith('Item:'))) return 'items'
  if (head.includes('Item Qty')) return 'items' // an export with no items still names the file
  if (head.includes('Net Total')) return 'bill'
  return null
}

export function parseBillSummary(input: unknown): Day[] {
  const rows = toRows(input)
  const headIndex = rows.findIndex(r => r.some(c => String(c ?? '').trim() === 'Business Date'))
  if (headIndex < 0) throw new Error('This does not look like a Zeoniq Bill Summary export (no "Business Date" column).')
  const head = rows[headIndex].map(c => String(c ?? '').trim())
  const col = (name: string) => head.indexOf(name)
  const first = (names: string[]) => { const i = names.map(col).find(i => i >= 0); return i ?? -1 }

  const cDate = col('Business Date')
  const cSales = first(['Net Sales', 'Net Amount'])
  const cService = first(['Charges', 'Charges Amt Excl.'])
  const cTax = first(['Tax', 'Inclusive Tax Amount'])
  const cAdj = first(['Adj. Amount'])
  const cTotal = first(['Net Total'])
  if (cSales < 0 || cTotal < 0) throw new Error('Missing the Net Sales or Net Total column.')
  // Everything after Net Total is a payment type column.
  const payCols = head.map((name, i) => ({ name, i }))
    .filter(({ name, i }) => i > cTotal && name && !/count|qty|quantity|guest|void/i.test(name))
  const order = dateOrderOf(rows.slice(headIndex + 1).map(r => r[cDate]))

  const days: Day[] = []
  for (const row of rows.slice(headIndex + 1)) {
    if (/subtotal|grand total/i.test(String(row[cDate] ?? ''))) continue
    const date = isoDate(row[cDate], order)
    if (!date) continue
    days.push({
      date,
      sales: round2(num(row[cSales])),
      service: cService >= 0 ? round2(num(row[cService])) : 0,
      tax: cTax >= 0 ? round2(num(row[cTax])) : 0,
      rounding: cAdj >= 0 ? round2(num(row[cAdj])) : 0,
      netTotal: round2(num(row[cTotal])),
      payments: payCols.map(({ name, i }) => ({ code: name, amount: round2(num(row[i])) })).filter(p => p.amount !== 0),
    })
  }
  if (days.length === 0) throw new Error('No day rows found in the file.')
  return days
}

// The day only goes in if these agree with the report.
export const dayTotal = (d: Day) => round2(d.sales + d.service + d.tax + d.rounding)
export const paymentTotal = (d: Day) => round2(d.payments.reduce((s, p) => s + p.amount, 0))
export const daySuspect = (d: Day) => dayTotal(d) !== d.netTotal || paymentTotal(d) !== dayTotal(d)

// ---- Product Sales Listing: net sales per item, per day ----
export type ItemSale = { date: string; code: string; name: string; net: number; qty: number }

export function parseProductSales(input: unknown): ItemSale[] {
  const rows = toRows(input)
  const headIndex = rows.findIndex(r => r.some(c => String(c ?? '').trim() === 'Business Date'))
  if (headIndex < 0) throw new Error('This does not look like a Zeoniq Product Sales export (no "Business Date" column).')
  const head = rows[headIndex].map(c => String(c ?? '').trim())
  const cDate = head.indexOf('Business Date')
  const cNet = head.indexOf('Net Sales')
  const cQty = head.indexOf('Item Qty')
  if (cNet < 0) throw new Error('Missing the Net Sales column.')

  const out: ItemSale[] = []
  const order = dateOrderOf(rows.slice(headIndex + 1).map(r => r[cDate]))
  let code = '', name = ''
  for (const row of rows.slice(headIndex + 1)) {
    const label = String(row[1] ?? '').trim()
    if (label.startsWith('Item:')) {
      const item = label.slice(5).trim()
      const dash = item.indexOf('-')
      code = dash > 0 ? item.slice(0, dash) : item
      name = dash > 0 ? item.slice(dash + 1) : item
      continue
    }
    if (/subtotal|grand total/i.test(String(row[cDate] ?? ''))) continue
    const date = isoDate(row[cDate], order)
    if (!date || !code) continue
    const net = round2(num(row[cNet]))
    const qty = cQty >= 0 ? num(row[cQty]) : 0
    // A bundle (10 MUG) carries the money with no quantity; its units show up on
    // the single-item code with no money. Keep both, so cost and sales both work.
    if (net !== 0 || qty !== 0) out.push({ date, code, name, net, qty })
  }
  return out
}

export const codePrefix = (code: string) => (code.match(/^[A-Za-z]+/) ?? [''])[0].toUpperCase()

// Group one day's items into sales accounts. Any few-cent difference against the
// bill summary is put on the biggest line so the day still balances.
export function salesLinesFor(items: ItemSale[], map: Record<string, string>, target: number) {
  const byAccount = new Map<string, number>()
  const unknown = new Set<string>()
  for (const i of items) {
    const account = map[codePrefix(i.code)]
    if (!account) { unknown.add(codePrefix(i.code)); continue }
    byAccount.set(account, round2((byAccount.get(account) ?? 0) + i.net))
  }
  const lines = [...byAccount.entries()].map(([account, amount]) => ({ account, amount }))
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0))
  const diff = round2(target - sum)
  if (lines.length && diff !== 0 && Math.abs(diff) <= 0.05) {
    const biggest = lines.reduce((a, b) => (b.amount > a.amount ? b : a))
    biggest.amount = round2(biggest.amount + diff)
  }
  return { lines, sum, diff, unknown: [...unknown] }
}

// ---- Fiuu transaction listing: group settled card payments by payout day ----
export type Brand = { brand: string; count: number; gross: number; fee: number }
export type Settlement = {
  settleDate: string          // the day Fiuu paid it into the bank
  count: number
  gross: number               // what customers paid
  fee: number                 // Fiuu's cut
  net: number                 // what lands in the bank
  brands: Brand[]             // Visa, Mastercard, MyDebit... each has its own rate
  posted?: boolean
  booked?: { gross: number; fee: number; net: number }   // what an earlier posting put in the books
  result?: string
}

const dateOnly = (v: unknown, order: DateOrder = 'dmy') => {
  const s = String(v ?? '').trim()
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)            // 2026-10-01 10:55:18
  if (iso) return iso[1]
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/)          // 22-09-2026 13:49:21
  return m ? `${m[3]}-${m[2]}-${m[1]}` : isoDate(s.split(' ')[0], order)
}

// ---- Fiuu settlement report: one workbook, a sheet per list ----
// The newer export from the Fiuu portal. SETTLEMENT LIST has one row per payout
// (Amount = what the card payments came to after the card fee, Settle Amount =
// what reached the bank, Channels = the card types paid together); TRANSACTION
// LIST has every card payment with Bill Amt (gross) and Actual Amt (after the
// fee) but no settlement date. Fiuu pays each channel group in date order, so
// walking the payments in time until they add up to a payout tells which
// payments it covers, and so the gross and the fee per payout.
const sheetNamed = (input: unknown, name: string): unknown[][] | null => {
  if (!Array.isArray(input)) return null
  const s = (input as { sheet?: unknown; data?: unknown }[])
    .find(x => x && !Array.isArray(x) && String(x.sheet ?? '').trim().toUpperCase() === name)
  return s && Array.isArray(s.data) ? s.data as unknown[][] : null
}
export const isFiuuReport = (input: unknown) =>
  sheetNamed(input, 'SETTLEMENT LIST') !== null && sheetNamed(input, 'TRANSACTION LIST') !== null

function parseFiuuReport(input: unknown) {
  const pays = sheetNamed(input, 'SETTLEMENT LIST') ?? [], txs = sheetNamed(input, 'TRANSACTION LIST') ?? []
  const header = (rows: unknown[][]) => (rows[0] ?? []).map(c => String(c ?? '').trim())
  const ph = header(pays), th = header(txs)
  const pc = { date: ph.indexOf('Date'), amount: ph.indexOf('Amount'), net: ph.indexOf('Settle Amount'), channels: ph.indexOf('Channels') }
  const tc = { date: th.indexOf('Date'), channel: th.indexOf('Channel'), gross: th.indexOf('Bill Amt'), actual: th.indexOf('Actual Amt'), status: th.indexOf('Status') }
  if (Object.values(pc).some(i => i < 0) || Object.values(tc).some(i => i < 0)) throw new Error('This does not look like a Fiuu settlement report.')

  type Tx = { at: string; date: string; channel: string; gross: number; actual: number }
  let skipped = 0
  const settled: Tx[] = []
  for (const row of txs.slice(1)) {
    if (!row || !String(row[tc.gross] ?? '').trim()) continue
    if (String(row[tc.status] ?? '').toLowerCase() !== 'settled') { skipped++; continue }
    const at = String(row[tc.date] ?? '').trim()
    settled.push({ at, date: dateOnly(at), channel: String(row[tc.channel] ?? '').trim() || 'Card', gross: num(row[tc.gross]), actual: num(row[tc.actual]) })
  }
  type Payout = { at: string; settleDate: string; amount: number; net: number; channels: string[] }
  const payouts: Payout[] = pays.slice(1).filter(r => r && String(r[pc.net] ?? '').trim()).map(r => ({
    at: String(r[pc.date] ?? '').trim(), settleDate: dateOnly(r[pc.date]), amount: num(r[pc.amount]), net: num(r[pc.net]),
    channels: String(r[pc.channels] ?? '').split(',').map(c => c.trim()).filter(Boolean),
  }))
  // Payouts that share a channel list are one stream (cards and e-wallets; MyDebit and DuitNow).
  const groups = new Map<string, Payout[]>()
  for (const p of payouts) { const k = p.channels.join(','); groups.set(k, [...(groups.get(k) ?? []), p]) }
  const groupOf = (channel: string) => [...groups.entries()].find(([, ps]) => ps[0].channels.includes(channel))?.[0]

  const byDay = new Map<string, Settlement>()
  let pending = settled.filter(t => groupOf(t.channel) === undefined).length  // no payout stream for that channel yet
  for (const [key, ps] of groups) {
    const ts = settled.filter(t => groupOf(t.channel) === key).sort((a, b) => a.at.localeCompare(b.at))
    let i = 0
    for (const p of [...ps].sort((a, b) => a.at.localeCompare(b.at))) {
      let acc = 0
      const mine: Tx[] = []
      while (i < ts.length && acc < round2(p.amount) - 0.005) { acc = round2(acc + ts[i].actual); mine.push(ts[i]); i++ }
      if (Math.abs(acc - round2(p.amount)) > 0.005) {
        throw new Error(`The payout of ${p.settleDate} (${p.amount.toFixed(2)}) does not add up from the transaction list. Ask Fiuu for the transaction listing with settlement dates instead.`)
      }
      const gross = round2(mine.reduce((s, t) => s + t.gross, 0))
      const brands: Brand[] = []
      for (const t of mine) {
        const fee = round2(t.gross - t.actual)
        const b = brands.find(x => x.brand === t.channel)
        if (b) { b.count++; b.gross = round2(b.gross + t.gross); b.fee = round2(b.fee + fee) }
        else brands.push({ brand: t.channel, count: 1, gross: t.gross, fee })
      }
      // Fiuu's extra fees (Apple Pay and the like) are on the payout, not on a card
      // type; they go on the biggest card type so the fee lines still add up.
      const extra = round2(p.amount - p.net)
      if (extra && brands.length) {
        const big = brands.reduce((a, b) => (b.gross > a.gross ? b : a))
        big.fee = round2(big.fee + extra)
      }
      const d = byDay.get(p.settleDate) ?? { settleDate: p.settleDate, count: 0, gross: 0, fee: 0, net: 0, brands: [] }
      d.count += mine.length
      d.gross = round2(d.gross + gross)
      d.net = round2(d.net + p.net)
      d.fee = round2(d.gross - d.net)
      for (const b of brands) {
        const have = d.brands.find(x => x.brand === b.brand)
        if (have) { have.count += b.count; have.gross = round2(have.gross + b.gross); have.fee = round2(have.fee + b.fee) }
        else d.brands.push({ ...b })
      }
      byDay.set(p.settleDate, d)
    }
    pending += ts.length - i  // paid by card, not paid out within this report
  }
  const byTakingDay = new Map<string, number>()
  for (const t of settled) byTakingDay.set(t.date, round2((byTakingDay.get(t.date) ?? 0) + t.gross))
  return {
    settlements: [...byDay.values()].sort((a, b) => a.settleDate.localeCompare(b.settleDate)),
    takings: [...byTakingDay.entries()].sort().map(([date, gross]) => ({ date, gross })),
    pending, skipped,
  }
}

export function parseFiuu(input: unknown) {
  if (isFiuuReport(input)) return parseFiuuReport(input)
  const rows = toRows(input)
  const head = (rows[0] ?? []).map(c => String(c ?? '').trim())
  const col = (name: string) => head.indexOf(name)
  const cSettle = col('Settlement Date'), cGross = col('Bill Amt'), cFee = col('Transaction Fee')
  const cNet = col('Net Amount'), cStatus = col('Status'), cDate = col('Date')
  const cBrand = col('Channel') >= 0 ? col('Channel') : col('Card Brand')
  if (cSettle < 0 || cGross < 0 || cNet < 0) throw new Error('This does not look like a Fiuu transaction listing.')

  const byDay = new Map<string, Settlement>()
  let pending = 0, skipped = 0
  for (const row of rows.slice(1)) {
    if (!row || !String(row[cGross] ?? '').trim()) continue
    if (cStatus >= 0 && String(row[cStatus]).toLowerCase() !== 'settled') { skipped++; continue }
    const settleDate = dateOnly(row[cSettle])
    if (!settleDate) { pending++; continue }
    const d = byDay.get(settleDate) ?? { settleDate, count: 0, gross: 0, fee: 0, net: 0, brands: [] }
    const gross = num(row[cGross]), fee = cFee >= 0 ? num(row[cFee]) : 0
    d.count++
    d.gross = round2(d.gross + gross)
    d.fee = round2(d.fee + fee)
    d.net = round2(d.net + num(row[cNet]))
    const brandName = (cBrand >= 0 ? String(row[cBrand] ?? '') : '').trim() || 'Card'
    const brand = d.brands.find(b => b.brand === brandName)
    if (brand) { brand.count++; brand.gross = round2(brand.gross + gross); brand.fee = round2(brand.fee + fee) }
    else d.brands.push({ brand: brandName, count: 1, gross: round2(gross), fee: round2(fee) })
    byDay.set(settleDate, d)
  }
  // Takings per day of sale, to compare with the POS card figures.
  const byTakingDay = new Map<string, number>()
  if (cDate >= 0) {
    for (const row of rows.slice(1)) {
      if (cStatus >= 0 && String(row[cStatus]).toLowerCase() !== 'settled') continue
      const d = dateOnly(row[cDate])
      if (d) byTakingDay.set(d, round2((byTakingDay.get(d) ?? 0) + num(row[cGross])))
    }
  }
  return {
    settlements: [...byDay.values()].sort((a, b) => a.settleDate.localeCompare(b.settleDate)),
    takings: [...byTakingDay.entries()].sort().map(([date, gross]) => ({ date, gross })),
    pending, skipped,
  }
}

// Cost of what was sold on a day, per sales account: quantity x cost per unit.
export function cogsLinesFor(items: ItemSale[], groups: Record<string, string>, costs: Record<string, number>) {
  const byAccount = new Map<string, number>()
  const missing = new Set<string>()
  for (const i of items) {
    if (!i.qty) continue
    const account = groups[codePrefix(i.code)]
    const cost = costs[i.code.toUpperCase()]
    if (!account) continue
    if (!cost) { if (i.qty) missing.add(i.code) ; continue }
    byAccount.set(account, round2((byAccount.get(account) ?? 0) + i.qty * cost))
  }
  return {
    lines: [...byAccount.entries()].map(([sales_account, amount]) => ({ sales_account, amount })),
    total: round2([...byAccount.values()].reduce((s, v) => s + v, 0)),
    missing: [...missing],
  }
}
