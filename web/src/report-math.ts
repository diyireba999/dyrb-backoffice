// Pure report logic: P&L section rule and figure formatting shared with the statement, and the monthly P&L lines.
// No imports: this file is run by the Node assert tests.

type AccountLike = { code: string; name: string; type: string }

export type PlSection = 'sales' | 'service' | 'other' | 'cost' | 'opex'

// Which P&L block an account belongs to, by chart code. Service charge is shown
// on its own because it is passed on to staff; the margins are measured on food
// and drink sales only.
export function plSection(a: { code: string; type: string }): PlSection | null {
  if (a.type === 'income') return a.code < '4100' ? 'sales' : a.code < '4900' ? 'service' : 'other'
  if (a.type === 'expense') return a.code < '6000' ? 'cost' : 'opex'
  return null
}

// Mirrors round2 in lib.ts (no imports allowed here); keep the two the same.
const round2 = (n: number) => Math.round(n * 100) / 100

// Statement figures: no "RM" on every cell, negatives in brackets.
export const fig = (v: number) => {
  const s = Math.abs(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return round2(v) < 0 ? `(${s})` : s
}

// '+12.3%', '-4.0%', 'new' when there was nothing before, '' when both are zero.
export const change = (cur: number, prev: number) => {
  if (round2(prev) === 0) return round2(cur) === 0 ? '' : 'new'
  const p = ((cur - prev) / Math.abs(prev)) * 100
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`
}

export type MonthlyLine = {
  kind: 'head' | 'item' | 'sub' | 'total' | 'grand' | 'pct'
  label: string
  code?: string
  values: (number | null)[]   // one per month given; null = month not loaded, or % with no sales
  total: number | null        // across loaded months; for pct rows, total profit / total sales
}

type Vec = (number | null)[]
const sumLoaded = (v: Vec): number | null =>
  v.some(x => x !== null) ? round2(v.reduce<number>((s, x) => s + (x ?? 0), 0)) : null
const combine = (a: Vec, b: Vec, f: (x: number, y: number) => number): Vec =>
  a.map((x, i) => { const y = b[i]; return x === null || y === null || y === undefined ? null : round2(f(x, y)) })
const pct = (part: Vec, whole: Vec): Vec =>
  part.map((p, i) => { const w = whole[i]; return p === null || !w ? null : round2((p / w) * 100) })
const pctTotal = (part: Vec, whole: Vec): number | null => {
  const p = sumLoaded(part), w = sumLoaded(whole)
  return p === null || !w ? null : round2((p / w) * 100)
}

// `months[i]` is the account net map (debit − credit) for month i, or null when
// that month is not loaded (a future month of the current year).
export function monthlyLines(accounts: AccountLike[], months: (Map<string, number> | null)[]): MonthlyLine[] {
  const base: Vec = months.map(m => (m ? 0 : null))
  const line = (kind: MonthlyLine['kind'], label: string, values: Vec, code?: string): MonthlyLine =>
    ({ kind, label, code, values, total: sumLoaded(values) })
  const section = (s: PlSection) => {
    const sign = s === 'cost' || s === 'opex' ? 1 : -1
    const items = accounts.filter(a => plSection(a) === s)
      .map(a => line('item', a.name, months.map(m => (m ? round2(sign * (m.get(a.code) ?? 0)) : null)), a.code))
      .filter(l => l.values.some(v => v !== null && v !== 0))
    const sum = items.reduce((acc, l) => combine(acc, l.values, (x, y) => x + y), base)
    return { items, sum }
  }
  const block = (label: string, g: { items: MonthlyLine[]; sum: Vec }, totalLabel: string, always = true): MonthlyLine[] =>
    always || g.items.length ? [line('head', label, base.map(() => null)), ...g.items, line('sub', totalLabel, g.sum)] : []

  const sales = section('sales'), cost = section('cost'), service = section('service'), other = section('other'), opex = section('opex')
  const gross = combine(sales.sum, cost.sum, (x, y) => x - y)
  const net = combine(combine(combine(gross, service.sum, (x, y) => x + y), other.sum, (x, y) => x + y), opex.sum, (x, y) => x - y)
  const netTotal = sumLoaded(net)
  return [
    ...block('Sales', sales, 'Total sales'),
    ...block('Cost of sales', cost, 'Total cost of sales'),
    line('total', 'Gross profit', gross),
    ...block('Service charge', service, 'Total service charge', false),
    ...block('Other income', other, 'Total other income', false),
    ...block('Operating expenses', opex, 'Total operating expenses'),
    line('grand', netTotal !== null && netTotal < 0 ? 'Net loss' : 'Net profit', net),
    { kind: 'pct', label: 'Gross profit % of sales', values: pct(gross, sales.sum), total: pctTotal(gross, sales.sum) },
    { kind: 'pct', label: 'Net profit % of sales', values: pct(net, sales.sum), total: pctTotal(net, sales.sum) },
  ]
}
