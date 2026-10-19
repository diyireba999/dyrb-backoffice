import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, Circle, Minus } from 'lucide-react'
import { dmy, monthStatus, rm, supabase, todayMY, type MonthStatus } from '../lib'
import { Empty, MonthInput } from '../ui'
import { PageActions } from '../page'
import { confirmDialog, toast } from '../feedback'
import { listDays } from '../dashboard-math'

type State = 'done' | 'open' | 'skip'
type Step = { name: string; state: State; detail: ReactNode; to: string; link: string }

const monthLabel = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) }
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

const Mark = ({ state }: { state: State }) => state === 'done'
  ? <span role="img" aria-label="Done" className="grid size-6 place-items-center rounded-full bg-green-50 text-green-700"><Check className="size-4" /></span>
  : state === 'skip'
  ? <span role="img" aria-label="Not needed" className="grid size-6 place-items-center rounded-full bg-slate-100 text-slate-400"><Minus className="size-4" /></span>
  : <span role="img" aria-label="Not done" className="grid size-6 place-items-center rounded-full bg-slate-100 text-slate-400"><Circle className="size-3.5" /></span>

// The nine steps of the close, each read from month_status() (032_month_status.sql).
// "Close month" is a mark for the owner, not a lock: posting into a closed month still works.
export function MonthEnd() {
  const thisMonth = todayMY().slice(0, 7)
  const [month, setMonth] = useState<string | null>(null)   // chosen after the first look at last month
  const [s, setS] = useState<MonthStatus | null>(null)
  const [error, setError] = useState('')
  const seq = useRef(0)   // only the latest request may set state, so a slow reply for another month is dropped
  const load = (ym: string) => {
    const my = ++seq.current
    return monthStatus(`${ym}-01`).then(
      st => { if (my !== seq.current) return; setS(st); setError('') },
      (e: Error) => { if (my === seq.current) setError(e.message) })
  }

  // Default to last month until it is closed, then this month.
  useEffect(() => {
    monthStatus(`${prevMonth(thisMonth)}-01`)
      .then(st => setMonth(st.closed_at ? thisMonth : prevMonth(thisMonth)), () => setMonth(thisMonth))
  }, [thisMonth])
  useEffect(() => { if (month) { setS(null); setError(''); load(month) } }, [month])

  async function setClosedDay(day: string, closed: boolean) {
    const { error } = closed
      ? await supabase.from('closed_days').upsert({ day }, { onConflict: 'day', ignoreDuplicates: true })
      : await supabase.from('closed_days').delete().eq('day', day)
    if (error) return toast(error.message, { kind: 'error' })
    toast(closed ? `${dmy(day)} marked as closed` : `${dmy(day)} is a trading day again`)
    if (month) load(month)
  }

  async function mark(patch: { invoices_entered?: boolean; closed_at?: string | null }, msg: string) {
    const { error } = await supabase.from('month_closes')
      .upsert({ month: `${month}-01`, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'month' })
    if (error) return toast(error.message, { kind: 'error' })
    toast(msg)
    if (month) load(month)
  }

  async function closeMonth() {
    if (!month) return
    if (!await confirmDialog({ title: `Close ${monthLabel(month)}?`, body: 'A mark for you that the month is done. Entries can still be posted into it.', confirmLabel: 'Close month' })) return
    mark({ closed_at: new Date().toISOString() }, `${monthLabel(month)} closed`)
  }

  const steps: Step[] = !s || !month ? [] : [
    { name: 'Sales uploaded', state: s.days_missing.length === 0 ? 'done' : 'open', to: '/sales/upload', link: 'Upload',
      detail: s.days_missing.length === 0 ? 'All days in' : <>
        Missing {listDays(s.days_missing)}
        <div className="mt-1 text-xs text-slate-500">Bar closed that day?{' '}
          {s.days_missing.slice(0, 10).map(d => <button key={d} type="button" className="link mr-2" onClick={() => setClosedDay(d, true)}>{dmy(d)}</button>)}
        </div>
      </> },
    { name: 'Card settled', state: s.card_unsettled > 0 ? 'open' : 'done', to: '/sales/fiuu', link: 'Settle',
      detail: s.card_unsettled > 0 ? `${rm(s.card_unsettled)}${s.card_since ? ` since ${dmy(s.card_since)}` : ''} still in 1200` : 'Nothing waiting' },
    { name: 'Supplier invoices entered', state: s.invoices_entered ? 'done' : 'open', to: '/ap/invoices', link: 'Invoices',
      detail: <label className="mb-0 flex items-center gap-2 font-normal">
        <input type="checkbox" checked={s.invoices_entered} onChange={e => mark({ invoices_entered: e.target.checked }, e.target.checked ? 'Invoices marked as all in' : 'Invoices tick removed')} />
        All bills for the month are in
      </label> },
    { name: 'Timesheet', state: s.active_staff === 0 ? 'skip' : s.timesheet_rows > 0 ? 'done' : 'open', to: '/payroll/timesheet', link: 'Timesheet',
      detail: s.active_staff === 0 ? 'No active staff' : `${s.timesheet_rows} entr${s.timesheet_rows === 1 ? 'y' : 'ies'} for ${s.active_staff} staff` },
    { name: 'Payroll', state: s.active_staff === 0 ? 'skip' : s.payroll.status === 'paid' ? 'done' : 'open', to: '/payroll/run', link: 'Payroll',
      detail: s.active_staff === 0 ? 'No active staff' : { none: 'Not started', draft: 'Draft', approved: 'Approved, not paid', paid: 'Paid' }[s.payroll.status] },
    { name: 'Accruals', state: s.accruals_posted ? 'done' : 'open', to: '/gl/accruals', link: 'Accruals', detail: s.accruals_posted ? 'Posted' : 'Not posted' },
    { name: 'Stock count', state: s.stock_count_posted ? 'done' : 'open', to: '/stock/count', link: 'Stock count', detail: s.stock_count_posted ? 'Posted' : 'No count posted this month (a count with no difference posts nothing)' },
    { name: 'Bank reconciled', state: s.bank_uncleared === 0 ? 'done' : 'open', to: '/cash/bank-rec', link: 'Bank rec',
      detail: s.bank_uncleared === 0 ? 'All ticked' : `${s.bank_uncleared} line${s.bank_uncleared === 1 ? '' : 's'} not ticked` },
    { name: 'Review P&L', state: 'open', to: `/reports/pl?from=${month}-01&to=${lastDay(month)}`, link: 'P&L', detail: 'Open the statement for the month' },
  ]
  const ready = steps.length > 0 && steps.slice(0, 8).every(st => st.state !== 'open')
  const closed = !!s?.closed_at

  return (
    <div className="space-y-4">
      <PageActions>
        {month && closed && <button className="btn-light" onClick={() => mark({ closed_at: null }, `${monthLabel(month)} reopened`)}>Reopen</button>}
        {month && !closed && <button className="btn" disabled={!ready} title={ready ? '' : 'Finish steps 1 to 8 first'} onClick={closeMonth}>Close month</button>}
      </PageActions>
      <div className="card flex flex-wrap items-end gap-4">
        <div className="w-44"><label>Month</label>{month ? <MonthInput value={month} onChange={setMonth} /> : <input disabled value="…" />}</div>
        {closed && s?.closed_at && <p className="pb-2 text-[13px] text-green-700">Closed on {new Date(s.closed_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}</p>}
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="card p-0">
        {!s && !error && <Empty text="Checking the month…" />}
        {s && (
          <ol className="divide-y divide-slate-100">
            {steps.map((st, i) => (
              <li key={st.name} className="flex items-start gap-3 px-4 py-3">
                <Mark state={st.state} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i + 1}. {st.name}</div>
                  <div className="text-[13px] text-slate-600">{st.detail}</div>
                </div>
                <Link to={st.to} className="btn-light shrink-0">{st.link}</Link>
              </li>
            ))}
          </ol>
        )}
        {s && s.days_closed.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Closed days: {s.days_closed.map(d => <span key={d} className="mr-2">{dmy(d)} <button type="button" className="link" onClick={() => setClosedDay(d, false)}>undo</button></span>)}
          </p>
        )}
      </div>
      <p className="muted">Closing is a mark for you. Nothing is locked: a late bill can still be posted into a closed month.</p>
    </div>
  )
}
