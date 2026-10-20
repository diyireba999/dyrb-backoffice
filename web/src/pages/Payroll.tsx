import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, FileText, Pencil, Plus, Printer, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { dmy, downloadExcel, isDirector, isOffice, MONEY_ACCOUNTS, MONEY_NAMES, rm, round2, supabase, todayMY, useAccounts, type Profile, type Role } from '../lib'
import { Empty, Letterhead, ReportBar, MonthInput, useCompany } from '../ui'
import { confirmDialog, toast } from '../feedback'
import { PageActions, printDocument, submittedAgain, useEscape } from '../page'
import { ringgitInWords } from '../money-words'

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
  eis_employee: number; eis_employer: number; pcb: number; note: string | null; advance_recovery: number
  gross: number; net_pay: number; employer_cost: number; month: string; pay_date: string; status: 'draft' | 'approved'; paid_on: string | null
}

type Run = { id: number; month: string; pay_date: string; status: 'draft' | 'approved'; journal_id: number | null; paid_on: string | null; paid_journal_id: number | null }

const runLabel = (r: Run) => r.status === 'draft' ? 'draft' : r.paid_on ? 'paid' : 'approved, not paid'
const runTone = (r: Run) => r.status === 'draft' ? 'bg-slate-100 text-slate-700' : r.paid_on ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'

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
  useEscape(() => { if (edit && !saving) { setEdit(null); setError('') } })

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
    toast(`${f.name} saved`)
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
        <p className="mb-3 text-[13px] font-medium">Deductions for this person</p>
        <div className="flex flex-wrap gap-4 text-[13px]">
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
        <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save staff'}</button>
      </div>
    </form>
  )

  return (
    <div className="space-y-4">
      {canEdit && <PageActions><button className="btn" onClick={() => start()}><Plus className="size-4" />New staff</button></PageActions>}
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
                <td className="text-right">{canEdit && <button title="Edit" className="btn-ghost px-1.5" onClick={() => start(e)}><Pencil className="size-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Staff advances

type Advance = { id: number; employee_id: number; date: string; amount: number; note: string | null; outstanding: number; journal_id: number }

const blankAdvance = { employee: '', date: todayMY(), amount: '', from: MONEY_ACCOUNTS[0], note: '' }

export function StaffAdvances({ role, approver }: { role: Role; approver: string }) {
  const [rows, setRows] = useState<Advance[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [f, setF] = useState(blankAdvance)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [printing, setPrinting] = useState<{ adv: Advance; doc: string } | null>(null)
  const first = useRef<HTMLSelectElement>(null)
  const canEdit = role === 'owner' || role === 'accountant'
  const nameOf = (id: number) => employees.find(e => e.id === id)?.name ?? '—'
  const outstandingFor = (id: number) => rows.filter(r => r.employee_id === id).reduce((s, r) => s + Number(r.outstanding), 0)

  const load = () => { supabase.from('advance_balances').select('*').order('date', { ascending: false }).then(({ data }) => setRows((data as Advance[]) ?? [])) }
  useEffect(load, [])
  useEffect(() => { supabase.from('employees').select('*').order('name').then(({ data }) => setEmployees((data as Employee[]) ?? [])) }, [])
  useEscape(() => { if (mode === 'form' && !busy) { setMode('list'); setError('') } })

  // Newest first within each staff member, staff grouped alphabetically.
  const sorted = [...rows].sort((a, b) => nameOf(a.employee_id).localeCompare(nameOf(b.employee_id)) || b.date.localeCompare(a.date))

  function startNew() { setF(blankAdvance); setHighlight(0); setError(''); setMode('form') }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!f.employee) return setError('Choose a staff member')
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    const again = submittedAgain(e)
    const { data, error } = await supabase.rpc('record_advance', {
      p_employee: Number(f.employee), p_date: f.date, p_amount: amount, p_from: f.from, p_note: f.note || null,
    })
    if (error) { setBusy(false); return setError(error.message) }
    // The advance is already saved at this point; a failed doc-number lookup should
    // not stop the toast, just drop the number from it.
    let doc: string | undefined
    try {
      const { data: adv } = await supabase.from('staff_advances').select('journals(doc_no)').eq('id', data).single()
      doc = (adv as unknown as { journals: { doc_no: string } } | null)?.journals?.doc_no
    } catch { /* no number in the toast, but the save already succeeded */ }
    setBusy(false)
    toast(`${doc ? doc + ' · ' : ''}Salary advance of ${rm(amount)} given to ${nameOf(Number(f.employee))}`)
    setHighlight(data as number)
    setF(blankAdvance)
    if (!again) setMode('list')
    else setTimeout(() => first.current?.focus(), 0)
    load()
  }

  // The signed paper: the advance's document number is on its journal, then the
  // form prints on its own.
  async function printForm(a: Advance) {
    const { data, error } = await supabase.from('journals').select('doc_no').eq('id', a.journal_id).single()
    if (error) return toast('Could not load the advance: ' + error.message, { kind: 'error' })
    setPrinting({ adv: a, doc: (data as { doc_no: string }).doc_no })
    printDocument()
  }

  async function remove(a: Advance) {
    if (!await confirmDialog({ title: 'Remove this advance?', body: `${nameOf(a.employee_id)} · ${rm(a.amount)}`, confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.rpc('delete_advance', { p_id: a.id })
    if (error) return toast(error.message, { kind: 'error' })
    load()
  }

  if (mode === 'form') {
    const chosen = f.employee ? Number(f.employee) : null
    const outstanding = chosen ? outstandingFor(chosen) : 0
    return (
      <form onSubmit={submit} className="card max-w-xl space-y-5 p-6">
        <button type="button" className="link" onClick={() => { setMode('list'); setError('') }}>← Back to list</button>
        <p className="muted">This pays a staff member ahead of payday. The money leaves the till now, and comes back out of their next payslip by itself.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><label>Staff member</label>
            <select ref={first} value={f.employee} onChange={e => setF({ ...f, employee: e.target.value })} required autoFocus>
              <option value="">— choose —</option>
              {employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {chosen !== null && outstanding > 0 && <p className="muted mt-1">Already has {rm(outstanding)} outstanding.</p>}
          </div>
          <div><label>Date</label><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required /></div>
          <div><label>Amount (RM)</label><input type="number" step="0.01" min="0.01" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} required /></div>
          <div><label>Paid from</label>
            <select value={f.from} onChange={e => setF({ ...f, from: e.target.value })}>
              {MONEY_ACCOUNTS.map(c => <option key={c} value={c}>{MONEY_NAMES[c]}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><label>Note (optional)</label><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></div>
        </div>
        {error && <p className="alert-error">{error}</p>}
        <div className="flex flex-row-reverse justify-start gap-2">
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Give advance'}</button>
          <button className="btn-light" name="again" disabled={busy}>Save & add another</button>
          <button type="button" className="btn-ghost" onClick={() => { setMode('list'); setError('') }}>Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-4">
      {canEdit && <PageActions><button className="btn" onClick={startNew}><Plus className="size-4" />New advance</button></PageActions>}
      <div className="print-page card overflow-x-auto p-0">
        {sorted.length === 0 && <Empty text="No salary advances yet." />}
        {sorted.length > 0 && <table>
          <thead><tr><th>Date</th><th>Staff</th><th className="text-right">Amount</th><th className="text-right">Outstanding</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {sorted.map(a => (
              <tr key={a.id} className={a.id === highlight ? 'row-new' : ''}>
                <td>{dmy(a.date)}</td>
                <td className="font-medium">{nameOf(a.employee_id)}</td>
                <td className="text-right">{rm(a.amount)}</td>
                <td className={`text-right ${Number(a.outstanding) > 0 ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>{rm(a.outstanding)}</td>
                <td className="text-slate-600">{a.note}</td>
                <td className="whitespace-nowrap text-right">
                  <button title="Print form" aria-label="Print the agreement form" className="btn-ghost px-1.5" onClick={() => printForm(a)}><Printer className="size-4" /></button>
                  {canEdit && Number(a.outstanding) === Number(a.amount) &&
                    <button title="Remove" className="btn-ghost px-1.5 hover:bg-red-50 hover:text-red-600" onClick={() => remove(a)}><Trash2 className="size-4" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
      {printing && <AdvanceForm adv={printing.adv} doc={printing.doc} employee={employees.find(e => e.id === printing.adv.employee_id)} approver={approver} />}
    </div>
  )
}

// The paper a staff member signs for a salary advance. Print-only, short enough
// to read in ten seconds.
function AdvanceForm({ adv, doc, employee, approver }: { adv: Advance; doc: string; employee?: Employee; approver: string }) {
  const company = useCompany()
  const month = monthLabelOf(adv.date.slice(0, 7))
  const rows: [string, string][] = [
    ['Name', employee?.name ?? ''],
    ['IC / Passport', employee?.id_no ?? '—'],
    ['Date', dmy(adv.date)],
    ['Amount', `${rm(adv.amount)}  (${ringgitInWords(adv.amount)})`],
  ]
  return (
    <div className="print-doc hidden print:block">
      <Letterhead title="Salary Advance" period={`${doc} · ${dmy(adv.date)}`} />
      <table className="mt-6 w-full text-[14px]">
        <tbody>
          {rows.map(([k, v]) => <tr key={k}><td className="w-36 py-2 font-medium text-slate-600">{k}</td><td className="py-2">{v}</td></tr>)}
        </tbody>
      </table>
      <p className="mt-6 text-[14px] leading-relaxed">
        I received this salary advance. It will be deducted from my <b>{month}</b> salary, and any balance from the following month.
      </p>
      <div className="mt-16 grid grid-cols-2 gap-16 text-[13px]">
        <div>
          <div className="border-t border-slate-800 pt-1 font-medium">Staff</div>
          <div className="mt-3 text-slate-600">{employee?.name}</div>
          <div className="mt-2 text-slate-600">Date: ____________________</div>
        </div>
        <div>
          <div className="border-t border-slate-800 pt-1 font-medium">Approved by {company.name}</div>
          <div className="mt-3 text-slate-600">{approver}</div>
          <div className="mt-2 text-slate-600">Date: ____________________</div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Timesheet

type TsCell = { hours: string; ot_hours: string }
type TsRow = { employee_id: number; work_date: string; hours: number; ot_hours: number }
type TsSaved = { hours: number; ot_hours: number }

const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }
const closeEnough = (a: number, b: number) => Math.abs(a - b) < 0.005
const monthLabelOf = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function Timesheet({ role }: { role: Role }) {
  const [month, setMonth] = useState(todayMY().slice(0, 7))
  const [staffId, setStaffId] = useState<number | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [data, setDataState] = useState<Record<string, TsCell>>({})
  // What the server actually has, per cell — totals are built from this, never
  // from what's merely typed, so a total never claims a figure payroll won't get.
  const [saved, setSavedState] = useState<Record<string, TsSaved>>({})
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [dayHours, setDayHours] = useState(10)
  const canEdit = isOffice(role)

  // Mirror `data` / `saved` in refs purely so a cell's queued write can be
  // captured synchronously (see `save` below) without waiting on a render.
  const dataRef = useRef<Record<string, TsCell>>({})
  const setData = (updater: (d: Record<string, TsCell>) => Record<string, TsCell>) => {
    dataRef.current = updater(dataRef.current)
    setDataState(dataRef.current)
  }
  const savedRef = useRef<Record<string, TsSaved>>({})
  const setSaved = (updater: (s: Record<string, TsSaved>) => Record<string, TsSaved>) => {
    savedRef.current = updater(savedRef.current)
    setSavedState(savedRef.current)
  }

  // One promise chain per cell: two writes to the same (employee, day) row can
  // never be in flight together, so a Tab from Hours to OT can't let the
  // Hours-only upsert land after the combined one and silently revert the OT.
  // Pruned once a chain settles with nothing queued behind it (see `save`).
  const inFlight = useRef<Record<string, Promise<unknown>>>({})

  useEffect(() => {
    supabase.from('employees').select('*').order('name').then(({ data }) => setEmployees((data as Employee[]) ?? []))
    supabase.from('payroll_rates').select('hours_per_day').single().then(({ data }) => data && setDayHours(Number(data.hours_per_day)))
  }, [])

  useEffect(() => {
    const first = `${month}-01`
    const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
    let stale = false  // a reply for a month already switched away from must not overwrite this one
    supabase.from('timesheets').select('employee_id, work_date, hours, ot_hours')
      .gte('work_date', first).lte('work_date', last)
      .then(({ data: rows, error }) => {
        if (stale) return
        if (error) return setError(error.message)
        const nextData: Record<string, TsCell> = {}
        const nextSaved: Record<string, TsSaved> = {}
        for (const r of (rows as TsRow[]) ?? []) {
          const key = `${r.employee_id}:${r.work_date}`
          nextData[key] = { hours: String(r.hours), ot_hours: String(r.ot_hours) }
          nextSaved[key] = { hours: Number(r.hours), ot_hours: Number(r.ot_hours) }
        }
        setData(() => nextData); setSaved(() => nextSaved); setFailed(new Set()); setError('')
      })
    return () => { stale = true }
  }, [month])

  // Someone who left this month is still shown, so their last days can be entered.
  const shown = employees.filter(e => e.active || (e.leave_date && e.leave_date >= `${month}-01`))
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => i + 1)
  const dateFor = (d: number) => `${month}-${String(d).padStart(2, '0')}`
  const cellOf = (id: number, date: string): TsCell => data[`${id}:${date}`] ?? { hours: '', ot_hours: '' }
  const savedOf = (id: number, date: string): TsSaved => saved[`${id}:${date}`] ?? { hours: 0, ot_hours: 0 }

  function setCell(id: number, date: string, patch: Partial<TsCell>) {
    const key = `${id}:${date}`
    setData(d => ({ ...d, [key]: { ...(d[key] ?? { hours: '', ot_hours: '' }), ...patch } }))
  }

  function save(id: number, date: string) {
    const key = `${id}:${date}`
    // Capture what to write right now, at blur time — not later, when this
    // write's turn in the chain actually arrives. A queued write must land on
    // whichever row it was meant for with the values intended for it, even if
    // the month (or anything else in `data`) has since moved on.
    const c = dataRef.current[key] ?? { hours: '', ot_hours: '' }
    const hours = round2(Number(c.hours) || 0)
    const ot_hours = round2(Number(c.ot_hours) || 0)

    // Nothing to do: the cell has no value and never had a saved one either.
    // Don't create a zero row just because a blur passed through it.
    if (hours === 0 && ot_hours === 0 && !(key in savedRef.current)) {
      setFailed(prev => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next })
      return
    }

    // Reflect the normalised value right away — this is independent of the
    // queue below, so it's correct even if the write itself has to wait.
    setData(d => ({ ...d, [key]: { hours: String(hours), ot_hours: String(ot_hours) } }))

    const chained = (inFlight.current[key] ?? Promise.resolve())
      .catch(() => {}) // a previous failure on this cell must not block later saves to it
      .then(async () => {
        // Both cleared: remove the day outright, so it counts as absent.
        const empty = hours === 0 && ot_hours === 0
        const { error } = empty
          ? await supabase.from('timesheets').delete().eq('employee_id', id).eq('work_date', date)
          : await supabase.from('timesheets')
            .upsert({ employee_id: id, work_date: date, hours, ot_hours }, { onConflict: 'employee_id,work_date' })
        setFailed(prev => { const next = new Set(prev); if (error) next.add(key); else next.delete(key); return next })
        if (error) setError(`Could not save that cell — ${error.message}. Check your connection; the last change you typed there was not saved.`)
        else if (empty) {
          setSaved(s => { const next = { ...s }; delete next[key]; return next })
          setData(d => { const next = { ...d }; delete next[key]; return next })
        }
        else setSaved(s => ({ ...s, [key]: { hours, ot_hours } }))
      })
    inFlight.current[key] = chained
    // Once this link settles with nothing newer queued behind it, drop the
    // entry rather than let the map grow forever.
    chained.finally(() => { if (inFlight.current[key] === chained) delete inFlight.current[key] })
  }

  async function clearMonth(e: Employee) {
    if (!await confirmDialog({ title: `Delete all attendance for ${e.name}?`, body: `${monthLabelOf(month)} · every day cleared.`, confirmLabel: 'Clear month', danger: true })) return
    const { error } = await supabase.from('timesheets').delete().eq('employee_id', e.id)
      .gte('work_date', `${month}-01`).lte('work_date', dateFor(days.length))
    if (error) return setError(error.message)
    const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith(`${e.id}:${month}-`)))
    setData(d => drop(d) as Record<string, TsCell>); setSaved(s => drop(s) as Record<string, TsSaved>)
  }

  // Fill every empty day the person was employed with a normal day (Rates),
  // in one write. Days already filled are left alone; days off are then
  // cleared by hand.
  async function fillMonth(e: Employee) {
    const rows = days.map(dateFor)
      .filter(date => (!e.join_date || date >= e.join_date) && (!e.leave_date || date <= e.leave_date))
      .filter(date => !(`${e.id}:${date}` in savedRef.current))
      .map(work_date => ({ employee_id: e.id, work_date, hours: dayHours, ot_hours: 0 }))
    if (rows.length === 0) return
    const { error } = await supabase.from('timesheets').upsert(rows, { onConflict: 'employee_id,work_date' })
    if (error) return setError(error.message)
    setError('')
    const cells = Object.fromEntries(rows.map(r => [`${e.id}:${r.work_date}`, { hours: String(dayHours), ot_hours: '0' }]))
    const sums = Object.fromEntries(rows.map(r => [`${e.id}:${r.work_date}`, { hours: dayHours, ot_hours: 0 }]))
    setData(d => ({ ...d, ...cells })); setSaved(s => ({ ...s, ...sums }))
    toast(`Filled ${rows.length} day${rows.length === 1 ? '' : 's'} with ${dayHours}h`)
  }

  // Totals are built from what has saved, i.e. what create_payroll_run will read.
  const summary = (id: number) => days.reduce((s, d) => {
    const c = savedOf(id, dateFor(d))
    return { hours: s.hours + c.hours, ot: s.ot + c.ot_hours, present: s.present + (c.hours > 0 ? 1 : 0) }
  }, { hours: 0, ot: 0, present: 0 })
  const staff = shown.find(e => e.id === staffId) ?? shown[0]
  const weekday = (date: string) => new Date(date + 'T00:00:00Z').toLocaleDateString('en-MY', { weekday: 'short', timeZone: 'UTC' })
  const total = staff ? summary(staff.id) : null
  const unsaved = staff ? days.some(d => {
    const date = dateFor(d), c = cellOf(staff.id, date), sv = savedOf(staff.id, date)
    return !closeEnough(Number(c.hours) || 0, sv.hours) || !closeEnough(Number(c.ot_hours) || 0, sv.ot_hours)
  }) : false

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-4">
        <div className="w-64"><label>Staff</label>
          <select value={staff?.id ?? ''} onChange={e => setStaffId(Number(e.target.value))}>
            {shown.length === 0 && <option value="">— no staff —</option>}
            {shown.map(e => { const t = summary(e.id); return <option key={e.id} value={e.id}>{e.name}{t.present ? ` — ${t.present} days` : ''}</option> })}
          </select>
        </div>
        <div className="w-44"><label>Month</label><MonthInput value={month} onChange={setMonth} /></div>
        {canEdit && staff && <div className="flex gap-2">
          <button className="btn-light" onClick={() => fillMonth(staff)}><Plus className="size-4" />Fill empty days with {dayHours}h</button>
          <button className="btn-light" onClick={() => clearMonth(staff)}><Trash2 className="size-4" />Clear month</button>
        </div>}
      </div>
      <p className="muted">Hourly staff are paid hours × rate. Monthly staff: a day with hours counts as present; once a staff member has any day filled in for the month, each missing working day is deducted as unpaid leave. Leave someone blank all month to pay them in full. Clear both boxes to delete a day.</p>
      <p className="muted">These hours feed the payroll run when it is created. After editing a timesheet, press Re-run on a draft payroll to pick up the new hours.</p>
      {error && <p className="alert-error">{error}</p>}
      {!staff && <Empty text="No staff to show." />}
      {staff && total && (
        <div className="card max-w-xl p-0">
          <table>
            <thead><tr><th>Day</th><th>Hours</th><th>OT hours</th><th></th></tr></thead>
            <tbody>
              {days.map(d => {
                const date = dateFor(d)
                const key = `${staff.id}:${date}`
                const c = cellOf(staff.id, date)
                const employed = (!staff.join_date || date >= staff.join_date) && (!staff.leave_date || date <= staff.leave_date)
                const wd = weekday(date)
                return (
                  <tr key={d} className={failed.has(key) ? 'bg-red-50' : wd === 'Sun' ? 'bg-slate-50' : ''}>
                    <td className="whitespace-nowrap tabular-nums"><span className="inline-block w-10 text-slate-500">{wd}</span>{String(d).padStart(2, '0')}</td>
                    <td><input type="number" step="0.5" min="0" inputMode="decimal" disabled={!canEdit || !employed}
                      className="w-24" value={c.hours} placeholder="—"
                      onChange={ev => setCell(staff.id, date, { hours: ev.target.value })}
                      onBlur={() => canEdit && save(staff.id, date)} /></td>
                    <td><input type="number" step="0.5" min="0" inputMode="decimal" disabled={!canEdit || !employed}
                      className="w-24" value={c.ot_hours} placeholder="—"
                      onChange={ev => setCell(staff.id, date, { ot_hours: ev.target.value })}
                      onBlur={() => canEdit && save(staff.id, date)} /></td>
                    <td className="text-xs">
                      {!employed ? <span className="text-slate-400">not employed</span>
                        : failed.has(key) ? <span className="font-medium text-red-600">not saved</span>
                        : !(Number(c.hours) > 0) && <span className="text-amber-600">absent</span>}
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-slate-50 font-semibold">
                <td>Total</td>
                <td className="tabular-nums">{total.hours.toFixed(2)} h</td>
                <td className="tabular-nums">{total.ot.toFixed(2)} h</td>
                <td className="text-xs font-normal">{total.present} days present</td>
              </tr>
            </tbody>
          </table>
          {unsaved && <p className="px-4 py-2 text-xs text-amber-600">Some typed hours are not saved yet — a change is on its way, or failed (red row).</p>}
        </div>
      )}
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
  const [paidDate, setPaidDate] = useState(todayMY())
  const [paidFrom, setPaidFrom] = useState('1100')  // '' = already paid by a Payment Voucher, no entry
  const accounts = useAccounts()
  const [focus, setFocus] = useState<{ id: number } | null>(null)  // new object each click, so the same person re-opens
  // Employee -> total currently outstanding across all their advances (not
  // this run's recovery alone). Used to note when a recovery was capped.
  const [advanceMap, setAdvanceMap] = useState<Record<number, number>>({})
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
  const loadAdvances = () => {
    supabase.from('advance_balances').select('employee_id, outstanding').gt('outstanding', 0)
      .then(({ data }) => {
        const m: Record<number, number> = {}
        for (const r of (data as { employee_id: number; outstanding: number }[]) ?? []) m[r.employee_id] = (m[r.employee_id] ?? 0) + Number(r.outstanding)
        setAdvanceMap(m)
      })
  }
  useEffect(loadRuns, [])
  useEffect(loadSlips, [runId])
  useEffect(loadAdvances, [runId])
  useEscape(() => { if (editing) { setEditing(null); setError('') } })

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
    const ok =
      fn === 'cancel_payroll_run' ? await confirmDialog({ title: 'Cancel this approved payroll?', body: 'The salary entry will be removed.', confirmLabel: 'Cancel approval', danger: true }) :
      fn === 'approve_payroll_run' ? await confirmDialog({ title: `Approve ${run ? monthName(run.month) : ''} payroll?`, body: `${slips.length} staff, net ${rm(total('net_pay'))}. It will be posted to the books (not paid yet) and the payslips locked.`, confirmLabel: 'Approve & post' }) :
      fn === 'delete_payroll_run' ? await confirmDialog({ title: 'Delete this draft payroll?', confirmLabel: 'Delete', danger: true }) :
      fn === 'rerun_payroll_run' ? await confirmDialog({ title: 'Build this draft again?', body: 'From the latest timesheet, staff and rates. Changes typed on the payslips will be lost.', confirmLabel: 'Re-run' }) :
      true
    if (!ok) return
    const { data, error } = await supabase.rpc(fn, { p_id: runId })
    if (error) return setError(error.message)
    if (fn === 'delete_payroll_run') setRunId(null)
    if (fn === 'rerun_payroll_run') setRunId(data)
    setError(''); loadRuns(); loadSlips(); loadAdvances()
    toast(fn === 'approve_payroll_run' ? 'Payroll approved and posted' : fn === 'cancel_payroll_run' ? 'Approval cancelled' : fn === 'delete_payroll_run' ? 'Draft deleted' : 'Draft rebuilt')
  }

  async function markPaid(date: string | null) {
    if (!runId) return
    const from = paidFrom ? accounts.find(a => a.code === paidFrom)?.name ?? paidFrom : ''
    const ok = date
      ? await confirmDialog({ title: from ? `Pay ${rm(total('net_pay'))} net salaries?` : `Mark ${rm(total('net_pay'))} net salaries as paid?`, body: from ? `From ${from} on ${dmy(date)}. This posts Dr 2300 Salaries Payable / Cr ${from}.` : `Mark as paid on ${dmy(date)} without a payment entry. Only do this if a Payment Voucher from 2300 already recorded it.`, confirmLabel: 'Mark as paid' })
      : await confirmDialog({ title: 'Take off the paid mark?', body: run?.paid_journal_id ? 'The salary payment entry will be removed and the amount goes back to 2300 Salaries Payable.' : undefined, confirmLabel: 'Undo paid', danger: true })
    if (!ok) return
    const { error } = await supabase.rpc('mark_payroll_paid', { p_id: runId, p_date: date, p_from: date ? paidFrom || null : null })
    if (error) return setError(error.message)
    setError(''); loadRuns(); loadSlips()
    toast(date ? `Marked paid on ${dmy(date)}` : 'Paid mark removed')
  }

  const total = (k: keyof Payslip) => slips.reduce((s, p) => s + n(p[k] as number), 0)
  const csv = () => downloadExcel(`payroll-${run?.month}.xlsx`, [
    ['Staff', 'Bank', 'Account', 'Basic', 'OT', 'Allowance', 'Service charge', 'Gross', 'EPF (staff)', 'SOCSO (staff)', 'EIS (staff)', 'PCB', 'Other', 'Advance recovery', 'Net pay', 'EPF (employer)', 'SOCSO (employer)', 'EIS (employer)'],
    ...slips.map(p => [p.name, p.bank_name ?? '', p.bank_account ?? '', n(p.basic), n(p.ot_amount), n(p.allowance), n(p.service_charge), n(p.gross),
      n(p.epf_employee), n(p.socso_employee), n(p.eis_employee), n(p.pcb), n(p.other_deduction), n(p.advance_recovery), n(p.net_pay), n(p.epf_employer), n(p.socso_employer), n(p.eis_employer)]),
    ['Total', '', '', '', '', '', '', round2(total('gross')), round2(total('epf_employee')), round2(total('socso_employee')),
      round2(total('eis_employee')), round2(total('pcb')), round2(total('other_deduction')), round2(total('advance_recovery')), round2(total('net_pay')),
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
        <div><label>Salary advance recovered (RM)</label>
          <input type="number" step="0.01" value={n(editing.advance_recovery).toFixed(2)} disabled /></div>
      </div>
      <p className="muted">Hours only matter for staff paid by the hour: pay becomes hours × rate ({rm(editing.hourly_rate)}/hour). Salary advance recovered is set automatically from the Staff Advance screen — to change it, adjust the advance, not the payslip.</p>
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
      <div className="print-page print-landscape space-y-4">
      <div className="no-print card flex flex-wrap items-end gap-3">
        <div className="w-56"><label>Payroll month</label>
          <select value={runId ?? ''} onChange={e => setRunId(Number(e.target.value))}>
            {runs.length === 0 && <option value="">— none yet —</option>}
            {runs.map(r => <option key={r.id} value={r.id}>{monthName(r.month)} ({runLabel(r)})</option>)}
          </select>
        </div>
        {run && <span className={`mb-2 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${runTone(run)}`}>{runLabel(run)}</span>}
        {canEdit && <PageActions>
          <div className="flex items-end gap-2">
            <label className="mb-0 flex items-center gap-2 whitespace-nowrap">New month<span className="w-40"><MonthInput value={newMonth} onChange={setNewMonth} /></span></label>
            <button className="btn-light" onClick={create} disabled={busyRun}><Plus className="size-4" />Create month</button>
          </div>
        </PageActions>}
        <div className="ml-auto flex gap-2">
          {run?.status === 'draft' && canEdit && <button className="btn-light" onClick={() => act('rerun_payroll_run')}><RefreshCw className="size-4" />Re-run</button>}
          {run?.status === 'draft' && role === 'owner' && <button className="btn" onClick={() => act('approve_payroll_run')}><CheckCircle2 className="size-4" />Approve &amp; post</button>}
          {run?.status === 'approved' && !run.paid_on && role === 'owner' && <button className="btn-light" onClick={() => act('cancel_payroll_run')}><XCircle className="size-4" />Cancel approval</button>}
          {run?.status === 'draft' && role === 'owner' && slips.length === 0 && <button className="btn-light" onClick={() => act('delete_payroll_run')}><Trash2 className="size-4" /></button>}
        </div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      {!run && <Empty text="No payroll month yet. Pick a month and press Create month." />}

      {run && (
        <>
          <ReportBar title={`Payroll ${monthName(run.month)}`} period={run.paid_on ? `Paid on ${dmy(run.paid_on)}` : `Pay date ${dmy(run.pay_date)} · ${runLabel(run)}`} onCsv={csv} />
          {run.status === 'draft' && <p className="rounded-lg bg-slate-100 px-3 py-2 text-[13px] text-slate-700">Draft — not approved and not paid. Check the figures, then the owner approves.</p>}
          {run.status === 'approved' && !run.paid_on && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              <p className="min-w-64 flex-1">Approved — <b>salaries not paid yet</b>. The net pay of {rm(total('net_pay'))} is held in 2300 Salaries Payable (accrued) until you pay it.</p>
              {canEdit && <div className="no-print flex flex-wrap items-end gap-2">
                <div className="w-40"><label>Paid on</label><input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} /></div>
                <div className="w-56"><label>Paid from</label>
                  <select value={paidFrom} onChange={e => setPaidFrom(e.target.value)}>
                    {MONEY_ACCOUNTS.map(c => <option key={c} value={c}>{MONEY_NAMES[c]}</option>)}
                    {accounts.filter(a => isDirector(a.code)).map(a => <option key={a.code} value={a.code}>{a.name} (director paid)</option>)}
                    <option value="">Already paid by Payment Voucher</option>
                  </select>
                </div>
                <button className="btn" disabled={!paidDate} onClick={() => markPaid(paidDate)}><CheckCircle2 className="size-4" />Mark as paid</button>
              </div>}
            </div>
          )}
          {run.paid_on && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
              <p className="flex-1">Paid on {dmy(run.paid_on)}{run.paid_journal_id ? ' — payment posted, 2300 Salaries Payable cleared' : ' (recorded by Payment Voucher)'}.</p>
              {canEdit && <button className="no-print btn-light" onClick={() => markPaid(null)}>Undo paid</button>}
            </div>
          )}
          <div className="card overflow-x-auto p-0">
            <table>
              <thead><tr>
                <th className="sticky left-0 z-10">Staff</th><th className="text-right">Basic</th><th className="text-right">OT</th><th className="text-right">Allowance</th>
                <th className="text-right">Gross</th><th className="text-right">EPF</th><th className="text-right">SOCSO</th><th className="text-right">EIS</th>
                <th className="text-right">PCB</th><th className="text-right">Other</th><th className="text-right">Recovery</th><th className="text-right">Net pay</th><th className="no-print"></th>
              </tr></thead>
              <tbody>
                {slips.map(p => (
                  <tr key={p.id}>
                    <td className="sticky left-0 z-10 bg-white"><button className="whitespace-nowrap text-left font-medium hover:text-brand hover:underline" title="View payslip" onClick={() => setFocus({ id: p.employee_id })}>{p.name}</button><div className="text-xs text-slate-500">{[!p.is_local && 'Foreign', p.bank_name && `${p.bank_name} ${p.bank_account ?? ''}`].filter(Boolean).join(' · ')}</div></td>
                    <td className="text-right">{rm(p.basic)}</td>
                    <td className="text-right">{rm(p.ot_amount)}</td>
                    <td className="text-right">{rm(n(p.allowance) + n(p.service_charge))}</td>
                    <td className="text-right font-medium">{rm(p.gross)}</td>
                    <td className="text-right">{rm(p.epf_employee)}</td>
                    <td className="text-right">{rm(p.socso_employee)}</td>
                    <td className="text-right">{rm(p.eis_employee)}</td>
                    <td className="text-right">{rm(p.pcb)}</td>
                    <td className="text-right">{rm(p.other_deduction)}</td>
                    <td className="text-right">{rm(p.advance_recovery)}</td>
                    <td className="text-right font-semibold">{rm(p.net_pay)}</td>
                    <td className="no-print whitespace-nowrap text-right">
                      <button title="View payslip" className="btn-ghost px-1.5" onClick={() => setFocus({ id: p.employee_id })}><FileText className="size-4" /></button>
                      {canEdit && run.status === 'draft' &&
                        <button title="Edit" className="btn-ghost px-1.5" onClick={() => setEditing(p)}><Pencil className="size-4" /></button>}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="sticky left-0 z-10 bg-slate-50">Total ({slips.length})</td>
                  <td className="text-right">{rm(total('basic'))}</td>
                  <td className="text-right">{rm(total('ot_amount'))}</td>
                  <td className="text-right">{rm(total('allowance') + total('service_charge'))}</td>
                  <td className="text-right">{rm(total('gross'))}</td>
                  <td className="text-right">{rm(total('epf_employee'))}</td>
                  <td className="text-right">{rm(total('socso_employee'))}</td>
                  <td className="text-right">{rm(total('eis_employee'))}</td>
                  <td className="text-right">{rm(total('pcb'))}</td>
                  <td className="text-right">{rm(total('other_deduction'))}</td>
                  <td className="text-right">{rm(total('advance_recovery'))}</td>
                  <td className="text-right">{rm(total('net_pay'))}</td>
                  <td className="no-print"></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            {[[run.paid_on ? 'Net paid to staff' : 'Net to pay staff', total('net_pay')], ['EPF to KWSP', total('epf_employee') + total('epf_employer')],
              ['SOCSO + EIS to PERKESO', total('socso_employee') + total('socso_employer') + total('eis_employee') + total('eis_employer')],
              ['PCB to LHDN', total('pcb')]].map(([label, v]) => (
              <div key={label as string} className="card p-4"><div className="muted">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{rm(v as number)}</div></div>
            ))}
          </div>
        </>
      )}
      </div>
      {run && <Payslips key={run.id} slips={slips} advanceMap={advanceMap} focus={focus} />}
    </div>
  )
}

// Printable payslips, one per staff member. `advanceMap` (office view only) is
// each employee's current total outstanding advance, used to note when this
// run's recovery was capped and the rest carries to next month.
function Payslips({ slips: all, advanceMap, focus }: { slips: Payslip[]; advanceMap?: Record<number, number>; focus?: { id: number } | null }) {
  const [show, setShow] = useState(false)
  const [who, setWho] = useState('')  // employee id, '' = everyone
  const box = useRef<HTMLDivElement>(null)
  // Opened from a row in the summary: show that person's payslip and scroll to it.
  useEffect(() => {
    if (!focus) return
    setWho(String(focus.id)); setShow(true)
    setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [focus])
  const company = useCompany()
  const staff = [...new Map(all.map(p => [p.employee_id, p.name])).entries()]
  const slips = who ? all.filter(p => String(p.employee_id) === who) : all
  const paidText = (p: Payslip) => p.status === 'draft' ? 'Draft — not approved, not paid'
    : p.paid_on ? `Paid on ${dmy(p.paid_on)}` : `Not paid yet (pay date ${dmy(p.pay_date)})`
  // Print only the payslips, not the summary above them.
  function print() { setShow(true); printDocument() }
  const csv = () => downloadExcel(`payslips${slips.length === 1 ? '-' + slips[0].name : ''}-${slips[0]?.month.slice(0, 7)}.xlsx`, [
    ['Month', 'Staff', 'Staff no.', 'IC / passport', 'Position', 'Bank', 'Account', 'Basic', 'OT hours', 'OT', 'Allowance', 'Service charge', 'Unpaid leave',
      'Gross', 'EPF (staff)', 'SOCSO (staff)', 'EIS (staff)', 'PCB', 'Advance recovery', 'Other', 'Net pay', 'EPF (employer)', 'SOCSO (employer)', 'EIS (employer)', 'Status'],
    ...slips.map(p => [p.month.slice(0, 7), p.name, p.employee_no ?? '', p.id_no ?? '', p.position ?? '', p.bank_name ?? '', p.bank_account ?? '',
      n(p.basic), n(p.ot_hours), n(p.ot_amount), n(p.allowance), n(p.service_charge), n(p.unpaid_leave), n(p.gross),
      n(p.epf_employee), n(p.socso_employee), n(p.eis_employee), n(p.pcb), n(p.advance_recovery), n(p.other_deduction), n(p.net_pay),
      n(p.epf_employer), n(p.socso_employer), n(p.eis_employer), paidText(p)]),
  ])
  // Still owed after this run: for an approved run, advance_recoveries were
  // already recorded, so `outstanding` already reflects it. For a draft run,
  // recovery hasn't been recorded yet, so subtract this payslip's own share.
  const stillOwed = (p: Payslip) => {
    if (!advanceMap) return 0
    const total = advanceMap[p.employee_id] ?? 0
    return p.status === 'approved' ? total : Math.max(round2(total - n(p.advance_recovery)), 0)
  }
  if (all.length === 0) return null
  return (
    <div ref={box} className="print-doc scroll-mt-4">
      <div className="no-print card flex flex-wrap items-end gap-3">
        {staff.length > 1 && <div className="w-56"><label>Payslip for</label>
          <select value={who} onChange={e => { setWho(e.target.value); if (e.target.value) setShow(true) }}>
            <option value="">All staff ({staff.length})</option>
            {staff.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>}
        <button className="btn-light" onClick={() => setShow(s => !s)}>{show ? 'Hide payslips' : 'Show payslips'}</button>
        <button className="btn-light" onClick={print}><Printer className="size-4" />Print / PDF {slips.length === 1 ? 'payslip' : `${slips.length} payslips`}</button>
        <button className="btn-light" onClick={csv}><Download className="size-4" />Excel</button>
      </div>
      {show && (
        <div className="mt-4 space-y-4">
          {slips.map((p, i) => (
            <div key={p.id} className={`card break-inside-avoid ${i % 2 ? 'print:break-after-page' : i < slips.length - 1 ? 'cut-line' : ''}`}>
              <div className="flex items-start justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-3">
                  <img src="/logo.png" alt="" className="size-10 rounded-lg object-contain" />
                  <div>
                    <div className="font-bold">{company.name}</div>
                    <div className="muted">Payslip · {monthName(p.month)}</div>
                  </div>
                </div>
                <div className="text-right text-[13px]">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-slate-500">{p.position} {p.employee_no && `· ${p.employee_no}`}</div>
                  <div className="text-slate-500">{p.id_no}</div>
                </div>
              </div>
              <div className="grid gap-6 pt-4 sm:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Earnings</h4>
                  <dl className="space-y-1.5 text-[13px]">
                    {[['Basic pay', p.basic], ['Overtime', p.ot_amount], ['Allowance', p.allowance], ['Service charge', p.service_charge], ['Unpaid leave', -n(p.unpaid_leave)]]
                      .filter(([, v]) => n(v as number) !== 0)
                      .map(([label, v]) => <div key={label as string} className="flex justify-between"><dt className="text-slate-600">{label}</dt><dd className="tabular-nums">{rm(v as number)}</dd></div>)}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><dt>Gross pay</dt><dd className="tabular-nums">{rm(p.gross)}</dd></div>
                  </dl>
                </div>
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Deductions</h4>
                  <dl className="space-y-1.5 text-[13px]">
                    {[['EPF', p.epf_employee], ['SOCSO', p.socso_employee], ['EIS', p.eis_employee], ['PCB (income tax)', p.pcb], ['Salary advance recovered', p.advance_recovery], ['Other', p.other_deduction]]
                      .filter(([, v]) => n(v as number) !== 0)
                      .map(([label, v]) => <div key={label as string} className="flex justify-between"><dt className="text-slate-600">{label}</dt><dd className="tabular-nums">{rm(v as number)}</dd></div>)}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><dt>Total deductions</dt>
                      <dd className="tabular-nums">{rm(n(p.gross) - n(p.net_pay))}</dd></div>
                  </dl>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3">
                <span className="font-semibold text-slate-900">Net pay</span>
                <span className="text-lg font-bold text-slate-900 tabular-nums">{rm(p.net_pay)}</span>
              </div>
              {p.note && <p className="mt-3 text-xs text-slate-500"><span className="font-medium">Attendance:</span> {p.note.replace('Pro-rated', 'Employed')}</p>}
              {stillOwed(p) > 0 &&
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Still owes {rm(stillOwed(p))} on a salary advance — it will come off next month's pay.
                </p>}
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                <span><span className={p.paid_on ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>{paidText(p)}</span>
                  {' · '}{p.bank_name ? `By bank: ${p.bank_name} ${p.bank_account ?? ''}` : 'By cash (no bank account on file)'}</span>
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
  const [advance, setAdvance] = useState(0)
  useEffect(() => {
    // Office roles can read every payslip; this page is only ever your own.
    supabase.from('payslip_view').select('*').eq('status', 'approved').eq('profile_id', profile.id).order('month', { ascending: false })
      .then(({ data }) => setSlips((data as Payslip[]) ?? []))
    // Office roles can read everyone's advances too, so filter to this login's
    // staff record; several outstanding advances are summed into one figure.
    supabase.from('employees').select('id').eq('profile_id', profile.id).then(({ data: me }) =>
      supabase.from('advance_balances').select('outstanding').gt('outstanding', 0).in('employee_id', (me ?? []).map(e => e.id))
        .then(({ data }) => setAdvance((data as { outstanding: number }[] ?? []).reduce((s, r) => s + Number(r.outstanding), 0))))
  }, [profile.id])
  return (
    <div className="space-y-4">
      {advance > 0 &&
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">You still owe {rm(advance)} on a salary advance — it comes off your pay automatically.</p>}
      {slips.length === 0 ? <Empty text="No payslips yet." /> : <Payslips slips={slips} />}
    </div>
  )
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

  const byStaff = new Map<number, Payslip[]>()
  for (const p of slips) byStaff.set(p.employee_id, [...(byStaff.get(p.employee_id) ?? []), p])
  const rows = [...byStaff.values()].map(list => ({
    name: list[0].name, id_no: list[0].id_no, tax_no: list[0].tax_no, epf_no: list[0].epf_no,
    months: list.length,
    gross: list.reduce((s, p) => s + n(p.gross), 0),
    epf: list.reduce((s, p) => s + n(p.epf_employee), 0),
    socso: list.reduce((s, p) => s + n(p.socso_employee), 0),
    pcb: list.reduce((s, p) => s + n(p.pcb), 0),
    net: list.reduce((s, p) => s + n(p.net_pay), 0),
  })).sort((a, b) => a.name.localeCompare(b.name))

  const csv = () => downloadExcel(`payroll-year-${year}.xlsx`, [
    ['Staff', 'IC / passport', 'Tax no.', 'EPF no.', 'Months paid', 'Gross pay', 'EPF (staff)', 'SOCSO (staff)', 'PCB', 'Net paid'],
    ...rows.map(r => [r.name, r.id_no ?? '', r.tax_no ?? '', r.epf_no ?? '', r.months, round2(r.gross), round2(r.epf), round2(r.socso), round2(r.pcb), round2(r.net)]),
  ])

  return (
    <div className="space-y-4 print-landscape">
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
  ['working_days', 'Working days per month (unpaid leave per day = salary ÷ this)'],
  ['hours_per_day', 'Normal hours per day (monthly staff OT rate = salary ÷ days ÷ this)'],
]

export function PayrollSettings({ role }: { role: Role }) {
  const [rates, setRates] = useState<Record<string, number> | null>(null)
  const canEdit = role === 'owner' || role === 'accountant'
  useEffect(() => { supabase.from('payroll_rates').select('*').single().then(({ data }) => setRates(data)) }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const form = Object.fromEntries([...new FormData(e.target as HTMLFormElement).entries()].map(([k, v]) => [k, Number(v) || 0]))
    const { error } = await supabase.from('payroll_rates').update(form).eq('id', 1)
    if (error) toast(error.message, { kind: 'error' })
    else toast('Rates saved')
  }

  if (!rates) return <Empty text="Loading…" />
  return (
    <form onSubmit={save} className="card max-w-3xl space-y-5 p-6">
      <p className="muted">These rates are used for new payslips. Check them against KWSP, PERKESO and LHDN whenever the rules change.</p>
      <div className="grid items-end gap-4 sm:grid-cols-3">
        {RATE_FIELDS.map(([k, label]) => (
          <div key={k}><label>{label}</label>
            <input name={k} type="number" step="0.01" min="0" defaultValue={rates[k]} disabled={!canEdit} /></div>
        ))}
      </div>
      <p className="muted">PCB (monthly income tax) is typed in per person on the payslip. Work it out with the LHDN e-PCB calculator; most staff on low wages pay nothing.</p>
      {canEdit && <div className="flex justify-end"><button className="btn">Save rates</button></div>}
    </form>
  )
}
