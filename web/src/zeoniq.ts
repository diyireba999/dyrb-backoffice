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

export const isoDate = (v: unknown) => {
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10)
  const s = String(v ?? '').trim()
  // Zeoniq writes 9/21/26 (month/day/year) or 21/9/2026 depending on the export.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!m) return ''
  const [, a, b, yy] = m
  const y = yy.length === 2 ? '20' + yy : yy
  const [month, day] = Number(a) > 12 ? [b, a] : [a, b]
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
  const payCols = head.map((name, i) => ({ name, i })).filter(({ name, i }) => i > cTotal && name)

  const days: Day[] = []
  for (const row of rows.slice(headIndex + 1)) {
    if (/subtotal|grand total/i.test(String(row[cDate] ?? ''))) continue
    const date = isoDate(row[cDate])
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
export type ItemSale = { date: string; code: string; name: string; net: number }

export function parseProductSales(input: unknown): ItemSale[] {
  const rows = toRows(input)
  const headIndex = rows.findIndex(r => r.some(c => String(c ?? '').trim() === 'Business Date'))
  if (headIndex < 0) throw new Error('This does not look like a Zeoniq Product Sales export (no "Business Date" column).')
  const head = rows[headIndex].map(c => String(c ?? '').trim())
  const cDate = head.indexOf('Business Date')
  const cNet = head.indexOf('Net Sales')
  if (cNet < 0) throw new Error('Missing the Net Sales column.')

  const out: ItemSale[] = []
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
    const date = isoDate(row[cDate])
    if (!date || !code) continue
    const net = round2(num(row[cNet]))
    if (net !== 0) out.push({ date, code, name, net })
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
export type Settlement = {
  settleDate: string          // the day Fiuu paid it into the bank
  count: number
  gross: number               // what customers paid
  fee: number                 // Fiuu's cut
  net: number                 // what lands in the bank
  posted?: boolean
  result?: string
}

const dateOnly = (v: unknown) => {
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/)          // 22-09-2026 13:49:21
  return m ? `${m[3]}-${m[2]}-${m[1]}` : isoDate(s.split(' ')[0])
}

export function parseFiuu(input: unknown) {
  const rows = toRows(input)
  const head = (rows[0] ?? []).map(c => String(c ?? '').trim())
  const col = (name: string) => head.indexOf(name)
  const cSettle = col('Settlement Date'), cGross = col('Bill Amt'), cFee = col('Transaction Fee')
  const cNet = col('Net Amount'), cStatus = col('Status'), cDate = col('Date')
  if (cSettle < 0 || cGross < 0 || cNet < 0) throw new Error('This does not look like a Fiuu transaction listing.')

  const byDay = new Map<string, Settlement>()
  let pending = 0, skipped = 0
  for (const row of rows.slice(1)) {
    if (!row || !String(row[cGross] ?? '').trim()) continue
    if (cStatus >= 0 && String(row[cStatus]).toLowerCase() !== 'settled') { skipped++; continue }
    const settleDate = dateOnly(row[cSettle])
    if (!settleDate) { pending++; continue }
    const d = byDay.get(settleDate) ?? { settleDate, count: 0, gross: 0, fee: 0, net: 0 }
    d.count++
    d.gross = round2(d.gross + num(row[cGross]))
    d.fee = round2(d.fee + (cFee >= 0 ? num(row[cFee]) : 0))
    d.net = round2(d.net + num(row[cNet]))
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
