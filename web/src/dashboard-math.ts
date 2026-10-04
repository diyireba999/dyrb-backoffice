// Pure arithmetic for the dashboard. No React, no Supabase — so it can be tested
// with plain Node asserts, which nothing else in the front end is.

export type DayAmount = { date: string; amount: number | string }

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0

// YYYY-MM-DD shifted by whole days, via UTC so no timezone can move the date.
export function addDaysISO(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const sameWeekdayLastWeek = (date: string) => addDaysISO(date, -7)

// month is 'YYYY-MM'. Day 0 of the next month is the last day of this one.
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// Inclusive of both ends. Amounts may arrive from PostgREST as strings.
export function sumRange(days: DayAmount[], from: string, to: string): number {
  return days.reduce((s, d) => (d.date >= from && d.date <= to ? s + n(d.amount) : s), 0)
}

// The share of each ringgit of sales that is eaten by costs which scale with it:
// the stock behind what was sold, plus the card processor's cut.
// Null when there are no sales to take a share of.
export function variableRate({ costOfSales, cardFees, sales }: {
  costOfSales: number; cardFees: number; sales: number
}): number | null {
  if (!(sales > 0)) return null
  return (n(costOfSales) + n(cardFees)) / n(sales)
}

// Sales per day needed to cover the fixed costs once the variable share is taken out.
// Null when the variable share is null, 1 or more — every extra ringgit of sales loses
// money, so no amount of trade breaks even and a figure would be a lie.
export function breakEven({ fixed, variableRate: v, daysInMonth: days }: {
  fixed: number; variableRate: number | null; daysInMonth: number
}): number | null {
  if (!(days > 0)) return null
  if (v === null || v >= 1) return null
  const monthly = n(fixed) / (1 - n(v))
  return Math.round((monthly / days) * 100) / 100
}

// Null rather than Infinity when there is nothing to compare against.
export function pctChange(now: number, before: number): number | null {
  if (!(n(before) > 0)) return null
  return Math.round(((n(now) - n(before)) / n(before)) * 1000) / 10
}

// Categorize a supplier invoice by due date: overdue if past, dueSoon if within cutoff, neither otherwise.
// Due exactly today is dueSoon, not overdue.
export function supplierInvoiceCategory(dueDate: string, today: string, dueSoonCutoff: string): 'overdue' | 'dueSoon' | 'neither' {
  if (dueDate < today) return 'overdue'
  if (dueDate <= dueSoonCutoff) return 'dueSoon'
  return 'neither'
}

// ---- report periods (Profit & Loss comparison) ----
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()  // m is 1-12
const pad2 = (n: number) => String(n).padStart(2, '0')

// Move a date by whole months. A month-end stays a month-end (31 Mar -> 28 Feb -> 31 Jan).
export function shiftMonths(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = (t % 12) + 1
  const day = d >= lastDayOf(y, m) ? lastDayOf(ny, nm) : Math.min(d, lastDayOf(ny, nm))
  return `${ny}-${pad2(nm)}-${pad2(day)}`
}

export type CompareMode = 'prev' | 'year' | 'none'

// The period to compare with. "Previous" is the same number of whole months
// just before when the period starts on the 1st (1-15 Sep -> 1-15 Aug), else
// the same number of days just before.
export function comparePeriod(from: string, to: string, mode: CompareMode): [string, string] | null {
  if (mode === 'none' || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return null
  if (mode === 'year') return [shiftMonths(from, -12), shiftMonths(to, -12)]
  if (from.endsWith('-01')) {
    const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number)
    const n = (ty * 12 + tm) - (fy * 12 + fm) + 1
    return [shiftMonths(from, -n), shiftMonths(to, -n)]
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1
  return [addDaysISO(from, -days), addDaysISO(from, -1)]
}

