import { useEffect, useState } from 'react'
import { CheckCircle2, Pencil, Plus, Printer, Trash2, XCircle } from 'lucide-react'
import { dmy, downloadCsv, rm, round2, supabase, todayMY, type Profile, type Role } from '../lib'
import { Empty, ReportBar } from '../ui'

type Employee = {
  id: number; profile_id: string | null; employee_no: string | null; name: string; id_no: string | null
  is_local: boolean; position: string | null; join_date: string | null; leave_date: string | null
  pay_type: 'monthly' | 'hourly'; rate: number; bank_name: string | null; bank_account: string | null
  epf_no: string | null; socso_no: string | null; tax_no: string | null
  epf_on: boolean; socso_on: boolean; eis_on: boolean; pcb_on: boolean; active: boolean
}

type Payslip = {
  id: number; run_id: number; employee_id: number; name: string; employee_no: string | null; id_no: string | null
  is_local: boolean; position: string | null; bank_name: string | null; bank_account: string | null
  epf_no: string | null; socso_no: string | null; tax_no: string | null
  basic: number; hours: number; hourly_rate: number; ot_hours: number; ot_amount: number
  allowance: number; service_charge: number; unpaid_leave: number; other_deduction: number
  epf_employee: number; epf_employer: number; socso_employee: number; socso_employer: number
  eis_employee: number; eis_employer: number; pcb: number; note: string | null
  gross: number; net_pay: number; employer_cost: number; month: string; pay_date: string; status: 'draft' | 'approved'
}

type Run = { id: number; month: string; pay_date: string; status: 'draft' | 'approved'; journal_id: number | null }

const n = (v: number | string | null) => Number(v ?? 0)
const monthName = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// ---------------------------------------------------------------- Employees

const blankEmployee = {
  name: '', employee_no: '', id_no: '', is_local: true, position: '', join_date: todayMY(), leave_date: '',
  pay_type: 'monthly' as 'monthly' | 'hourly', rate: '', bank_name: '', bank_account: '', epf_no: '', socso_no: '', tax_no: '',
  epf_on: true, socso_on: true, eis_on: true, pcb_on: false, active: true, profile_id: '',
}

export function Employees({ role }: { role: Role }) {
  const [list, setList] = useState<Employee[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [edit, setEdit] = useState<(typeof blankEmployee & { id?: number }) | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = role === 'owner' || role === 'accountant'

  const load = () => { supabase.from('employees').select('*').order('active', { ascending: false }).order('name').then(({ data }) => setList(data ?? [])) }
  useEffect(load, [])
  useEffect(() => { supabase.from('profiles').select('*').order('full_name').then(({ data }) => setPeople(data ?? [])) }, [])

  function start(e?: Employee) {
    setError('')
    setEdit(e
      ? { ...blankEmployee, ...e, rate: String(e.rate), employee_no: e.employee_no ?? '', id_no: e.id_no ?? '',
          position: e.position ?? '', join_date: e.join_date ?? '', leave_date: e.leave_date ?? '',
          bank_name: e.bank_name ?? '', bank_account: e.bank_account ?? '', epf_no: e.epf_no ?? '',
          socso_no: e.socso_no ?? '', tax_no: e.tax_no ?? '', profile_id: e.profile_id ?? '', id: e.id }
      : { ...blankEmployee })
  }

  // Foreign staff: EPF 2% + 2%, SOCSO work injury only, no EIS.
  function setLocal(is_local: boolean) {
    setEdit(e => e && ({ ...e, is_local, eis_on: is_local ? e.eis_on : false }))
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    if (!edit || saving) return
    setSaving(true)
    const { id, ...f } = edit
    const row = {
      ...f, rate: round2(Number(f.rate || 0)),
      employee_no: f.employee_no || null, id_no: f.id_no || null, position: f.position || null,
      join_date: f.join_date || null, leave_date: f.leave_date || null, bank_name: f.bank_name || null,
      bank_account: f.bank_account || null, epf_no: f.epf_no || null, socso_no: f.socso_no || null,
      tax_no: f.tax_no || null, profile_id: f.profile_id || null,
    }
    const { error } = id
      ? await supabase.from('employees').update(row).eq('id', id)
      : await supabase.from('employees').insert(row)
    setSaving(false)
    if (error) return setError(error.message)
    setEdit(null); load()
  }

  if (edit) return (
    <form onSubmit={save} className="card max-w-3xl space-y-5 p-6">
      <h3 className="font-semibold">{edit.id ? 'Edit staff' : 'New staff'}</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2"><label>Name (as in IC / passport)</label><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} required /></div>
        <div><label>Staff no.</label><input value={edit.employee_no} onChange={e => setEdit({ ...edit, employee_no: e.target.value })} /></div>
        <div><label>Malaysian or foreign</label>
          <select value={edit.is_local ? 'local' : 'foreign'} onChange={e => setLocal(e.target.value === 'local')}>
            <option value="local">Malaysian</option><option value="foreign">Foreign worker</option>
          </select>
        </div>
        <div><label>IC / passport no.</label><input value={edit.id_no} onChange={e => setEdit({ ...edit, id_no: e.target.value })} /></div>
        <div><label>Position</label><input value={edit.position} onChange={e => setEdit({ ...edit, position: e.target.value })} placeholder="Bartender, kitchen…" /></div>
        <div><label>Paid</label>
          <select value={edit.pay_type} onChange={e => setEdit({ ...edit, pay_type: e.target.value as 'monthly' | 'hourly' })}>
            <option value="monthly">Monthly salary</option><option value="hourly">By the hour</option>
          </select>
        </div>
        <div><label>{edit.pay_type === 'monthly' ? 'Monthly salary (RM)' : 'Rate per hour (RM)'}</label>
          <input type="number" step="0.01" min="0" inputMode="decimal" value={edit.rate} onChange={e => setEdit({ ...edit, rate: e.target.value })} required /></div>
        <div><label>Joined on</label><input type="date" value={edit.join_date} onChange={e => setEdit({ ...edit, join_date: e.target.value })} /></div>
        <div><label>Bank</label><input value={edit.bank_name} onChange={e => setEdit({ ...edit, bank_name: e.target.value })} placeholder="Maybank, CIMB…" /></div>
        <div><label>Bank account no.</label><input value={edit.bank_account} onChange={e => setEdit({ ...edit, bank_account: e.target.value })} /></div>
        <div><label>Left on (blank if still working)</label><input type="date" value={edit.leave_date} onChange={e => setEdit({ ...edit, leave_date: e.target.value })} /></div>
        <div><label>EPF no.</label><input value={edit.epf_no} onChange={e => setEdit({ ...edit, epf_no: e.target.value })} /></div>
        <div><label>SOCSO no.</label><input value={edit.socso_no} onChange={e => setEdit({ ...edit, socso_no: e.target.value })} /></div>
        <div><label>Income tax no.</label><input value={edit.tax_no} onChange={e => setEdit({ ...edit, tax_no: e.target.value })} /></div>
        <div className="sm:col-span-2"><label>Login for payslips (optional)</label>
          <select value={edit.profile_id} onChange={e => setEdit({ ...edit, profile_id: e.target.value })}>
            <option value="">— not linked —</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
      </div>
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="mb-3 text-sm font-medium">Deductions for this person</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {([['epf_on', 'EPF'], ['socso_on', 'SOCSO'], ['eis_on', 'EIS'], ['pcb_on', 'PCB (income tax)']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.checked })} />{label}
            </label>
          ))}
          <label className="flex items-center gap-2 font-normal">
            <input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} />Still working here
          </label>
        </div>
        {!edit.is_local && <p className="muted mt-3">Foreign worker: EPF 2% + 2%, SOCSO work injury only (employer pays), no EIS. Check the current rules with KWSP / PERKESO.</p>}
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-light" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save staff'}</button>
      </div>
    </form>
  )

  return (
    <div className="space-y-4">
      {canEdit && <div className="flex justify-end"><button className="btn" onClick={() => start()}><Plus className="size-4" />New staff</button></div>}
      <div className="card overflow-x-auto p-0">
        {list.length === 0 && <Empty text="No staff yet." />}
        {list.length > 0 && <table>
          <thead><tr><th>Name</th><th>Position</th><th>Type</th><th className="text-right">Pay</th><th>Deductions</th><th></th></tr></thead>
          <tbody>
            {list.map(e => (
              <tr key={e.id} className={e.active ? '' : 'text-slate-400'}>
                <td><div className="font-medium">{e.name}</div><div className="text-xs text-slate-500">{e.employee_no} {e.is_local ? '' : '· Foreign'}</div></td>
                <td className="text-slate-600">{e.position}</td>
                <td>{e.pay_type === 'monthly' ? 'Monthly' : 'Hourly'}</td>
                <td className="text-right">{rm(e.rate)}{e.pay_type === 'hourly' && <span className="text-xs text-slate-500"> /hr</span>}</td>
                <td className="text-xs text-slate-600">{[e.epf_on && 'EPF', e.socso_on && 'SOCSO', e.eis_on && 'EIS', e.pcb_on && 'PCB'].filter(Boolean).join(' · ') || 'None'}</td>
                <td className="text-right">{canEdit && <button title="Edit" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand" onClick={() => start(e)}><Pencil className="size-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Payroll run

const FIELDS = [
  ['basic', 'Basic'], ['hours', 'Hours'], ['ot_amount', 'OT'], ['allowance', 'Allowance'],
  ['service_charge', 'Service charge'], ['unpaid_leave', 'Unpaid leave'], ['other_deduction', 'Other deduction'], ['pcb', 'PCB'],
] as const

// Only used when the contributions are typed in by hand.
const STATUTORY = [
  ['epf_employee', 'EPF (staff)'], ['epf_employer', 'EPF (employer)'],
  ['socso_employee', 'SOCSO (staff)'], ['socso_employer', 'SOCSO (employer)'],
  ['eis_employee', 'EIS (staff)'], ['eis_employer', 'EIS (employer)'],
] as const

export function PayrollRun({ role }: { role: Role }) {
  const [runs, setRuns] = useState<Run[]>([])
  const [runId, setRunId] = useState<number | null>(null)
  const [slips, setSlips] = useState<Payslip[]>([])
  const [newMonth, setNewMonth] = useState(todayMY().slice(0, 7))
  const [editing, setEditing] = useState<Payslip | null>(null)
  const [busyRun, setBusyRun] = useState(false)
  const [error, setError] = useState('')
  const canEdit = role === 'owner' || role === 'accountant'
  const run = runs.find(r => r.id === runId)

  const loadRuns = () => {
    supabase.from('payroll_runs').select('*').order('month', { ascending: false })
      .then(({ data }) => { setRuns((data as Run[]) ?? []); setRunId(id => id ?? (data?.[0]?.id ?? null)) })
  }
  const loadSlips = () => {
    if (!runId) return setSlips([])
    supabase.from('payslip_view').select('*').eq('run_id', runId).order('name')
      .then(({ data }) => setSlips((data as Payslip[]) ?? []))
  }
  useEffect(loadRuns, [])
  useEffect(loadSlips, [runId])

  async function create() {
    if (busyRun) return
    setBusyRun(true); setError('')
    const month = newMonth + '-01'
    const [y, m] = newMonth.split('-').map(Number)
    const payDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)  // last day of the month
    const { data, error } = await supabase.rpc('create_payroll_run', { p_month: month, p_pay_date: payDate })
    setBusyRun(false)
    if (error) return setError(error.message)
    loadRuns(); setRunId(data)
  }

  async function saveSlip(fields: Record<string, number | string>, recalc: boolean) {
    if (!editing) return
    const { error } = await supabase.rpc('save_payslip', { p_id: editing.id, p_fields: fields, p_recalc: recalc })
    if (error) return setError(error.message)
    setEditing(null); loadSlips()
  }

  async function act(fn: string) {
    if (!runId) return
    if (fn === 'cancel_payroll_run' && !confirm('Cancel this approved payroll? The salary entry will be removed.')) return
    if (fn === 'delete_payroll_run' && !confirm('Delete this draft payroll?')) return
    const { error } = await supabase.rpc(fn, { p_id: runId })
    if (error) return setError(error.message)
    if (fn === 'delete_payroll_run') setRunId(null)
    setError(''); loadRuns(); loadSlips()
  }

  const total = (k: keyof Payslip) => slips.reduce((s, p) => s + n(p[k] as number), 0)
  const csv = () => downloadCsv(`payroll-${run?.month}.csv`, [
    ['Staff', 'Bank', 'Account', 'Basic', 'OT', 'Allowance', 'Service charge', 'Gross', 'EPF (staff)', 'SOCSO (staff)', 'EIS (staff)', 'PCB', 'Other', 'Net pay', 'EPF (employer)', 'SOCSO (employer)', 'EIS (employer)'],
    ...slips.map(p => [p.name, p.bank_name ?? '', p.bank_account ?? '', n(p.basic), n(p.ot_amount), n(p.allowance), n(p.service_charge), n(p.gross),
      n(p.epf_employee), n(p.socso_employee), n(p.eis_employee), n(p.pcb), n(p.other_deduction), n(p.net_pay), n(p.epf_employer), n(p.socso_employer), n(p.eis_employer)]),
    ['Total', '', '', '', '', '', '', round2(total('gross')), round2(total('epf_employee')), round2(total('socso_employee')),
      round2(total('eis_employee')), round2(total('pcb')), round2(total('other_deduction')), round2(total('net_pay')),
      round2(total('epf_employer')), round2(total('socso_employer')), round2(total('eis_employer'))],
  ])

  if (editing) return (
    <form className="card max-w-2xl space-y-5 p-6" onSubmit={e => {
      e.preventDefault()
      const form = new FormData(e.target as HTMLFormElement)
      const recalc = form.get('recalc') === 'on'
      const fields = Object.fromEntries([...form.entries()]
        .filter(([k]) => k !== 'recalc')
        .filter(([k]) => recalc ? !STATUTORY.some(([f]) => f === k) : true)
        .map(([k, v]) => [k, Number(v) || 0]))
      saveSlip(fields, recalc)
    }}>
      <div>
        <h3 className="font-semibold">{editing.name}</h3>
        <p className="muted">{monthName(editing.month)} · contributions are worked out again when you save</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {FIELDS.map(([k, label]) => (
          <div key={k}><label>{label}{k === 'hours' ? '' : ' (RM)'}</label>
            <input name={k} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={n(editing[k])} /></div>
        ))}
      </div>
      <p className="muted">Hours only matter for staff paid by the hour: pay becomes hours × rate ({rm(editing.hourly_rate)}/hour).</p>
      <div className="rounded-xl bg-slate-50 p-4">
        <label className="flex items-center gap-2 font-normal">
          <input type="checkbox" name="recalc" defaultChecked />
          Work out EPF, SOCSO and EIS again when I save
        </label>
        <p className="muted mt-2">
          EPF is worked out on basic pay and allowances; SOCSO and EIS also count overtime and service charge.
          Untick to type the figures in yourself — for example to match the PERKESO table to the sen.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {STATUTORY.map(([k, label]) => (
            <div key={k}><label>{label} (RM)</label>
              <input name={k} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={n(editing[k])} /></div>
          ))}
        </div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-light" onClick={() => { setEditing(null); setError('') }}>Cancel</button>
        <button className="btn">Save payslip</button>
      </div>
    </form>
  )

  return (
    <div className="space-y-4">
      <div className="no-print card flex flex-wrap items-end gap-3">
        <div className="w-56"><label>Payroll month</label>
          <select value={runId ?? ''} onChange={e => setRunId(Number(e.target.value))}>
            {runs.length === 0 && <option value="">— none yet —</option>}
            {runs.map(r => <option key={r.id} value={r.id}>{monthName(r.month)} {r.status === 'approved' ? '(approved)' : '(draft)'}</option>)}
          </select>
        </div>
        {canEdit && <>
          <div className="w-44"><label>Start a new month</label><input type="month" value={newMonth} onChange={e => setNewMonth(e.target.value)} /></div>
          <button className="btn-light" onClick={create} disabled={busyRun}><Plus className="size-4" />Create</button>
        </>}
        <div className="ml-auto flex gap-2">
          {run && <button className="btn-light" onClick={() => window.print()}><Printer className="size-4" />Print</button>}
          {run && <button className="btn-light" onClick={csv}>Excel</button>}
          {run?.status === 'draft' && role === 'owner' && <button className="btn" onClick={() => act('approve_payroll_run')}><CheckCircle2 className="size-4" />Approve &amp; post</button>}
          {run?.status === 'approved' && role === 'owner' && <button className="btn-light" onClick={() => act('cancel_payroll_run')}><XCircle className="size-4" />Cancel approval</button>}
          {run?.status === 'draft' && role === 'owner' && slips.length === 0 && <button className="btn-light" onClick={() => act('delete_payroll_run')}><Trash2 className="size-4" /></button>}
        </div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      {!run && <Empty text="No payroll month yet. Pick a month and press Create." />}

      {run && (
        <>
          <ReportBar title={`Payroll ${monthName(run.month)}`} period={`Pay date ${dmy(run.pay_date)}`} />
          {run.status === 'approved' && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Approved and posted to the books. Pay the staff with a Payment Voucher from account 2300 Salaries Payable.</p>}
          <div className="card overflow-x-auto p-0">
            <table>
              <thead><tr>
                <th>Staff</th><th className="text-right">Basic</th><th className="text-right">OT</th><th className="text-right">Allowance</th>
                <th className="text-right">Gross</th><th className="text-right">EPF</th><th className="text-right">SOCSO</th><th className="text-right">EIS</th>
                <th className="text-right">PCB</th><th className="text-right">Other</th><th className="text-right">Net pay</th><th className="no-print"></th>
              </tr></thead>
              <tbody>
                {slips.map(p => (
                  <tr key={p.id}>
                    <td><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.is_local ? '' : 'Foreign · '}{p.bank_name} {p.bank_account}</div></td>
                    <td className="text-right">{rm(p.basic)}</td>
                    <td className="text-right">{rm(p.ot_amount)}</td>
                    <td className="text-right">{rm(n(p.allowance) + n(p.service_charge))}</td>
                    <td className="text-right font-medium">{rm(p.gross)}</td>
                    <td className="text-right">{rm(p.epf_employee)}</td>
                    <td className="text-right">{rm(p.socso_employee)}</td>
                    <td className="text-right">{rm(p.eis_employee)}</td>
                    <td className="text-right">{rm(p.pcb)}</td>
                    <td className="text-right">{rm(p.other_deduction)}</td>
                    <td className="text-right font-semibold">{rm(p.net_pay)}</td>
                    <td className="no-print text-right">
                      {canEdit && run.status === 'draft' &&
                        <button title="Edit" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand" onClick={() => setEditing(p)}><Pencil className="size-4" /></button>}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td>Total ({slips.length})</td>
                  <td className="text-right">{rm(total('basic'))}</td>
                  <td className="text-right">{rm(total('ot_amount'))}</td>
                  <td className="text-right">{rm(total('allowance') + total('service_charge'))}</td>
                  <td className="text-right">{rm(total('gross'))}</td>
                  <td className="text-right">{rm(total('epf_employee'))}</td>
                  <td className="text-right">{rm(total('socso_employee'))}</td>
                  <td className="text-right">{rm(total('eis_employee'))}</td>
                  <td className="text-right">{rm(total('pcb'))}</td>
                  <td className="text-right">{rm(total('other_deduction'))}</td>
                  <td className="text-right">{rm(total('net_pay'))}</td>
                  <td className="no-print"></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            {[['Net to pay staff', total('net_pay')], ['EPF to KWSP', total('epf_employee') + total('epf_employer')],
              ['SOCSO + EIS to PERKESO', total('socso_employee') + total('socso_employer') + total('eis_employee') + total('eis_employer')],
              ['PCB to LHDN', total('pcb')]].map(([label, v]) => (
              <div key={label as string} className="card p-4"><div className="muted">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{rm(v as number)}</div></div>
            ))}
          </div>
          <Payslips slips={slips} />
        </>
      )}
    </div>
  )
}

// Printable payslips, one per staff member.
function Payslips({ slips }: { slips: Payslip[] }) {
  const [show, setShow] = useState(false)
  if (slips.length === 0) return null
  return (
    <div>
      <button className="no-print btn-light" onClick={() => setShow(s => !s)}><Printer className="size-4" />{show ? 'Hide payslips' : 'Show payslips for printing'}</button>
      {show && (
        <div className="mt-4 space-y-4">
          {slips.map(p => (
            <div key={p.id} className="card break-inside-avoid print:break-after-page">
              <div className="flex items-start justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-3">
                  <img src="/logo.png" alt="" className="size-10 rounded-lg object-contain" />
                  <div>
                    <div className="font-bold">DYRB</div>
                    <div className="muted">Payslip · {monthName(p.month)}</div>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-slate-500">{p.position} {p.employee_no && `· ${p.employee_no}`}</div>
                  <div className="text-slate-500">{p.id_no}</div>
                </div>
              </div>
              <div className="grid gap-6 pt-4 sm:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Earnings</h4>
                  <dl className="space-y-1.5 text-sm">
                    {[['Basic pay', p.basic], ['Overtime', p.ot_amount], ['Allowance', p.allowance], ['Service charge', p.service_charge], ['Unpaid leave', -n(p.unpaid_leave)]]
                      .filter(([, v]) => n(v as number) !== 0)
                      .map(([label, v]) => <div key={label as string} className="flex justify-between"><dt className="text-slate-600">{label}</dt><dd className="tabular-nums">{rm(v as number)}</dd></div>)}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><dt>Gross pay</dt><dd className="tabular-nums">{rm(p.gross)}</dd></div>
                  </dl>
                </div>
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Deductions</h4>
                  <dl className="space-y-1.5 text-sm">
                    {[['EPF', p.epf_employee], ['SOCSO', p.socso_employee], ['EIS', p.eis_employee], ['PCB (income tax)', p.pcb], ['Other', p.other_deduction]]
                      .filter(([, v]) => n(v as number) !== 0)
                      .map(([label, v]) => <div key={label as string} className="flex justify-between"><dt className="text-slate-600">{label}</dt><dd className="tabular-nums">{rm(v as number)}</dd></div>)}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><dt>Total deductions</dt>
                      <dd className="tabular-nums">{rm(n(p.gross) - n(p.net_pay))}</dd></div>
                  </dl>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-soft px-4 py-3">
                <span className="font-semibold text-brand-dark">Net pay</span>
                <span className="text-lg font-bold text-brand-dark tabular-nums">{rm(p.net_pay)}</span>
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                <span>Paid on {dmy(p.pay_date)} {p.bank_name ? `to ${p.bank_name} ${p.bank_account}` : 'in cash'}</span>
                <span>Employer paid: EPF {rm(p.epf_employer)} · SOCSO {rm(p.socso_employer)} · EIS {rm(p.eis_employer)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- My payslips (staff)

export function MyPayslips({ profile }: { profile: Profile }) {
  const [slips, setSlips] = useState<Payslip[]>([])
  useEffect(() => {
    supabase.from('payslip_view').select('*').eq('status', 'approved').order('month', { ascending: false })
      .then(({ data }) => setSlips((data as Payslip[]) ?? []))
  }, [profile.id])
  if (slips.length === 0) return <Empty text="No payslips yet." />
  return <Payslips slips={slips} />
}

// ---------------------------------------------------------------- Yearly summary (for EA forms)

export function PayrollYear() {
  const [year, setYear] = useState(todayMY().slice(0, 4))
  const [slips, setSlips] = useState<Payslip[]>([])
  useEffect(() => {
    supabase.from('payslip_view').select('*').eq('status', 'approved')
      .gte('month', `${year}-01-01`).lte('month', `${year}-12-01`)
      .then(({ data }) => setSlips((data as Payslip[]) ?? []))
  }, [year])

  const byStaff = new Map<string, Payslip[]>()
  for (const p of slips) byStaff.set(p.name, [...(byStaff.get(p.name) ?? []), p])
  const rows = [...byStaff.entries()].map(([name, list]) => ({
    name, id_no: list[0].id_no, tax_no: list[0].tax_no, epf_no: list[0].epf_no,
    months: list.length,
    gross: list.reduce((s, p) => s + n(p.gross), 0),
    epf: list.reduce((s, p) => s + n(p.epf_employee), 0),
    socso: list.reduce((s, p) => s + n(p.socso_employee), 0),
    pcb: list.reduce((s, p) => s + n(p.pcb), 0),
    net: list.reduce((s, p) => s + n(p.net_pay), 0),
  })).sort((a, b) => a.name.localeCompare(b.name))

  const csv = () => downloadCsv(`payroll-year-${year}.csv`, [
    ['Staff', 'IC / passport', 'Tax no.', 'EPF no.', 'Months paid', 'Gross pay', 'EPF (staff)', 'SOCSO (staff)', 'PCB', 'Net paid'],
    ...rows.map(r => [r.name, r.id_no ?? '', r.tax_no ?? '', r.epf_no ?? '', r.months, round2(r.gross), round2(r.epf), round2(r.socso), round2(r.pcb), round2(r.net)]),
  ])

  return (
    <div className="space-y-4">
      <ReportBar title="Payroll Yearly Summary" period={year} onCsv={csv}>
        <div className="w-32"><label>Year</label><input type="number" min="2020" max="2100" value={year} onChange={e => setYear(e.target.value)} /></div>
      </ReportBar>
      <p className="muted">Use these totals to fill in the EA forms for your staff.</p>
      <div className="card overflow-x-auto p-0">
        {rows.length === 0 && <Empty text="No approved payroll for this year." />}
        {rows.length > 0 && <table>
          <thead><tr><th>Staff</th><th>IC / passport</th><th className="text-right">Months</th><th className="text-right">Gross pay</th><th className="text-right">EPF</th><th className="text-right">SOCSO</th><th className="text-right">PCB</th><th className="text-right">Net paid</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name}>
                <td className="font-medium">{r.name}</td><td className="text-slate-600">{r.id_no}</td>
                <td className="text-right">{r.months}</td><td className="text-right">{rm(r.gross)}</td>
                <td className="text-right">{rm(r.epf)}</td><td className="text-right">{rm(r.socso)}</td>
                <td className="text-right">{rm(r.pcb)}</td><td className="text-right font-semibold">{rm(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Rates

const RATE_FIELDS: [string, string][] = [
  ['epf_employee_local', 'EPF staff share, Malaysian (%)'],
  ['epf_employer_local_low', 'EPF employer, wage up to threshold (%)'],
  ['epf_employer_local_high', 'EPF employer, wage above threshold (%)'],
  ['epf_wage_threshold', 'EPF wage threshold (RM)'],
  ['epf_employee_foreign', 'EPF staff share, foreign (%)'],
  ['epf_employer_foreign', 'EPF employer, foreign (%)'],
  ['socso_employee', 'SOCSO staff share (%)'],
  ['socso_employer', 'SOCSO employer, Malaysian (%)'],
  ['socso_employer_foreign', 'SOCSO employer, foreign — work injury (%)'],
  ['socso_wage_ceiling', 'SOCSO wage ceiling (RM)'],
  ['eis_employee', 'EIS staff share (%)'],
  ['eis_employer', 'EIS employer (%)'],
  ['eis_wage_ceiling', 'EIS wage ceiling (RM)'],
  ['minimum_wage', 'Minimum wage (RM)'],
]

export function PayrollSettings({ role }: { role: Role }) {
  const [rates, setRates] = useState<Record<string, number> | null>(null)
  const [msg, setMsg] = useState('')
  const canEdit = role === 'owner' || role === 'accountant'
  useEffect(() => { supabase.from('payroll_rates').select('*').single().then(({ data }) => setRates(data)) }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const form = Object.fromEntries([...new FormData(e.target as HTMLFormElement).entries()].map(([k, v]) => [k, Number(v) || 0]))
    const { error } = await supabase.from('payroll_rates').update(form).eq('id', 1)
    setMsg(error ? error.message : 'Saved')
  }

  if (!rates) return <Empty text="Loading…" />
  return (
    <form onSubmit={save} className="card max-w-3xl space-y-5 p-6">
      <p className="muted">These rates are used for new payslips. Check them against KWSP, PERKESO and LHDN whenever the rules change.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {RATE_FIELDS.map(([k, label]) => (
          <div key={k}><label>{label}</label>
            <input name={k} type="number" step="0.01" min="0" defaultValue={rates[k]} disabled={!canEdit} /></div>
        ))}
      </div>
      <p className="muted">PCB (monthly income tax) is typed in per person on the payslip. Work it out with the LHDN e-PCB calculator; most staff on low wages pay nothing.</p>
      {msg && <p className={msg === 'Saved' ? 'text-sm text-emerald-700' : 'alert-error'}>{msg}</p>}
      {canEdit && <div className="flex justify-end"><button className="btn">Save rates</button></div>}
    </form>
  )
}
