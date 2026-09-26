import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Paperclip, Trash2 } from 'lucide-react'
import { EDITABLE_SOURCES, MONEY_ACCOUNTS, accountTotals, dmy, downloadCsv, isDirector, loadDocuments, openReceipt, postJournal, rm, round2, supabase, todayMY, updateJournal, uploadReceipt, useAccounts, type Account, type DocRow } from '../lib'
import { AccountSelect, Done, Empty, ReportBar } from '../ui'
import { DocumentList } from '../DocumentList'

const money = (a: Account) => MONEY_ACCOUNTS.includes(a.code)
// 1200 card and 1210 e-wallet hold money already taken but not yet in the bank.
const waiting = (a: Account) => a.code === '1200' || a.code === '1210'

async function docNo(id: number) {
  const { data } = await supabase.from('journals').select('doc_no').eq('id', id).single()
  return data?.doc_no as string | undefined
}

// Payment Voucher (PV): money paid straight out of cash or bank.
export function PaymentVoucher() {
  const accounts = useAccounts()
  const blank = { date: todayMY(), payee: '', what: '', amount: '', from: '1100', reference: '', note: '' }
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<DocRow | null>(null)
  const [rows, setRows] = useState<DocRow[]>([])
  const [f, setF] = useState(blank)
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  const load = () => { loadDocuments('pv').then(r => { setRows(r); setError('') }).catch(err => setError(err.message)) }
  useEffect(load, [])

  // A payment voucher is always one debit (what for) and one credit (paid from).
  function startEdit(d: DocRow) {
    const debit = d.journal_lines.find(l => Number(l.debit) > 0)
    const credit = d.journal_lines.find(l => Number(l.credit) > 0)
    if (!debit || !credit) return alert('This voucher has an unusual shape. Use Journal Entry to correct it.')
    const dash = d.description.indexOf(' – ')
    setEditing(d)
    setF({
      date: d.date, payee: dash >= 0 ? d.description.slice(0, dash) : d.description,
      what: debit.account, amount: String(Number(debit.debit)), from: credit.account,
      reference: d.reference ?? '', note: dash >= 0 ? d.description.slice(dash + 3) : '',
    })
    setPhoto(null); setError(''); setMode('form')
  }

  function startNew() {
    setEditing(null); setF(blank); setPhoto(null); setError(''); setMode('form')
  }

  async function remove(d: DocRow) {
    if (!confirm(`Delete ${d.doc_no}? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return alert(error.message)
    load()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const attachment = photo ? await uploadReceipt(photo) : undefined
      const desc = [f.payee, f.note].filter(Boolean).join(' – ') || 'Payment'
      const lines = [
        { account: f.what, debit: amount, memo: f.note },
        { account: f.from, credit: amount },
      ]
      if (editing) {
        await updateJournal(editing.id, f.date, desc, lines, { reference: f.reference, attachment })
        setDone({ msg: `${editing.doc_no} changed to ${rm(amount)}`, doc: editing.doc_no })
      } else {
        const id = await postJournal(f.date, desc, lines, { source: 'pv', attachment, reference: f.reference })
        setDone({ msg: `Payment of ${rm(amount)} saved`, doc: await docNo(id) })
      }
      setF({ ...blank, date: f.date, from: f.from }); setPhoto(null); setEditing(null)
      load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc}
    again={() => { setDone(null); setMode('list') }} />

  if (mode === 'list') return (
    <>
      {error && <p className="alert-error">{error}</p>}
      <DocumentList rows={rows} newLabel="New payment voucher"
        emptyText="No payment vouchers in the last three months."
        onNew={startNew} onEdit={startEdit} onDelete={remove} canEdit canDelete />
    </>
  )

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <button type="button" className="link" onClick={() => setMode('list')}>← Back to list</button>
      {editing
        ? <p className="muted">Changing <b className="font-mono">{editing.doc_no}</b>. It keeps the same number.</p>
        : <p className="muted">For bills bought on credit use <b>Purchase Invoice</b>; to pay those later use <b>Supplier Payment</b>.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
        <div><label>Cheque / Ref no.</label><input value={f.reference} onChange={e => set('reference', e.target.value)} placeholder="Optional" /></div>
        <div className="sm:col-span-2"><label>Pay to</label><input value={f.payee} onChange={e => set('payee', e.target.value)} placeholder="Shop, TNB, landlord…" required /></div>
        <div><label>Account (what for)</label>
          <AccountSelect accounts={accounts} value={f.what} onChange={v => set('what', v)}
            filter={a => a.type === 'expense' || a.code === '3100' || (a.type === 'asset' && a.code >= '1300')
              || ['2300', '2310', '2320', '2330', '2340', '2600'].includes(a.code) || isDirector(a.code)} />
        </div>
        <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
        <div><label>Paid from</label>
          <select value={f.from} onChange={e => set('from', e.target.value)}>
            {accounts.filter(money).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            {accounts.filter(a => isDirector(a.code)).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name} (director paid, we owe them)</option>)}
            <option value="3000">3000 · Owner capital (not to be paid back)</option>
          </select>
        </div>
        <div><label>Description</label><input value={f.note} onChange={e => set('note', e.target.value)} placeholder="Optional" /></div>
        <div className="sm:col-span-2"><label>Receipt / bill photo</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
          {editing?.attachment && !photo && <p className="muted mt-1">A photo is already attached. Choosing a new one replaces it.</p>}
        </div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save payment'}</button>
      </div>
    </form>
  )
}

// Official Receipt (OR): money received other than daily sales.
export function OfficialReceipt() {
  const accounts = useAccounts()
  const blank = { date: todayMY(), from: '', kind: '4900', amount: '', into: '1100', reference: '' }
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<DocRow | null>(null)
  const [rows, setRows] = useState<DocRow[]>([])
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  const load = () => { loadDocuments('or').then(r => { setRows(r); setError('') }).catch(err => setError(err.message)) }
  useEffect(load, [])

  // A receipt is one debit (received into) and one credit (what kind of money).
  function startEdit(d: DocRow) {
    const debit = d.journal_lines.find(l => Number(l.debit) > 0)
    const credit = d.journal_lines.find(l => Number(l.credit) > 0)
    if (!debit || !credit) return alert('This receipt has an unusual shape. Use Journal Entry to correct it.')
    setEditing(d)
    setF({ date: d.date, from: d.description, kind: credit.account,
           amount: String(Number(debit.debit)), into: debit.account, reference: d.reference ?? '' })
    setError(''); setMode('form')
  }

  async function remove(d: DocRow) {
    if (!confirm(`Delete ${d.doc_no}? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return alert(error.message)
    load()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const lines = [{ account: f.into, debit: amount }, { account: f.kind, credit: amount }]
      if (editing) {
        await updateJournal(editing.id, f.date, f.from || 'Receipt', lines, { reference: f.reference })
        setDone({ msg: `${editing.doc_no} changed to ${rm(amount)}`, doc: editing.doc_no })
      } else {
        const id = await postJournal(f.date, f.from || 'Receipt', lines, { source: 'or', reference: f.reference })
        setDone({ msg: `Receipt of ${rm(amount)} saved`, doc: await docNo(id) })
      }
      setF({ ...blank, date: f.date }); setEditing(null); load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc} again={() => { setDone(null); setMode('list') }} />

  if (mode === 'list') return (
    <>
      {error && <p className="alert-error">{error}</p>}
      <DocumentList rows={rows} newLabel="New official receipt"
        emptyText="No official receipts in the last three months."
        onNew={() => { setEditing(null); setF(blank); setError(''); setMode('form') }}
        onEdit={startEdit} onDelete={remove} canEdit canDelete />
    </>
  )

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <button type="button" className="link" onClick={() => setMode('list')}>← Back to list</button>
      {editing
        ? <p className="muted">Changing <b className="font-mono">{editing.doc_no}</b>. It keeps the same number.</p>
        : <p className="muted">Daily sales come from Upload Sales. Use this for other money received: event deposits, owner capital, refunds.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
        <div><label>Ref no.</label><input value={f.reference} onChange={e => set('reference', e.target.value)} placeholder="Optional" /></div>
        <div className="sm:col-span-2"><label>Received from</label><input value={f.from} onChange={e => set('from', e.target.value)} required /></div>
        <div><label>Account</label>
          <AccountSelect accounts={accounts} value={f.kind} onChange={v => set('kind', v)}
            filter={a => a.type === 'income' || a.code === '3000' || a.code === '1300' || isDirector(a.code)} />
        </div>
        <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
        <div><label>Received into</label><AccountSelect accounts={accounts} value={f.into} onChange={v => set('into', v)} filter={money} /></div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save receipt'}</button>
      </div>
    </form>
  )
}

export function Transfer() {
  const accounts = useAccounts()
  const blank = { date: todayMY(), from: '1000', to: '1100', amount: '', reference: '' }
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<DocRow | null>(null)
  const [rows, setRows] = useState<DocRow[]>([])
  const [f, setF] = useState(blank)
  const [balances, setBalances] = useState<Map<string, number>>(new Map())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  const load = () => { loadDocuments('transfer').then(r => { setRows(r); setError('') }).catch(err => setError(err.message)) }
  useEffect(load, [])
  useEffect(() => { accountTotals(null, todayMY()).then(setBalances) }, [done, mode])

  function startEdit(d: DocRow) {
    const debit = d.journal_lines.find(l => Number(l.debit) > 0)
    const credit = d.journal_lines.find(l => Number(l.credit) > 0)
    if (!debit || !credit) return alert('This transfer has an unusual shape. Use Journal Entry to correct it.')
    setEditing(d)
    setF({ date: d.date, from: credit.account, to: debit.account,
           amount: String(Number(debit.debit)), reference: d.reference ?? '' })
    setError(''); setMode('form')
  }

  async function remove(d: DocRow) {
    if (!confirm(`Delete ${d.doc_no}? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return alert(error.message)
    load()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (f.from === f.to) return setError('From and To must be different')
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const name = (c: string) => accounts.find(a => a.code === c)?.name
      const desc = `Transfer ${name(f.from)} to ${name(f.to)}`
      const lines = [{ account: f.to, debit: amount }, { account: f.from, credit: amount }]
      if (editing) {
        await updateJournal(editing.id, f.date, desc, lines, { reference: f.reference })
        setDone({ msg: `${editing.doc_no} changed to ${rm(amount)}`, doc: editing.doc_no })
      } else {
        const id = await postJournal(f.date, desc, lines, { source: 'transfer', reference: f.reference })
        setDone({ msg: `Moved ${rm(amount)}`, doc: await docNo(id) })
      }
      setF({ ...f, amount: '', reference: '' }); setEditing(null); load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc} again={() => { setDone(null); setMode('list') }} />

  if (mode === 'list') return (
    <>
      {error && <p className="alert-error">{error}</p>}
      <DocumentList rows={rows} newLabel="New transfer"
        emptyText="No transfers in the last three months."
        onNew={() => { setEditing(null); setF(blank); setError(''); setMode('form') }}
        onEdit={startEdit} onDelete={remove} canEdit canDelete />
    </>
  )

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <button type="button" className="link" onClick={() => setMode('list')}>← Back to list</button>
      {editing
        ? <p className="muted">Changing <b className="font-mono">{editing.doc_no}</b>. It keeps the same number.</p>
        : <p className="muted">Also use this when e-wallet money (TNG and the like) reaches the bank: From <b>1210 E-Wallet</b>, To <b>Bank</b>. E-wallets have no fee, so the full amount moves across. Card money is handled on the Card Settlement screen, because Fiuu takes a fee.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
        <div><label>Ref no. (bank-in slip)</label><input value={f.reference} onChange={e => set('reference', e.target.value)} placeholder="Optional" /></div>
        <div><label>From</label><AccountSelect accounts={accounts} value={f.from} onChange={v => set('from', v)} filter={a => money(a) || waiting(a)} />
          <p className="muted mt-1">Sitting there now: {rm(balances.get(f.from) ?? 0)}
            {waiting({ code: f.from } as Account) && <button type="button" className="link ml-2"
              onClick={() => set('amount', String(round2(balances.get(f.from) ?? 0)))}>Move it all</button>}
          </p>
        </div>
        <div><label>To</label><AccountSelect accounts={accounts} value={f.to} onChange={v => set('to', v)} filter={money} /></div>
        <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save transfer'}</button>
      </div>
    </form>
  )
}

type EntryRow = {
  id: number; doc_no: string; date: string; description: string; reference: string | null; source: string; attachment: string | null
  journal_lines: { account: string; debit: number; credit: number; accounts: { name: string } }[]
}

// Where each document type is edited — a wrong entry is fixed on the screen that made it.
const OWNER_SCREEN: Record<string, string> = {
  pv: '/cash/payment', or: '/cash/receipt', transfer: '/cash/transfer', jv: '/gl/journal',
  pi: '/ap/invoices', sp: '/ap/payments', sales: '/sales/upload', fiuu: '/sales/fiuu',
  payroll: '/payroll/run', claim: '/claims', accrual: '/gl/accruals', stock: '/stock/count',
  cogs: '/sales/upload',
}

const TYPES: Record<string, string> = {
  '': 'All types', pv: 'Payment Voucher', or: 'Official Receipt', jv: 'Journal Entry', transfer: 'Bank Transfer',
  pi: 'Purchase Invoice', sp: 'Supplier Payment', claim: 'Claim', sales: 'Daily sales', cogs: 'Cost of sales',
  fiuu: 'Card settlement', payroll: 'Payroll', accrual: 'Accruals', stock: 'Stock count', manual: 'Older entries',
}

export function JournalListing({ isOwner }: { isOwner: boolean }) {
  const [month, setMonth] = useState(todayMY().slice(0, 7))
  const [type, setType] = useState('')
  const [rows, setRows] = useState<EntryRow[]>([])
  // ?doc=PV-000001 (from search or dashboard) shows just that document.
  const [params, setParams] = useSearchParams()
  const doc = params.get('doc')

  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
    let q = supabase.from('journals')
      .select('id, doc_no, date, description, reference, source, attachment, journal_lines(account, debit, credit, accounts(name))')
    if (doc) q = q.eq('doc_no', doc)
    else {
      q = q.gte('date', `${month}-01`).lt('date', end)
      if (type) q = q.eq('source', type)
    }
    q.order('date', { ascending: false }).order('id', { ascending: false })
      .then(({ data }) => setRows((data as unknown as EntryRow[]) ?? []))
  }, [month, type, doc])

  async function remove(id: number) {
    if (!confirm('Delete this document? This cannot be undone.')) return
    const { error } = await supabase.rpc('delete_journal', { p_id: id })
    if (error) return alert(error.message)
    setRows(rows.filter(r => r.id !== id))
  }

  const csv = () => downloadCsv(`journal-${month}.csv`, [
    ['Date', 'Doc No', 'Description', 'Ref', 'Account', 'Debit', 'Credit'],
    ...rows.flatMap(r => r.journal_lines.map(l => [dmy(r.date), r.doc_no, r.description, r.reference ?? '', `${l.account} ${l.accounts.name}`, l.debit || '', l.credit || ''])),
  ])

  return (
    <div className="space-y-4">
      <ReportBar title="Journal Listing" period={doc ?? month} onCsv={csv}>
        {doc && <div className="flex h-10 items-center gap-2 rounded-lg bg-brand-soft px-3 text-sm text-brand-dark">
          Showing <b className="font-mono">{doc}</b>
          <button className="link" onClick={() => setParams({})}>Show all</button>
        </div>}
        {!doc && <><div className="w-44"><label>Month</label><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>
        <div className="w-52"><label>Type</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div></>}
      </ReportBar>
      <div className="card overflow-x-auto p-0">
        {rows.length === 0 && <Empty text="No documents for this month." />}
        {rows.length > 0 && (
          <table>
            <thead><tr><th className="w-24">Date</th><th className="w-28">Doc No</th><th>Description</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="no-print"></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="align-top hover:bg-slate-50/60">
                  <td className="text-slate-500">{dmy(r.date)}</td>
                  <td className="font-mono text-xs font-medium">{r.doc_no}</td>
                  <td><div className="font-medium">{r.description}</div>{r.reference && <div className="text-xs text-slate-500">Ref: {r.reference}</div>}</td>
                  <td>{r.journal_lines.map((l, i) => <div key={i} className={l.credit ? 'pl-4 text-slate-600' : ''}>{l.account} · {l.accounts.name}</div>)}</td>
                  <td className="text-right">{r.journal_lines.map((l, i) => <div key={i}>{l.debit ? rm(l.debit) : ' '}</div>)}</td>
                  <td className="text-right">{r.journal_lines.map((l, i) => <div key={i}>{l.credit ? rm(l.credit) : ' '}</div>)}</td>
                  <td className="no-print whitespace-nowrap text-right">
                    {r.attachment && <button title="View receipt" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand" onClick={() => openReceipt(r.attachment!)}><Paperclip className="size-4" /></button>}
                    {OWNER_SCREEN[r.source] && <Link to={OWNER_SCREEN[r.source]} className="link mr-2"
                      title={EDITABLE_SOURCES.includes(r.source) ? 'Open this document' : 'Change this on the screen that made it'}>
                      {EDITABLE_SOURCES.includes(r.source) ? 'Open' : 'Fix here'}</Link>}
                    {(['manual', 'pv', 'or', 'jv', 'transfer'].includes(r.source) || (isOwner && !['pi', 'sp'].includes(r.source))) &&
                      <button title="Delete" className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" onClick={() => remove(r.id)}><Trash2 className="size-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
