import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, ClipboardList, FileText, HandCoins, Receipt, TrendingUp, Truck, Wallet, type LucideIcon } from 'lucide-react'
import { accountTotals, dailyNet, dmy, isDirector, monthStart, monthStatus, rm, round2, rowsOf, supabase, supplierDue, todayMY, type Account, type MonthStatus, type Profile } from '../lib'
import { addDaysISO, breakEven, daysInMonth, pctChange, sameWeekdayLastWeek, sumRange, todoItems, variableRate, type DayAmount } from '../dashboard-math'
import { DailyBars, RankedBars } from '../charts'
import { toast } from '../feedback'

function Kpi({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: ReactNode; note?: ReactNode; tone: string }) {
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

// undefined = still loading, null = supplierDue() threw. Kept distinct from "nothing due"
// (zeros with no note) so a glance mid-load can't be read as "nothing is overdue".
function supplierDueNote(due: { dueSoon: number; overdue: number } | null | undefined): ReactNode {
  if (due === undefined) return 'Checking due dates…'
  if (due === null) return 'Due dates could not be loaded'
  if (!due.dueSoon && !due.overdue) return undefined
  const soon = due.dueSoon ? <span key="soon">{rm(due.dueSoon)} due in 7 days</span> : null
  const overdue = due.overdue ? <span key="overdue" className="text-rose-600">{rm(due.overdue)} overdue</span> : null
  return soon && overdue ? <>{soon} &middot; {overdue}</> : soon ?? overdue
}

function QuickButton({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return <Link to={to} className="btn-light h-8"><Icon className="size-4 text-slate-500" />{label}</Link>
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
  monthsCovered: number // how many complete months the break-even figure is based on
}

function Trend({ label, vsLabel, now, before }: { label: string; vsLabel: string; now: number; before: number }) {
  const change = pctChange(now, before)
  // Flat is not up: a genuine 0% change gets the neutral treatment, not green.
  const color = change === null ? 'text-slate-400' : change === 0 ? 'text-slate-500' : change < 0 ? 'text-rose-600' : 'text-emerald-600'
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 sm:block">
      <div className="muted">{label}</div>
      <div className="whitespace-nowrap text-lg font-semibold tabular-nums sm:text-xl">{rm(now)}</div>
      <div className={`col-span-2 text-xs font-medium ${color}`}>
        {change === null ? 'no figure to compare' : `${change > 0 ? '+' : ''}${change}% ${vsLabel}`}
      </div>
    </div>
  )
}

// Sales means food and drink only. Service charge and other income are shown apart.
const sumCodes = (accounts: Account[], m: Map<string, number>, from: string, to: string) =>
  accounts.filter(a => a.code >= from && a.code < to).reduce((s, a) => s + (m.get(a.code) ?? 0), 0)

export function Dashboard({ profile }: { profile: Profile }) {
  // Investors get the business view too, minus the shortcuts and the claims/supplier
  // detail they cannot read (those would show a false RM 0).
  const office = profile.role !== 'staff'
  const investor = profile.role === 'investor'
  // Fetched here (not via the shared useAccounts hook) so its completion can join the
  // same Promise.all as the balances below — the hook's own effect settles on its own
  // schedule, which is exactly what let `loaded` go true before this list had arrived.
  const [accounts, setAccounts] = useState<Account[]>([])
  const [all, setAll] = useState<Map<string, number>>(new Map())
  const [month, setMonth] = useState<Map<string, number>>(new Map())
  const [lastMonth, setLastMonth] = useState<Map<string, number>>(new Map())
  const [claims, setClaims] = useState<{ status: string; amount: number; staff_id: string }[]>([])
  const [due, setDue] = useState<{ dueSoon: number; overdue: number } | null | undefined>(undefined)
  const [salesBand, setSalesBand] = useState<SalesBand | undefined>(undefined)
  const [salesBandError, setSalesBandError] = useState<string | null>(null)
  // The inline accounts fetch below feeds Sales, Cost of sales, Gross profit, Running
  // costs, Profit so far and Owed to director. rowsOf() logs a fetch failure and
  // returns [], which reads as "no accounts" rather than "could not load accounts" —
  // so those figures would render a confident RM0.00 instead of an error. Caught here,
  // local to this screen, without changing rowsOf() (other screens rely on its behaviour).
  const [accountsError, setAccountsError] = useState<string | null>(null)
  // Guards the top KPI band and the month card against flashing a confident RM0.00
  // before the balances have actually loaded.
  const [loaded, setLoaded] = useState(false)
  // To-do list: this month and last month from month_status(). undefined = loading,
  // null = the RPC failed (shown as text), [] = nothing waiting.
  const [todo, setTodo] = useState<MonthStatus[] | null | undefined>(undefined)
  const [todoError, setTodoError] = useState('')
  const loadTodo = () => {
    Promise.all([monthStatus(monthStart()), monthStatus(monthStartOffset(todayMY(), 1))])
      .then(setTodo, (e: Error) => { setTodo(null); setTodoError(e.message) })
  }
  useEffect(() => { if (office && !investor) loadTodo() }, [office, investor])

  async function closeDay(day: string) {
    const { error } = await supabase.from('closed_days').upsert({ day }, { onConflict: 'day', ignoreDuplicates: true })
    if (error) return toast(error.message, { kind: 'error' })
    toast(`${dmy(day)} marked as closed`)
    loadTodo()
  }

  useEffect(() => {
    // Swallowed here (not just at supplierDue's own call site) so a genuine network
    // failure resolves the promise instead of leaving Promise.all — and `loaded` —
    // stuck forever on a rejection nothing below is listening for.
    const claimsP = supabase.from('claims').select('status, amount, staff_id').in('status', ['pending', 'approved'])
      .then(({ data }) => setClaims(data ?? []), () => {})
    if (!office) { claimsP.then(() => setLoaded(true)); return }
    // Same-day-of-month cutoff last month, so "this month so far" is compared like for like.
    const lastMonthStart = monthStartOffset(todayMY(), 1)
    const lastMonthEnd = addDaysISO(lastMonthStart, Math.min(Number(todayMY().slice(8, 10)), daysInMonth(lastMonthStart.slice(0, 7))) - 1)
    Promise.all([
      claimsP,
      supabase.from('accounts').select('*').order('code')
        .then(r => {
          if (r.error) setAccountsError(r.error.message)
          setAccounts(rowsOf(r, 'the account list'))
        }, (e: Error) => setAccountsError(e.message)),
      // A failed total shows as an error, never as a confident RM 0.00.
      accountTotals(null, todayMY()).then(setAll, (e: Error) => setAccountsError(e.message)),
      // To month end, like the P&L: payroll is dated the last day of the month.
      accountTotals(monthStart(), addDaysISO(monthStartOffset(todayMY(), -1), -1)).then(setMonth, (e: Error) => setAccountsError(e.message)),
      accountTotals(lastMonthStart, lastMonthEnd).then(setLastMonth, (e: Error) => setAccountsError(e.message)),
      supplierDue(todayMY()).then(setDue).catch(() => setDue(null)),
    ]).then(() => setLoaded(true))
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
      const earliest = await supabase.from('account_balances').select('date').order('date').limit(1)
      const earliestDate = (earliest.data as { date: string }[] | null)?.[0]?.date ?? null
      // Whole months only: a first journal dated mid-month doesn't count that month,
      // and its costs are left out of the total too, or a half month would be
      // averaged as if it were a full one.
      const mIdx = (iso: string) => { const [y, m] = iso.slice(0, 7).split('-').map(Number); return y * 12 + m }
      const firstWhole = earliestDate ? mIdx(earliestDate) + (earliestDate.slice(8) === '01' ? 0 : 1) : Infinity
      const firstWholeStart = earliestDate ? (earliestDate.slice(8) === '01' ? earliestDate : monthStartOffset(earliestDate, -1)) : threeMonthsStart
      const monthsCovered = Math.min(3, mIdx(thisMonthStart) - Math.max(firstWhole, mIdx(threeMonthsStart)))
      const totals3mo = await accountTotals(firstWholeStart > threeMonthsStart ? firstWholeStart : threeMonthsStart, lastCompleteMonthEnd)
      const codeSum = (lo: string, hi: string) =>
        [...totals3mo].filter(([code]) => code >= lo && code < hi).reduce((s, [, v]) => s + v, 0)
      const cardFees = totals3mo.get('6200') ?? 0
      const enoughHistory = monthsCovered >= 2
      const fixed = (codeSum('6000', '7000') - cardFees) / monthsCovered
      // Cost of sales is 5000-5999 throughout this screen (matches the gross-profit
      // figure above), which includes 5100 Packaging & Consumables — it scales with sales.
      const v = variableRate({ costOfSales: codeSum('5000', '6000'), cardFees, sales: -codeSum('4000', '4100') })
      // A net credit across 6000-6999 (e.g. a large refund) makes `fixed` zero or negative.
      // Feeding that into breakEven() would draw the rule off the bottom of the chart and
      // caption a negative break-even figure, so it gets the same treatment as the other
      // cases where a number would be meaningless rather than useful.
      const line = enoughHistory && fixed > 0 ? breakEven({ fixed, variableRate: v, daysInMonth: daysInMonth(today.slice(0, 7)) }) : null
      const breakEvenNote = !enoughHistory
        ? 'Not enough history yet — break-even needs at least 2 complete months of records.'
        : fixed <= 0
        ? 'Fixed costs came out at zero or a credit over that period, so a break-even figure would be meaningless.'
        : v === null
        ? 'No sales in the last 3 months, so a variable cost rate cannot be worked out.'
        : line === null
        ? 'Variable costs are at or above sales, so a break-even figure would be meaningless.'
        : null

      setSalesBand({
        yesterday: { amount: sumRange(salesDays, yesterday, yesterday), compare: sumRange(salesDays, sameWeekdayLastWeek(yesterday), sameWeekdayLastWeek(yesterday)) },
        week: { amount: sumRange(salesDays, weekStart, yesterday), compare: sumRange(salesDays, weekStartLastWeek, sameWeekdayLastWeek(yesterday)) },
        month: { amount: monthAmt, compare: monthCompare },
        strip, avgPerDay, monthStarted, breakEvenLine: line, breakEvenNote, monthsCovered,
      })
    }).catch((e: Error) => setSalesBandError(e.message))
  }, [office])

  const bal = (codes: string[], sign = 1) => codes.reduce((s, c) => s + sign * (all.get(c) ?? 0), 0)
  // A muted placeholder, not RM0.00, while the balances are still in flight.
  const kpiValue = (n: number) => (loaded && !accountsError ? rm(n) : '—')
  const sales = -sumCodes(accounts, month, '4000', '4100')
  const service = -sumCodes(accounts, month, '4100', '4900')
  const otherIncome = -sumCodes(accounts, month, '4900', '5000')
  // Cost of sales (5000-5999) is shown on its own; 6000 upwards are running costs.
  const costOfSales = sumCodes(accounts, month, '5000', '6000')
  const expense = sumCodes(accounts, month, '6000', '7000')
  const grossProfit = sales - costOfSales
  const income = sales + service + otherIncome
  // Profit this month (to month end, like the month card) against the same days last month.
  const profit = income - costOfSales - expense
  const lastIncome = -sumCodes(accounts, lastMonth, '4000', '5000')
  const lastProfit = lastIncome - sumCodes(accounts, lastMonth, '5000', '6000') - sumCodes(accounts, lastMonth, '6000', '7000')
  const profitChange = pctChange(profit, lastProfit)
  const bank = bal(['1100'])
  const cashOnHand = bal(['1000', '1010'])
  const billsDue = due ? round2(due.dueSoon + due.overdue) : 0
  // Margin change vs last month in percentage POINTS (60% -> 63% is "+3 points", not "+5%").
  const marginPct = sales > 0 ? (grossProfit / sales) * 100 : null
  const lastSales = -sumCodes(accounts, lastMonth, '4000', '4100')
  const lastCostOfSales = sumCodes(accounts, lastMonth, '5000', '6000')
  const lastMarginPct = lastSales > 0 ? ((lastSales - lastCostOfSales) / lastSales) * 100 : null
  const marginPointsChange = marginPct !== null && lastMarginPct !== null ? round2(marginPct - lastMarginPct) : null
  // Food/beverage/liquor split, each sales account paired with its own cost account.
  // A category with no sales this month is left out rather than shown as a 0% margin.
  const splitLines = ([
    ['Food', '4000', '5000'],
    ['Beverage', '4010', '5010'],
    ['Liquor', '4020', '5020'],
  ] as const).map(([label, salesCode, costCode]) => ({
    label, sales: -(month.get(salesCode) ?? 0), cost: month.get(costCode) ?? 0,
  })).filter(l => l.sales > 0)
  // Corkage 4030 has no cost account (no stock behind it) and is excluded from the margin
  // split on purpose, but shown as its own line when non-zero so the money isn't hidden.
  const corkage = -(month.get('4030') ?? 0)
  const directorOwed = -accounts.filter(a => isDirector(a.code)).reduce((s, a) => s + (all.get(a.code) ?? 0), 0)
  const openClaims = office ? claims : claims.filter(c => c.staff_id === profile.id)
  const negativeStock = accounts.filter(a => ['1400', '1410', '1420'].includes(a.code) && (all.get(a.code) ?? 0) < -0.005)
  const claimsTotal = openClaims.reduce((s, c) => s + Number(c.amount), 0)
  const monthName = new Date().toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
  const topExpenses = (() => {
    const rows = accounts.filter(a => a.type === 'expense' && a.code >= '6000')
      .map(a => ({ label: a.name, value: month.get(a.code) ?? 0, before: lastMonth.get(a.code) ?? 0 }))
      .filter(r => r.value > 0).sort((a, b) => b.value - a.value)
    const rest = rows.slice(5)
    const other = rest.reduce((s, r) => s + r.value, 0)
    const otherBefore = rest.reduce((s, r) => s + r.before, 0)
    return other > 0 ? [...rows.slice(0, 5), { label: 'Other', value: other, before: otherBefore }] : rows
  })()

  if (!office) return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Kpi icon={Receipt} label="My claims in progress" value={kpiValue(claimsTotal)} note={loaded ? `${openClaims.length} waiting` : undefined} tone="bg-amber-50 text-amber-600" />
      </div>
      <QuickButton to="/claims" icon={Receipt} label="Submit a claim" />
    </div>
  )

  return (
    <div className="space-y-6">
      {!investor && <div className="flex flex-wrap gap-2">
        <QuickButton to="/cash/payment" icon={ArrowUpRight} label="Payment Voucher" />
        <QuickButton to="/cash/receipt" icon={ArrowDownLeft} label="Official Receipt" />
        <QuickButton to="/ap/invoices" icon={FileText} label="Purchase Invoice" />
      </div>}

      {accountsError && <p className="alert-error">Could not load the balances, so the figures below are left blank: {accountsError}</p>}
      {loaded && negativeStock.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <b>Stock below zero:</b> {negativeStock.map(a => `${a.name} ${rm(all.get(a.code))}`).join(' · ')}.
          {' '}More has been sold than bought in — supplier invoices are probably missing.{' '}
          {!investor && <><Link to="/ap/invoices" className="font-medium underline">Enter purchase invoices</Link>, then do a <Link to="/stock/count" className="font-medium underline">stock count</Link>.</>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi icon={TrendingUp} label="Profit this month"
          value={loaded && !accountsError ? <span className={profit < 0 ? 'text-rose-600' : ''}>{rm(profit)}</span> : '—'}
          note={!loaded || accountsError ? undefined : (profitChange === null ? 'no figure to compare' : `${profitChange > 0 ? '+' : ''}${profitChange}% vs last month`)}
          tone="bg-emerald-50 text-emerald-600" />
        <Kpi icon={Wallet} label="Cash" value={kpiValue(bank + cashOnHand)}
          note={!loaded || accountsError ? undefined : billsDue > 0 ? <span className="text-amber-700">{rm(billsDue)} bills due this week</span> : `Bank ${rm(bank)} · Cash ${rm(cashOnHand)}`}
          tone="bg-blue-50 text-blue-600" />
        <Kpi icon={Truck} label="Owed to suppliers" value={kpiValue(bal(['2000'], -1))} note={investor ? undefined : supplierDueNote(due)} tone="bg-rose-50 text-rose-600" />
        <Kpi icon={HandCoins} label="Owed to director" value={accountsError ? '—' : kpiValue(directorOwed)} note={accountsError ? 'Could not be loaded' : 'Paid from their own pocket'} tone="bg-violet-50 text-violet-600" />
        {!investor && openClaims.length > 0 && <Kpi icon={Receipt} label="Claims to settle" value={kpiValue(claimsTotal)} note={`${openClaims.length} pending or approved`} tone="bg-amber-50 text-amber-600" />}
      </div>

      {!investor && (
        <div className="card">
          <div className="flex items-center gap-2"><ClipboardList className="size-4 text-slate-400" /><h3 className="font-semibold">To do</h3></div>
          {todo === undefined ? <p className="muted mt-3">Checking…</p>
            : todo === null ? <p className="alert-error mt-3">{todoError}</p>
            : (() => {
              const items = todoItems(todo, todayMY())
              if (items.length === 0) return <p className="muted mt-3">Nothing waiting. Up to date.</p>
              return (
                <ul className="mt-3 divide-y divide-slate-100">
                  {items.map(it => (
                    <li key={it.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <span className="min-w-0 flex-1">{it.text}</span>
                      <Link to={it.to} className="btn-light">{it.action}</Link>
                      {it.days && (
                        <div className="basis-full text-xs text-slate-500">
                          Bar closed that day?{' '}
                          {it.days.slice(0, 8).map(d => <button key={d} type="button" className="link mr-2" onClick={() => closeDay(d)}>{dmy(d)}</button>)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            })()}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold">Sales</h3>
          <p className="muted mb-4">Using yesterday throughout — today's sales are not uploaded yet.</p>
          {salesBandError ? (
            <p className="text-[13px] text-rose-600">Could not load the sales band: {salesBandError}</p>
          ) : !salesBand ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
                <Trend label="Yesterday" vsLabel="vs same day last week" now={salesBand.yesterday.amount} before={salesBand.yesterday.compare} />
                <Trend label="Week to date" vsLabel="vs last week" now={salesBand.week.amount} before={salesBand.week.compare} />
                <Trend label="Month to date" vsLabel="vs last month" now={salesBand.month.amount} before={salesBand.month.compare} />
              </div>
              <div className="mt-6">
                <DailyBars days={salesBand.strip} breakEvenLine={salesBand.breakEvenLine} />
              </div>
              <p className="muted mt-3 text-xs">
                {salesBand.breakEvenLine === null ? (
                  salesBand.breakEvenNote
                ) : salesBand.monthStarted ? (
                  <>
                    {`Break even averages ${rm(salesBand.breakEvenLine)} a day (from the last ${salesBand.monthsCovered} complete months' costs). Averaging ${rm(salesBand.avgPerDay)} a day this month.`}
                    {(() => {
                      // The two figures above are both calendar-day averages and read as
                      // nearly equal in small grey text — this spells out which is bigger,
                      // since the chart above (bars visibly clearing the line) otherwise
                      // supplies the only verdict a daily reader takes away.
                      const gap = round2(salesBand.avgPerDay - salesBand.breakEvenLine)
                      if (gap === 0) return ' Exactly at break even.'
                      return (
                        <span className={gap > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {` — ${rm(Math.abs(gap))} a day ${gap > 0 ? 'clear of' : 'short of'} break even.`}
                        </span>
                      )
                    })()}
                  </>
                ) : (
                  `Break even averages ${rm(salesBand.breakEvenLine)} a day (from the last ${salesBand.monthsCovered} complete months' costs). This month has not started yet.`
                )}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <h3 className="font-semibold">{monthName}</h3>
          {!loaded ? <p className="muted mt-4">Loading…</p> : accountsError ? (
            <p className="mt-4 text-[13px] text-rose-600">Could not load the account list, so these figures are unavailable: {accountsError}</p>
          ) : (
            <>
              <dl className="mt-4 space-y-3 text-[13px]">
                <div className="flex justify-between"><dt className="text-slate-500">Sales (food &amp; drink)</dt><dd className="font-medium tabular-nums">{rm(sales)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Cost of sales</dt><dd className="font-medium tabular-nums">{rm(costOfSales)}</dd></div>
                <div className="flex justify-between border-t border-slate-100 pt-3">
                  <dt className="font-medium">Gross profit{marginPct !== null ? ` (${Math.round(marginPct)}%)` : ''}</dt>
                  <dd className="font-semibold tabular-nums">{rm(grossProfit)}</dd>
                </div>
                {marginPct !== null && (
                  <div className={`-mt-2 text-xs font-medium ${
                    marginPointsChange === null ? 'text-slate-400' : marginPointsChange === 0 ? 'text-slate-500' : marginPointsChange > 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    {marginPointsChange === null ? 'no figure to compare' : marginPointsChange === 0 ? 'flat vs last month' : `${marginPointsChange > 0 ? '+' : ''}${marginPointsChange} points vs last month`}
                  </div>
                )}
                {(splitLines.length > 0 || corkage !== 0) && (
                  <div className="space-y-1.5 border-t border-slate-100 pt-3">
                    <div className="text-xs font-semibold text-slate-500">Food, beverage &amp; liquor</div>
                    {splitLines.map(l => {
                      const m = (l.sales - l.cost) / l.sales * 100
                      return (
                        <div key={l.label} className="flex justify-between">
                          <dt className="text-slate-500">{l.label} ({Math.round(m)}%)</dt>
                          <dd className="font-medium tabular-nums">{rm(l.sales)}</dd>
                        </div>
                      )
                    })}
                    {corkage !== 0 && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Corkage</dt>
                        <dd className="font-medium tabular-nums">{rm(corkage)}</dd>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-between"><dt className="text-slate-500">Service charge</dt><dd className="font-medium tabular-nums">{rm(service)}</dd></div>
                {otherIncome !== 0 && <div className="flex justify-between"><dt className="text-slate-500">Other income</dt><dd className="font-medium tabular-nums">{rm(otherIncome)}</dd></div>}
                <div className="flex justify-between"><dt className="text-slate-500">Running costs</dt><dd className="font-medium tabular-nums">{rm(expense)}</dd></div>
                <div className="flex justify-between border-t border-slate-100 pt-3">
                  <dt className="font-medium">Profit so far</dt>
                  <dd className={`font-semibold tabular-nums ${income - costOfSales - expense < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{rm(income - costOfSales - expense)}</dd>
                </div>
              </dl>
              <h4 className="mb-3 mt-6 text-[13px] font-semibold text-slate-500">Top running costs this month</h4>
              {topExpenses.length ? <RankedBars rows={topExpenses} /> : <p className="muted">No expenses yet.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
