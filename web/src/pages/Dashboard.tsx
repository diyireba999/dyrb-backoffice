import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Banknote, FileText, Landmark, Receipt, Truck, type LucideIcon } from 'lucide-react'
import { accountTotals, dmy, monthStart, rm, supabase, todayMY, useAccounts, type Profile } from '../lib'

type Recent = { id: number; doc_no: string; date: string; description: string; journal_lines: { debit: number }[] }

function Kpi({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: string; note?: string; tone: string }) {
  return (
    <div className="card flex items-start gap-4 p-4 sm:p-5">
      <div className={`hidden size-10 shrink-0 place-items-center rounded-lg sm:grid ${tone}`}><Icon className="size-5" /></div>
      <div className="min-w-0">
        <div className="muted">{label}</div>
        <div className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</div>
        {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
      </div>
    </div>
  )
}

function Action({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium shadow-xs transition hover:border-brand hover:text-brand">
      <Icon className="size-4" />{label}
    </Link>
  )
}

export function Dashboard({ profile }: { profile: Profile }) {
  const office = profile.role !== 'staff'
  const accounts = useAccounts(true)
  const [all, setAll] = useState<Map<string, number>>(new Map())
  const [month, setMonth] = useState<Map<string, number>>(new Map())
  const [claims, setClaims] = useState<{ status: string; amount: number; staff_id: string }[]>([])
  const [recent, setRecent] = useState<Recent[]>([])

  useEffect(() => {
    supabase.from('claims').select('status, amount, staff_id').in('status', ['pending', 'approved'])
      .then(({ data }) => setClaims(data ?? []))
    if (!office) return
    accountTotals(null, todayMY()).then(setAll)
    accountTotals(monthStart(), todayMY()).then(setMonth)
    supabase.from('journals').select('id, doc_no, date, description, journal_lines(debit)')
      .order('date', { ascending: false }).order('id', { ascending: false }).limit(6)
      .then(({ data }) => setRecent((data as Recent[]) ?? []))
  }, [office])

  const bal = (codes: string[], sign = 1) => codes.reduce((s, c) => s + sign * (all.get(c) ?? 0), 0)
  const monthOf = (type: string) => accounts.filter(a => a.type === type).reduce((s, a) => s + (month.get(a.code) ?? 0), 0)
  const income = -monthOf('income'), expense = monthOf('expense')
  const openClaims = office ? claims : claims.filter(c => c.staff_id === profile.id)
  const claimsTotal = openClaims.reduce((s, c) => s + Number(c.amount), 0)
  const monthName = new Date().toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })

  if (!office) return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Kpi icon={Receipt} label="My claims in progress" value={rm(claimsTotal)} note={`${openClaims.length} waiting`} tone="bg-amber-50 text-amber-600" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3"><Action to="/claims" icon={Receipt} label="Submit a claim" /></div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi icon={Landmark} label="Bank balance" value={rm(bal(['1100']))} tone="bg-indigo-50 text-indigo-600" />
        <Kpi icon={Banknote} label="Cash on hand" value={rm(bal(['1000', '1010']))} note="Drawer + petty cash" tone="bg-emerald-50 text-emerald-600" />
        <Kpi icon={Truck} label="Owed to suppliers" value={rm(bal(['2000'], -1))} tone="bg-rose-50 text-rose-600" />
        <Kpi icon={Receipt} label="Claims to settle" value={rm(claimsTotal)} note={`${openClaims.length} pending or approved`} tone="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Recent entries</h3>
            <Link to="/gl/listing" className="link">View all</Link>
          </div>
          <div className="-mx-5 mt-3">
            {recent.length === 0 && <p className="muted px-5 py-6">No documents yet. Start with a Payment Voucher or Purchase Invoice.</p>}
            {recent.length > 0 && (
              <table>
                <tbody>
                  {recent.map(r => (
                    <tr key={r.id}>
                      <td className="w-28 text-slate-500">{dmy(r.date)}</td>
                      <td className="font-medium">{r.description}</td>
                      <td className="hidden font-mono text-xs sm:table-cell">{r.doc_no}</td>
                      <td className="text-right font-medium">{rm(r.journal_lines.reduce((s, l) => s + Number(l.debit), 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <h3 className="font-semibold">{monthName}</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Income</dt><dd className="font-medium tabular-nums">{rm(income)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Expenses</dt><dd className="font-medium tabular-nums">{rm(expense)}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-3">
                <dt className="font-medium">Profit so far</dt>
                <dd className={`font-semibold tabular-nums ${income - expense < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{rm(income - expense)}</dd>
              </div>
            </dl>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-500">Quick actions</h3>
            <Action to="/cash/payment" icon={ArrowUpRight} label="Payment Voucher" />
            <Action to="/cash/receipt" icon={ArrowDownLeft} label="Official Receipt" />
            <Action to="/ap/invoices" icon={FileText} label="Purchase Invoice" />
          </div>
        </div>
      </div>
    </div>
  )
}
