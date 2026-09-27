import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Banknote, FileText, HandCoins, Landmark, Receipt, Truck, type LucideIcon } from 'lucide-react'
import { accountTotals, dailyNet, dmy, isDirector, monthStart, rm, round2, supabase, supplierDue, todayMY, useAccounts, type Account, type Profile } from '../lib'
import { addDaysISO, breakEven, daysInMonth, pctChange, sameWeekdayLastWeek, sumRange, variableRate, type DayAmount } from '../dashboard-math'
import { DailyBars, RankedBars } from '../charts'

type Recent = { id: number; doc_no: string; date: string; description: string; journal_lines: { debit: number }[] }

function Kpi({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: string; note?: ReactNode; tone: string }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="muted">{label}</span>
        <span className={`hidden size-8 place-items-center rounded-lg sm:grid ${tone}`}><Icon className="size-4" /></span>
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </div>
  )
}

// undefined = still loading (no note yet), null = supplierDue() threw.
function supplierDueNote(due: { dueSoon: number; overdue: number } | null | undefined): ReactNode {
  if (due === null) return 'Due dates could not be loaded'
  if (!due || (!due.dueSoon && !due.overdue)) return undefined
  const soon = due.dueSoon ? <span key="soon">{rm(due.dueSoon)} due in 7 days</span> : null
  const overdue = due.overdue ? <span key="overdue" className="text-rose-600">{rm(due.overdue)} overdue</span> : null
  return soon && overdue ? <>{soon} &middot; {overdue}</> : soon ?? overdue
}

function QuickButton({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return <Link to={to} className="btn-light h-9"><Icon className="size-4 text-brand" />{label}</Link>
}

// Monday (UTC weekday) of the week containing this date.
const mondayOf = (iso: string) => addDaysISO(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7))

// First day of the month `n` months before the month containing `iso`.
const monthStartOffset = (iso: string, n: number) => {
  const [y, m] = iso.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10)
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1

type SalesBand = {
  yesterday: { amount: number; compare: number }
  week: { amount: number; compare: number }
  month: { amount: number; compare: number }
  strip: DayAmount[]
  avgPerDay: number
  monthStarted: boolean
  breakEvenLine: number | null
  breakEvenNote: string | null // shown instead of the line when a figure would be a lie
}

function Trend({ label, vsLabel, now, before }: { label: string; vsLabel: string; now: number; before: number }) {
  const change = pctChange(now, before)
  // Flat is not up: a genuine 0% change gets the neutral treatment, not green.
  const color = change === null ? 'text-slate-400' : change === 0 ? 'text-slate-500' : change < 0 ? 'text-rose-600' : 'text-emerald-600'
  return (
    <div>
      <div className="muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{rm(now)}</div>
      <div className={`text-xs font-medium ${color}`}>
        {change === null ? 'no figure to compare' : `${change > 0 ? '+' : ''}${change}% ${vsLabel}`}
      </div>
    </div>
  )
}

// Sales means food and drink only. Service charge and other income are shown apart.
const sumCodes = (accounts: Account[], m: Map<string, number>, from: string, to: string) =>
  accounts.filter(a => a.code >= from && a.code < to).reduce((s, a) => s + (m.get(a.code) ?? 0), 0)

export function Dashboard({ profile }: { profile: Profile }) {
  const office = profile.role !== 'staff'
  const accounts = useAccounts(true)
  const [all, setAll] = useState<Map<string, number>>(new Map())
  const [month, setMonth] = useState<Map<string, number>>(new Map())
  const [claims, setClaims] = useState<{ status: string; amount: number; staff_id: string }[]>([])
  const [recent, setRecent] = useState<Recent[]>([])
  const [due, setDue] = useState<{ dueSoon: number; overdue: number } | null | undefined>(undefined)
  const [salesBand, setSalesBand] = useState<SalesBand | undefined>(undefined)
  const [salesBandError, setSalesBandError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('claims').select('status, amount, staff_id').in('status', ['pending', 'approved'])
      .then(({ data }) => setClaims(data ?? []))
    if (!office) return
    accountTotals(null, todayMY()).then(setAll)
    accountTotals(monthStart(), todayMY()).then(setMonth)
    supabase.from('journals').select('id, doc_no, date, description, journal_lines(debit)')
      .order('date', { ascending: false }).order('id', { ascending: false }).limit(6)
      .then(({ data }) => setRecent((data as Recent[]) ?? []))
    supplierDue(todayMY()).then(setDue).catch(() => setDue(null))
  }, [office])

  // Sales band: three weekday-matched comparisons, the 42-day strip, and break-even.
  // Uses yesterday throughout (today's sales are not uploaded yet) except where noted.
  useEffect(() => {
    if (!office) return
    const today = todayMY()
    const yesterday = addDaysISO(today, -1)
    const weekStart = mondayOf(yesterday)
    const weekStartLastWeek = addDaysISO(weekStart, -7)
    const thisMonthStart = monthStart()
    const lastMonthStart = monthStartOffset(today, 1)
    const dayOfMonth = Number(yesterday.slice(8, 10))
    const lastMonthEnd = addDaysISO(lastMonthStart, Math.min(dayOfMonth, daysInMonth(lastMonthStart.slice(0, 7))) - 1)
    const stripStart = addDaysISO(yesterday, -41) // 42 days inclusive of yesterday
    const dailyFrom = stripStart < lastMonthStart ? stripStart : lastMonthStart

    dailyNet(dailyFrom, yesterday, '4000', '4100').then(async salesDays => {
      const byDate = new Map(salesDays.map(d => [d.date, Number(d.amount)]))
      const strip: DayAmount[] = Array.from({ length: 42 }, (_, i) => {
        const date = addDaysISO(stripStart, i)
        return { date, amount: byDate.get(date) ?? 0 } // closed day = 0, a visible stub not a gap
      })
      // On the 1st of the month, yesterday falls in the PREVIOUS month, so there is no
      // month-to-date range yet — treat it as not started rather than compare 0 against
      // all of last month (which would read as a fabricated -100%).
      const monthStarted = yesterday >= thisMonthStart
      const monthAmt = monthStarted ? sumRange(salesDays, thisMonthStart, yesterday) : 0
      const monthCompare = monthStarted ? sumRange(salesDays, lastMonthStart, lastMonthEnd) : 0
      const daysElapsed = monthStarted ? daysBetween(thisMonthStart, yesterday) : 0
      const avgPerDay = daysElapsed > 0 ? round2(monthAmt / daysElapsed) : 0

      // Break-even over the last 3 COMPLETE months only (the partial current month
      // would drag the average down and make break-even look easy).
      const threeMonthsStart = monthStartOffset(today, 3)
      const lastCompleteMonthEnd = addDaysISO(thisMonthStart, -1)
      const [totals3mo, earliest] = await Promise.all([
        accountTotals(threeMonthsStart, lastCompleteMonthEnd),
        supabase.from('journals').select('date').order('date').limit(1),
      ])
      const codeSum = (lo: string, hi: string) =>
        [...totals3mo].filter(([code]) => code >= lo && code < hi).reduce((s, [, v]) => s + v, 0)
      const cardFees = totals3mo.get('6200') ?? 0
      const earliestDate = (earliest.data as { date: string }[] | null)?.[0]?.date ?? null
      // Whole months only: a first journal dated mid-month doesn't count that month.
      const mIdx = (iso: string) => { const [y, m] = iso.slice(0, 7).split('-').map(Number); return y * 12 + m }
      const firstWhole = earliestDate ? mIdx(earliestDate) + (earliestDate.slice(8) === '01' ? 0 : 1) : Infinity
      const monthsCovered = Math.min(3, mIdx(thisMonthStart) - Math.max(firstWhole, mIdx(threeMonthsStart)))
      const enoughHistory = monthsCovered >= 2
      const fixed = (codeSum('6000', '7000') - cardFees) / monthsCovered
      // Cost of sales is 5000-5999 throughout this screen (matches the gross-profit
      // figure above), which includes 5100 Packaging & Consumables — it scales with sales.
      const v = variableRate({ costOfSales: codeSum('5000', '6000'), cardFees, sales: -codeSum('4000', '4100') })
      const line = enoughHistory ? breakEven({ fixed, variableRate: v, daysInMonth: daysInMonth(today.slice(0, 7)) }) : null
      const breakEvenNote = !enoughHistory
        ? 'Not enough history yet — break-even needs at least 2 complete months of records.'
        : v === null
        ? 'No sales in the last 3 months, so a variable cost rate cannot be worked out.'
        : line === null
        ? 'Variable costs are at or above sales, so a break-even figure would be meaningless.'
        : null

      setSalesBand({
        yesterday: { amount: sumRange(salesDays, yesterday, yesterday), compare: sumRange(salesDays, sameWeekdayLastWeek(yesterday), sameWeekdayLastWeek(yesterday)) },
        week: { amount: sumRange(salesDays, weekStart, yesterday), compare: sumRange(salesDays, weekStartLastWeek, sameWeekdayLastWeek(yesterday)) },
        month: { amount: monthAmt, compare: monthCompare },
        strip, avgPerDay, monthStarted, breakEvenLine: line, breakEvenNote,
      })
    }).catch((e: Error) => setSalesBandError(e.message))
  }, [office])

  const bal = (codes: string[], sign = 1) => codes.reduce((s, c) => s + sign * (all.get(c) ?? 0), 0)
  const sales = -sumCodes(accounts, month, '4000', '4100')
  const service = -sumCodes(accounts, month, '4100', '4900')
  const otherIncome = -sumCodes(accounts, month, '4900', '5000')
  // Cost of sales (5000-5999) is shown on its own; 6000 upwards are running costs.
  const costOfSales = sumCodes(accounts, month, '5000', '6000')
  const expense = sumCodes(accounts, month, '6000', '7000')
  const grossProfit = sales - costOfSales
  const income = sales + service + otherIncome
  const directorOwed = -accounts.filter(a => isDirector(a.code)).reduce((s, a) => s + (all.get(a.code) ?? 0), 0)
  const openClaims = office ? claims : claims.filter(c => c.staff_id === profile.id)
  const claimsTotal = openClaims.reduce((s, c) => s + Number(c.amount), 0)
  const monthName = new Date().toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
  const topExpenses = (() => {
    const rows = accounts.filter(a => a.type === 'expense' && a.code >= '6000').map(a => ({ label: a.name, value: month.get(a.code) ?? 0 }))
      .filter(r => r.value > 0).sort((a, b) => b.value - a.value)
    const other = rows.slice(5).reduce((s, r) => s + r.value, 0)
    return other > 0 ? [...rows.slice(0, 5), { label: 'Other', value: other }] : rows
  })()

  if (!office) return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Kpi icon={Receipt} label="My claims in progress" value={rm(claimsTotal)} note={`${openClaims.length} waiting`} tone="bg-amber-50 text-amber-600" />
      </div>
      <QuickButton to="/claims" icon={Receipt} label="Submit a claim" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <QuickButton to="/cash/payment" icon={ArrowUpRight} label="Payment Voucher" />
        <QuickButton to="/cash/receipt" icon={ArrowDownLeft} label="Official Receipt" />
        <QuickButton to="/ap/invoices" icon={FileText} label="Purchase Invoice" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <Kpi icon={Landmark} label="Bank balance" value={rm(bal(['1100']))} tone="bg-blue-50 text-blue-600" />
        <Kpi icon={Banknote} label="Cash on hand" value={rm(bal(['1000', '1010']))} note="Drawer + petty cash" tone="bg-emerald-50 text-emerald-600" />
        <Kpi icon={Truck} label="Owed to suppliers" value={rm(bal(['2000'], -1))} note={supplierDueNote(due)} tone="bg-rose-50 text-rose-600" />
        <Kpi icon={Receipt} label="Claims to settle" value={rm(claimsTotal)} note={`${openClaims.length} pending or approved`} tone="bg-amber-50 text-amber-600" />
        <Kpi icon={HandCoins} label="Owed to director" value={rm(directorOwed)} note="Paid from their own pocket" tone="bg-violet-50 text-violet-600" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold">Sales</h3>
          <p className="muted mb-4">Using yesterday throughout — today's sales are not uploaded yet.</p>
          {salesBandError ? (
            <p className="text-sm text-rose-600">Could not load the sales band: {salesBandError}</p>
          ) : !salesBand ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Trend label="Yesterday" vsLabel="vs same day last week" now={salesBand.yesterday.amount} before={salesBand.yesterday.compare} />
                <Trend label="Week to date" vsLabel="vs last week" now={salesBand.week.amount} before={salesBand.week.compare} />
                <Trend label="Month to date" vsLabel="vs last month" now={salesBand.month.amount} before={salesBand.month.compare} />
              </div>
              <div className="mt-6">
                <DailyBars days={salesBand.strip} breakEvenLine={salesBand.breakEvenLine} />
              </div>
              <p className="muted mt-3 text-xs">
                {salesBand.breakEvenLine === null
                  ? salesBand.breakEvenNote
                  : salesBand.monthStarted
                  ? `Break even at ${rm(salesBand.breakEvenLine)} a day. Averaging ${rm(salesBand.avgPerDay)} a day this month.`
                  : `Break even at ${rm(salesBand.breakEvenLine)} a day. This month has not started yet.`}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <h3 className="font-semibold">{monthName}</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Sales (food &amp; drink)</dt><dd className="font-medium tabular-nums">{rm(sales)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Cost of sales</dt><dd className="font-medium tabular-nums">{rm(costOfSales)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-3">
              <dt className="font-medium">Gross profit{sales ? ` (${((grossProfit / sales) * 100).toFixed(0)}%)` : ''}</dt>
              <dd className="font-semibold tabular-nums">{rm(grossProfit)}</dd>
            </div>
            <div className="flex justify-between"><dt className="text-slate-500">Service charge</dt><dd className="font-medium tabular-nums">{rm(service)}</dd></div>
            {otherIncome !== 0 && <div className="flex justify-between"><dt className="text-slate-500">Other income</dt><dd className="font-medium tabular-nums">{rm(otherIncome)}</dd></div>}
            <div className="flex justify-between"><dt className="text-slate-500">Running costs</dt><dd className="font-medium tabular-nums">{rm(expense)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-3">
              <dt className="font-medium">Profit so far</dt>
              <dd className={`font-semibold tabular-nums ${income - costOfSales - expense < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{rm(income - costOfSales - expense)}</dd>
            </div>
          </dl>
          <h4 className="mb-3 mt-6 text-sm font-semibold text-slate-500">Top running costs this month</h4>
          {topExpenses.length ? <RankedBars rows={topExpenses} /> : <p className="muted">No expenses yet.</p>}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Recent documents</h3>
          <Link to="/gl/listing" className="link">View all</Link>
        </div>
        <div className="-mx-5 mt-3 overflow-x-auto">
          {recent.length === 0 && <p className="muted px-5 py-6">No documents yet. Start with a Payment Voucher or Purchase Invoice.</p>}
          {recent.length > 0 && (
            <table>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id}>
                    <td className="w-28 pl-5 text-slate-500">{dmy(r.date)}</td>
                    <td className="hidden w-32 font-mono text-xs sm:table-cell">
                      <Link to={`/gl/listing?doc=${r.doc_no}`} className="hover:text-brand">{r.doc_no}</Link>
                    </td>
                    <td className="font-medium">{r.description}</td>
                    <td className="pr-5 text-right font-medium">{rm(r.journal_lines.reduce((s, l) => s + Number(l.debit), 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
