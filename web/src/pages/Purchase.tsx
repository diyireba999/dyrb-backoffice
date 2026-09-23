import { useEffect, useState } from 'react'
import { Plus, Trash2, XCircle } from 'lucide-react'
import { MONEY_ACCOUNTS, MONEY_NAMES, addDays, dmy, isDirector, downloadCsv, openReceipt, rm, round2, supabase, todayMY, uploadReceipt, useAccounts, useSuppliers, type Role } from '../lib'
import { AccountSelect, Done, Empty, ReportBar } from '../ui'

type Invoice = {
  id: number; supplier_id: number; supplier: string; invoice_no: string | null; date: string; due_date: string
  total: number; paid: number; outstanding: number; doc_no: string; description: string
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
const canCancel = (role: Role) => role === 'owner' || role === 'accountant'

async function loadInvoices(filter: { supplier?: number; open?: boolean } = {}) {
  let q = supabase.from('purchase_invoice_status').select('*').order('date', { ascending: false }).order('id', { ascending: false })
  if (filter.supplier) q = q.eq('supplier_id', filter.supplier)
  if (filter.open) q = q.gt('outstanding', 0)
  const { data } = await q
  return (data as Invoice[]) ?? []
}

export function Suppliers() {
  const accounts = useAccounts()
  const { list, load } = useSuppliers()
  const blank = { name: '', phone: '', default_account: '', opening: '', opening_date: todayMY() }
  const [f, setF] = useState(blank)
  const [error, setError] = useState('')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const opening = round2(Number(f.opening || 0))
    const { data, error } = await supabase.from('suppliers')
      .insert({ name: f.name, phone: f.phone || null, default_account: f.default_account || null }).select('id').single()
    if (error) return setError(error.message.includes('duplicate') ? 'A supplier with this name already exists' : error.message)
    if (opening > 0) {
      // Amount already owed before we started: an opening purchase invoice against owner capital.
      const { error } = await supabase.rpc('create_purchase_invoice', {
        p_supplier: data.id, p_invoice_no: 'Opening balance', p_date: f.opening_date, p_due: f.opening_date,
        p_description: `Opening balance owed – ${f.name}`, p_lines: [{ account: '3000', amount: opening }],
      })
      if (error) return setError('Supplier added, but opening amount failed: ' + error.message)
    }
    setF(blank); setError(''); load()
  }

  async function remove(id: number) {
    if (!confirm('Remove this supplier?')) return
    const { error } = await supabase.from('suppliers').delete().eq('id', id)
    if (error) alert('Cannot remove: this supplier already has documents.')
    load()
  }

  const acctName = (c: string | null) => accounts.find(a => a.code === c)?.name ?? ''
  return (
    <div className="space-y-6">
      <form onSubmit={add} className="card grid items-end gap-4 md:grid-cols-3">
        <h3 className="font-semibold md:col-span-3">New supplier</h3>
        <div><label>Name</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></div>
        <div><label>Phone</label><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
        <div><label>Default account</label>
          <AccountSelect accounts={accounts} value={f.default_account} onChange={v => setF({ ...f, default_account: v })} filter={a => a.type === 'expense'} required={false} />
        </div>
        <div><label>Opening balance owed (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.opening} onChange={e => setF({ ...f, opening: e.target.value })} placeholder="Optional" /></div>
        {Number(f.opening) > 0 && <div><label>Owed as at</label><input type="date" value={f.opening_date} onChange={e => setF({ ...f, opening_date: e.target.value })} required /></div>}
        <button className="btn"><Plus className="size-4" />Add supplier</button>
        {error && <p className="alert-error md:col-span-3">{error}</p>}
      </form>
      <div className="card overflow-x-auto p-0">
        {list.length === 0 && <Empty text="No suppliers yet." />}
        {list.length > 0 && <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Default account</th><th className="text-right">Balance owed</th><th></th></tr></thead>
          <tbody>
            {list.map(s => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td><td className="text-slate-600">{s.phone}</td><td className="text-slate-600">{acctName(s.default_account)}</td>
                <td className={`text-right ${s.owed > 0 ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>{rm(s.owed)}</td>
                <td className="text-right"><button title="Remove" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(s.id)}><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </div>
  )
}

type PiLine = { account: string; memo: string; amount: string }

function NewPurchaseInvoice({ onSaved }: { onSaved: (doc: string) => void }) {
  const accounts = useAccounts()
  const { list: suppliers } = useSuppliers()
  const [head, setHead] = useState({ supplier: '', invoice_no: '', date: todayMY(), terms: '30' })
  const [lines, setLines] = useState<PiLine[]>([{ account: '', memo: '', amount: '' }])
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0))
  const setLine = (i: number, patch: Partial<PiLine>) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l))

  function pickSupplier(id: string) {
    const s = suppliers.find(s => String(s.id) === id)
    setHead({ ...head, supplier: id })
    if (s?.default_account && lines.length === 1 && !lines[0].account) setLine(0, { account: s.default_account })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const used = lines.filter(l => l.account && Number(l.amount) > 0)
    if (!used.length) return setError('Add at least one line with an amount')
    setBusy(true); setError('')
    try {
      const attachment = photo ? await uploadReceipt(photo) : null
      const s = suppliers.find(s => String(s.id) === head.supplier)!
      const { data, error } = await supabase.rpc('create_purchase_invoice', {
        p_supplier: s.id, p_invoice_no: head.invoice_no, p_date: head.date, p_due: addDays(head.date, Number(head.terms)),
        p_description: `${s.name}${head.invoice_no ? ' inv ' + head.invoice_no : ''}`,
        p_lines: used.map(l => ({ account: l.account, amount: round2(Number(l.amount)), memo: l.memo || null })),
        p_attachment: attachment,
      })
      if (error) throw new Error(error.message)
      const { data: inv } = await supabase.from('purchase_invoice_status').select('doc_no').eq('id', data).single()
      onSaved(inv?.doc_no ?? '')
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="card space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="sm:col-span-2"><label>Supplier</label>
          <select value={head.supplier} onChange={e => pickSupplier(e.target.value)} required>
            <option value="">— choose —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><label>Supplier invoice no.</label><input value={head.invoice_no} onChange={e => setHead({ ...head, invoice_no: e.target.value })} required /></div>
        <div><label>Invoice date</label><input type="date" value={head.date} onChange={e => setHead({ ...head, date: e.target.value })} required /></div>
        <div><label>Terms</label>
          <select value={head.terms} onChange={e => setHead({ ...head, terms: e.target.value })}>
            {[0, 7, 14, 30, 60].map(d => <option key={d} value={d}>{d === 0 ? 'Cash / due now' : `${d} days`}</option>)}
          </select>
        </div>
        <div><label>Due date</label><input value={dmy(addDays(head.date, Number(head.terms)))} disabled /></div>
        <div className="sm:col-span-2"><label>Invoice photo</label><input type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></div>
      </div>
      <div className="-mx-6 overflow-x-auto">
        <table>
          <thead><tr><th className="pl-6">Account</th><th>Description</th><th className="w-40 text-right">Amount (RM)</th><th className="w-10 pr-6"></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="min-w-56 pl-6"><AccountSelect accounts={accounts} value={l.account} onChange={v => setLine(i, { account: v })}
                  filter={a => a.type === 'expense' || (a.type === 'asset' && a.code >= '1300')} required={false} /></td>
                <td className="min-w-40"><input value={l.memo} onChange={e => setLine(i, { memo: e.target.value })} placeholder="Items" /></td>
                <td><input className="text-right" type="number" step="0.01" min="0" inputMode="decimal" value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} /></td>
                <td className="pr-6">{lines.length > 1 && <button type="button" title="Remove line" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td className="pl-6"><button type="button" className="link inline-flex items-center gap-1" onClick={() => setLines([...lines, { account: '', memo: '', amount: '' }])}><Plus className="size-4" />Add line</button></td>
              <td className="text-right text-slate-500">Invoice total</td>
              <td className="text-right">{rm(total)}</td><td className="pr-6"></td>
            </tr>
          </tbody>
        </table>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end"><button className="btn" disabled={busy || total <= 0}>{busy ? 'Saving…' : 'Save invoice'}</button></div>
    </form>
  )
}

export function PurchaseInvoices({ role }: { role: Role }) {
  const [mode, setMode] = useState<'list' | 'new'>('list')
  const [saved, setSaved] = useState<string | null>(null)
  const [show, setShow] = useState<'open' | 'all'>('open')
  const [rows, setRows] = useState<Invoice[]>([])
  const load = () => { loadInvoices({ open: show === 'open' }).then(setRows) }
  useEffect(load, [show])

  async function cancel(inv: Invoice) {
    if (!confirm(`Cancel ${inv.doc_no}? This removes it from the books.`)) return
    const { error } = await supabase.rpc('cancel_purchase_invoice', { p_id: inv.id })
    if (error) alert(error.message)
    load()
  }
  async function viewPhoto(inv: Invoice) {
    const { data } = await supabase.from('journals').select('attachment').eq('doc_no', inv.doc_no).single()
    if (data?.attachment) openReceipt(data.attachment); else alert('No photo attached')
  }

  if (saved !== null) return <Done msg="Purchase invoice saved" doc={saved} again={() => { setSaved(null); setMode('new') }} />
  if (mode === 'new') return (
    <div className="space-y-4">
      <button className="link" onClick={() => setMode('list')}>← Back to list</button>
      <NewPurchaseInvoice onSaved={doc => { setSaved(doc); setMode('list'); load() }} />
    </div>
  )

  const today = todayMY()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
          <button className={`tab ${show === 'open' ? 'tab-active' : ''}`} onClick={() => setShow('open')}>Unpaid</button>
          <button className={`tab ${show === 'all' ? 'tab-active' : ''}`} onClick={() => setShow('all')}>All</button>
        </div>
        <button className="btn ml-auto" onClick={() => setMode('new')}><Plus className="size-4" />New purchase invoice</button>
      </div>
      <div className="card overflow-x-auto p-0">
        {rows.length === 0 && <Empty text={show === 'open' ? 'No unpaid invoices.' : 'No purchase invoices yet.'} />}
        {rows.length > 0 && <table>
          <thead><tr><th className="w-28">Doc No</th><th className="w-24">Date</th><th>Supplier</th><th>Inv no.</th><th className="w-24">Due</th><th className="text-right">Total</th><th className="text-right">Outstanding</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => {
              const overdue = Number(r.outstanding) > 0 && r.due_date < today
              return (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.doc_no}</td>
                  <td className="text-slate-500">{dmy(r.date)}</td>
                  <td className="font-medium">{r.supplier}</td>
                  <td>{r.invoice_no}</td>
                  <td className={overdue ? 'font-medium text-rose-600' : 'text-slate-500'}>{dmy(r.due_date)}</td>
                  <td className="text-right">{rm(r.total)}</td>
                  <td className={`text-right font-semibold ${Number(r.outstanding) > 0 ? '' : 'text-emerald-600'}`}>{Number(r.outstanding) > 0 ? rm(r.outstanding) : 'Paid'}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="link mr-2" onClick={() => viewPhoto(r)}>Photo</button>
                    {canCancel(role) && Number(r.paid) === 0 && <button title="Cancel invoice" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => cancel(r)}><XCircle className="size-4" /></button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>}
      </div>
    </div>
  )
}

type Payment = { id: number; date: string; amount: number; suppliers: { name: string }; journals: { doc_no: string; reference: string | null } }

export function SupplierPayments({ role }: { role: Role }) {
  const { list: suppliers } = useSuppliers()
  const directors = useAccounts().filter(a => isDirector(a.code))
  const [supplier, setSupplier] = useState('')
  const [open, setOpen] = useState<Invoice[]>([])
  const [pay, setPay] = useState<Record<number, string>>({})
  const [head, setHead] = useState({ date: todayMY(), from: '1100', reference: '' })
  const [history, setHistory] = useState<Payment[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadHistory = () => {
    supabase.from('supplier_payments').select('id, date, amount, suppliers(name), journals(doc_no, reference)')
      .order('date', { ascending: false }).order('id', { ascending: false }).limit(50)
      .then(({ data }) => setHistory((data as unknown as Payment[]) ?? []))
  }
  useEffect(loadHistory, [])
  useEffect(() => {
    setPay({})
    if (supplier) loadInvoices({ supplier: Number(supplier), open: true }).then(r => setOpen(r.reverse()))
    else setOpen([])
  }, [supplier])

  const total = round2(Object.values(pay).reduce((s, v) => s + Number(v || 0), 0))
  const payAll = () => setPay(Object.fromEntries(open.map(i => [i.id, String(i.outstanding)])))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (total <= 0) return setError('Enter the amount to pay against at least one invoice')
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('pay_supplier', {
      p_supplier: Number(supplier), p_date: head.date, p_from: head.from, p_reference: head.reference,
      p_allocations: Object.entries(pay).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ invoice_id: Number(id), amount: round2(Number(v)) })),
    })
    setBusy(false)
    if (error) return setError(error.message)
    const { data: p } = await supabase.from('supplier_payments').select('journals(doc_no)').eq('id', data).single()
    setDone((p as unknown as { journals: { doc_no: string } })?.journals.doc_no ?? '')
    setSupplier(''); setHead({ ...head, reference: '' }); loadHistory()
  }

  async function cancel(p: Payment) {
    if (!confirm(`Cancel ${p.journals.doc_no}? The invoices become unpaid again.`)) return
    const { error } = await supabase.rpc('cancel_supplier_payment', { p_id: p.id })
    if (error) alert(error.message)
    loadHistory()
  }

  if (done !== null) return <Done msg="Supplier payment saved" doc={done} again={() => setDone(null)} />
  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2"><label>Supplier</label>
            <select value={supplier} onChange={e => setSupplier(e.target.value)} required>
              <option value="">— choose —</option>
              {suppliers.filter(s => s.owed > 0).map(s => <option key={s.id} value={s.id}>{s.name} ({rm(s.owed)})</option>)}
            </select>
          </div>
          <div><label>Payment date</label><input type="date" value={head.date} onChange={e => setHead({ ...head, date: e.target.value })} required /></div>
          <div><label>Paid from</label>
            <select value={head.from} onChange={e => setHead({ ...head, from: e.target.value })}>
              {MONEY_ACCOUNTS.map(c => <option key={c} value={c}>{c} · {MONEY_NAMES[c]}</option>)}
              {directors.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name} (director paid, we owe them)</option>)}
              <option value="3000">3000 · Owner capital (not to be paid back)</option>
            </select>
          </div>
          <div className="sm:col-span-2"><label>Cheque / transfer ref no.</label><input value={head.reference} onChange={e => setHead({ ...head, reference: e.target.value })} placeholder="Optional" /></div>
        </div>
        {supplier && (
          <div className="-mx-6 overflow-x-auto">
            <table>
              <thead><tr><th className="pl-6">Doc No</th><th>Inv no.</th><th>Date</th><th>Due</th><th className="text-right">Outstanding</th><th className="w-40 pr-6 text-right">Pay now</th></tr></thead>
              <tbody>
                {open.map(i => (
                  <tr key={i.id}>
                    <td className="pl-6 font-mono text-xs">{i.doc_no}</td><td>{i.invoice_no}</td>
                    <td className="text-slate-500">{dmy(i.date)}</td><td className="text-slate-500">{dmy(i.due_date)}</td>
                    <td className="text-right">{rm(i.outstanding)}</td>
                    <td className="pr-6"><input className="text-right" type="number" step="0.01" min="0" max={i.outstanding} inputMode="decimal"
                      value={pay[i.id] ?? ''} onChange={e => setPay({ ...pay, [i.id]: e.target.value })} /></td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="pl-6" colSpan={4}><button type="button" className="link" onClick={payAll}>Pay all in full</button></td>
                  <td className="text-right text-slate-500">Total payment</td>
                  <td className="pr-6 text-right">{rm(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="alert-error">{error}</p>}
        <div className="flex justify-end"><button className="btn" disabled={busy || total <= 0}>{busy ? 'Saving…' : 'Save payment'}</button></div>
      </form>

      <div>
        <h3 className="mb-3 font-semibold">Recent payments</h3>
        <div className="card overflow-x-auto p-0">
          {history.length === 0 && <Empty text="No supplier payments yet." />}
          {history.length > 0 && <table>
            <thead><tr><th className="w-28">Doc No</th><th className="w-24">Date</th><th>Supplier</th><th>Ref</th><th className="text-right">Amount</th><th></th></tr></thead>
            <tbody>
              {history.map(p => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.journals.doc_no}</td><td className="text-slate-500">{dmy(p.date)}</td>
                  <td className="font-medium">{p.suppliers.name}</td><td>{p.journals.reference}</td>
                  <td className="text-right">{rm(p.amount)}</td>
                  <td className="text-right">{canCancel(role) && <button title="Cancel payment" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => cancel(p)}><XCircle className="size-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>}
        </div>
      </div>
    </div>
  )
}

const BUCKETS = ['Not due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'] as const
const bucketOf = (overdueDays: number) => overdueDays <= 0 ? 0 : overdueDays <= 30 ? 1 : overdueDays <= 60 ? 2 : overdueDays <= 90 ? 3 : 4

export function ApAging() {
  const [asAt, setAsAt] = useState(todayMY())
  const [rows, setRows] = useState<Invoice[]>([])
  useEffect(() => { loadInvoices({ open: true }).then(setRows) }, [])

  // ponytail: uses today's outstanding amounts; payments dated after "as at" are not added back.
  const bySupplier = new Map<string, number[]>()
  for (const r of rows.filter(r => r.date <= asAt)) {
    const b = bySupplier.get(r.supplier) ?? [0, 0, 0, 0, 0]
    b[bucketOf(daysBetween(r.due_date, asAt))] += Number(r.outstanding)
    bySupplier.set(r.supplier, b)
  }
  const list = [...bySupplier.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const totals = BUCKETS.map((_, i) => list.reduce((s, [, b]) => s + b[i], 0))
  const grand = totals.reduce((s, v) => s + v, 0)
  const csv = () => downloadCsv(`ap-aging-${asAt}.csv`, [['Supplier', ...BUCKETS, 'Total'],
    ...list.map(([name, b]) => [name, ...b.map(round2), round2(b.reduce((s, v) => s + v, 0))]),
    ['Total', ...totals.map(round2), round2(grand)]])

  return (
    <div className="space-y-4">
      <ReportBar title="Supplier Aging (AP)" period={`As at ${dmy(asAt)}`} onCsv={csv}>
        <div className="w-44"><label>As at</label><input type="date" value={asAt} onChange={e => setAsAt(e.target.value)} /></div>
      </ReportBar>
      <div className="card overflow-x-auto p-0">
        {list.length === 0 && <Empty text="Nothing owed to suppliers." />}
        {list.length > 0 && <table>
          <thead><tr><th>Supplier</th>{BUCKETS.map(b => <th key={b} className="text-right">{b}</th>)}<th className="text-right">Total</th></tr></thead>
          <tbody>
            {list.map(([name, b]) => (
              <tr key={name}>
                <td className="font-medium">{name}</td>
                {b.map((v, i) => <td key={i} className={`text-right ${v && i >= 2 ? 'text-rose-600' : ''}`}>{v ? rm(v) : '–'}</td>)}
                <td className="text-right font-semibold">{rm(b.reduce((s, v) => s + v, 0))}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td>Total</td>{totals.map((v, i) => <td key={i} className="text-right">{rm(v)}</td>)}<td className="text-right">{rm(grand)}</td>
            </tr>
          </tbody>
        </table>}
      </div>
    </div>
  )
}
