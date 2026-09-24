import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Banknote, FileText, HandCoins, Landmark, Receipt, Truck, type LucideIcon } from 'lucide-react'
import { accountTotals, addDays, dmy, isDirector, monthStart, rm, supabase, todayMY, useAccounts, type Account, type Profile } from '../lib'
import { RankedBars, SalesVsExpenses, type MonthPoint } from '../charts'

type Recent = { id: number; doc_no: string; date: string; description: string; journal_lines: { debit: number }[] }

function Kpi({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: string; note?: string; tone: string }) {
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

function QuickButton({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return <Link to={to} className="btn-light h-9"><Icon className="size-4 text-brand" />{label}</Link>
}

// Last n calendar months, oldest first, as [firstDay, lastDay, label].
function lastMonths(n: number) {
  const [y, m] = todayMY().split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1))
    const first = d.toISOString().slice(0, 10)
    const last = addDays(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10), -1)
    return [first, last, d.toLocaleDateString('en-MY', { month: 'short', timeZone: 'UTC' })] as const
  })
}

const sumType = (accounts: Account[], m: Map<string, number>, type: Account['type']) =>
  accounts.filter(a => a.type === type).reduce((s, a) => s + (m.get(a.code) ?? 0), 0)

// Sales means food and drink only. Service charge and other income are shown apart.
const sumCodes = (accounts: Account[], m: Map<string, number>, from: string, to: string) =>
  accounts.filter(a => a.code >= from && a.code < to).reduce((s, a) => s + (m.get(a.code) ?? 0), 0)

export function Dashboard({ profile }: { profile: Profile }) {
  const office = profile.role !== 'staff'
  const accounts = useAccounts(true)
  const [all, setAll] = useState<Map<string, number>>(new Map())
  const [month, setMonth] = useState<Map<string, number>>(new Map())
  const [months, setMonths] = useState<{ label: string; totals: Map<string, number> }[]>([])
  const [claims, setClaims] = useState<{ status: string; amount: number; staff_id: string }[]>([])
  const [recent, setRecent] = useState<Recent[]>([])

  useEffect(() => {
    supabase.from('claims').select('status, amount, staff_id').in('status', ['pending', 'approved'])
      .then(({ data }) => setClaims(data ?? []))
    if (!office) return
    accountTotals(null, todayMY()).then(setAll)
    accountTotals(monthStart(), todayMY()).then(setMonth)
    Promise.all(lastMonths(6).map(async ([from, to, label]) => ({ label, totals: await accountTotals(from, to) }))).then(setMonths)
    supabase.from('journals').select('id, doc_no, date, description, journal_lines(debit)')
      .order('date', { ascending: false }).order('id', { ascending: false }).limit(6)
      .then(({ data }) => setRecent((data as Recent[]) ?? []))
  }, [office])

  const bal = (codes: string[], sign = 1) => codes.reduce((s, c) => s + sign * (all.get(c) ?? 0), 0)
  const sales = -sumCodes(accounts, month, '4000', '4100')
  const service = -sumCodes(accounts, month, '4100', '4900')
  const otherIncome = -sumCodes(accounts, month, '4900', '5000')
  const expense = sumType(accounts, month, 'expense')
  const income = sales + service + otherIncome
  const directorOwed = -accounts.filter(a => isDirector(a.code)).reduce((s, a) => s + (all.get(a.code) ?? 0), 0)
  const openClaims = office ? claims : claims.filter(c => c.staff_id === profile.id)
  const claimsTotal = openClaims.reduce((s, c) => s + Number(c.amount), 0)
  const monthName = new Date().toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
  const chart: MonthPoint[] = months.map(m => ({
    label: m.label, sales: -sumCodes(accounts, m.totals, '4000', '4100'), expenses: sumType(accounts, m.totals, 'expense'),
  }))
  const topExpenses = (() => {
    const rows = accounts.filter(a => a.type === 'expense').map(a => ({ label: a.name, value: month.get(a.code) ?? 0 }))
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
        <Kpi icon={Truck} label="Owed to suppliers" value={rm(bal(['2000'], -1))} tone="bg-rose-50 text-rose-600" />
        <Kpi icon={Receipt} label="Claims to settle" value={rm(claimsTotal)} note={`${openClaims.length} pending or approved`} tone="bg-amber-50 text-amber-600" />
        <Kpi icon={HandCoins} label="Owed to director" value={rm(directorOwed)} note="Paid from their own pocket" tone="bg-violet-50 text-violet-600" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold">Sales vs expenses</h3>
          <p className="muted mb-4">Last 6 months</p>
          {chart.length > 0 && <SalesVsExpenses data={chart} />}
        </div>
        <div className="card">
          <h3 className="font-semibold">{monthName}</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Sales (food &amp; drink)</dt><dd className="font-medium tabular-nums">{rm(sales)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Service charge</dt><dd className="font-medium tabular-nums">{rm(service)}</dd></div>
            {otherIncome !== 0 && <div className="flex justify-between"><dt className="text-slate-500">Other income</dt><dd className="font-medium tabular-nums">{rm(otherIncome)}</dd></div>}
            <div className="flex justify-between"><dt className="text-slate-500">Expenses</dt><dd className="font-medium tabular-nums">{rm(expense)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-3">
              <dt className="font-medium">Profit so far</dt>
              <dd className={`font-semibold tabular-nums ${income - expense < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{rm(income - expense)}</dd>
            </div>
          </dl>
          <h4 className="mb-3 mt-6 text-sm font-semibold text-slate-500">Top expenses this month</h4>
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
