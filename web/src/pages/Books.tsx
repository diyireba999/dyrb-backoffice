import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Paperclip, Trash2 } from 'lucide-react'
import { MONEY_ACCOUNTS, accountTotals, dmy, downloadCsv, isDirector, openReceipt, postJournal, rm, round2, supabase, todayMY, uploadReceipt, useAccounts, type Account } from '../lib'
import { AccountSelect, Done, Empty, ReportBar } from '../ui'

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
  const [f, setF] = useState(blank)
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const attachment = photo ? await uploadReceipt(photo) : undefined
      const desc = [f.payee, f.note].filter(Boolean).join(' – ') || 'Payment'
      const id = await postJournal(f.date, desc, [
        { account: f.what, debit: amount, memo: f.note },
        { account: f.from, credit: amount },
      ], { source: 'pv', attachment, reference: f.reference })
      setDone({ msg: `Payment of ${rm(amount)} saved`, doc: await docNo(id) })
      setF({ ...blank, date: f.date, from: f.from }); setPhoto(null)
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc} again={() => setDone(null)} />
  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <p className="muted">For bills bought on credit use <b>Purchase Invoice</b>; to pay those later use <b>Supplier Payment</b>.</p>
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
        <div className="sm:col-span-2"><label>Receipt / bill photo</label><input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></div>
      </div>
      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save payment'}</button></div>
    </form>
  )
}

// Official Receipt (OR): money received other than daily sales.
export function OfficialReceipt() {
  const accounts = useAccounts()
  const blank = { date: todayMY(), from: '', kind: '4900', amount: '', into: '1100', reference: '' }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const id = await postJournal(f.date, f.from || 'Receipt', [
        { account: f.into, debit: amount },
        { account: f.kind, credit: amount },
      ], { source: 'or', reference: f.reference })
      setDone({ msg: `Receipt of ${rm(amount)} saved`, doc: await docNo(id) })
      setF({ ...blank, date: f.date })
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc} again={() => setDone(null)} />
  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <p className="muted">Daily sales come from Upload Sales. Use this for other money received: event deposits, owner capital, refunds.</p>
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
      <div className="flex justify-end"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save receipt'}</button></div>
    </form>
  )
}

export function Transfer() {
  const accounts = useAccounts()
  const [f, setF] = useState({ date: todayMY(), from: '1000', to: '1100', amount: '', reference: '' })
  const [balances, setBalances] = useState<Map<string, number>>(new Map())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)
  // Reload after a transfer, so the amount still waiting is up to date.
  useEffect(() => { accountTotals(null, todayMY()).then(setBalances) }, [done])
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (f.from === f.to) return setError('From and To must be different')
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const name = (c: string) => accounts.find(a => a.code === c)?.name
      const id = await postJournal(f.date, `Transfer ${name(f.from)} to ${name(f.to)}`, [
        { account: f.to, debit: amount },
        { account: f.from, credit: amount },
      ], { source: 'transfer', reference: f.reference })
      setDone({ msg: `Moved ${rm(amount)}`, doc: await docNo(id) })
      setF({ ...f, amount: '', reference: '' })
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done.msg} doc={done.doc} again={() => setDone(null)} />
  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <p className="muted">Also use this when e-wallet money (TNG and the like) reaches the bank: From <b>1210 E-Wallet</b>, To <b>Bank</b>. E-wallets have no fee, so the full amount moves across. Card money is handled on the Card Settlement screen, because Fiuu takes a fee.</p>
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
      <div className="flex justify-end"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save transfer'}</button></div>
    </form>
  )
}

type EntryRow = {
  id: number; doc_no: string; date: string; description: string; reference: string | null; source: string; attachment: string | null
  journal_lines: { account: string; debit: number; credit: number; accounts: { name: string } }[]
}

const TYPES: Record<string, string> = {
  '': 'All types', pv: 'Payment Voucher', or: 'Official Receipt', jv: 'Journal Entry', transfer: 'Bank Transfer',
  pi: 'Purchase Invoice', sp: 'Supplier Payment', claim: 'Claim', manual: 'Older entries',
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
