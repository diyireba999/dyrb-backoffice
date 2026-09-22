import { useEffect, useState } from 'react'
import { MONEY_ACCOUNTS, dmy, openReceipt, postJournal, rm, round2, supabase, todayMY, uploadReceipt, useAccounts, type Account } from '../lib'

function Done({ msg, again }: { msg: string; again: () => void }) {
  return (
    <div className="card space-y-3">
      <p className="text-green-700 font-semibold">{msg}</p>
      <button className="btn" onClick={again}>Add another</button>
    </div>
  )
}

function AccountSelect({ accounts, value, onChange, filter }: {
  accounts: Account[]; value: string; onChange: (v: string) => void; filter: (a: Account) => boolean
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} required>
      <option value="">— choose —</option>
      {accounts.filter(filter).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
    </select>
  )
}

type Supplier = { id: number; name: string; phone: string | null; default_account: string | null }

function useSuppliers() {
  const [list, setList] = useState<Supplier[]>([])
  const load = () => { supabase.from('suppliers').select('*').order('name').then(({ data }) => setList(data ?? [])) }
  useEffect(load, [])
  return { list, load }
}

export function MoneyOut() {
  const accounts = useAccounts()
  const { list: suppliers } = useSuppliers()
  const [f, setF] = useState({ date: todayMY(), payee: '', what: '', amount: '', from: '1100', note: '' })
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  function pickPayee(name: string) {
    const s = suppliers.find(s => s.name === name)
    setF({ ...f, payee: name, what: s?.default_account ?? f.what })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const attachment = photo ? await uploadReceipt(photo) : undefined
      const desc = [f.payee, f.note].filter(Boolean).join(' – ') || 'Expense'
      await postJournal(f.date, desc, [
        { account: f.what, debit: amount },
        { account: f.from, credit: amount },
      ], { attachment })
      setDone(`Saved ${rm(amount)} to ${f.payee || 'expense'}`)
      setF({ ...f, payee: '', what: '', amount: '', note: '' }); setPhoto(null)
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done} again={() => setDone('')} />
  return (
    <form onSubmit={submit} className="card space-y-4 max-w-lg">
      <h2 className="text-xl font-semibold">Money Out</h2>
      <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
      <div>
        <label>Paid to</label>
        <input list="suppliers" value={f.payee} onChange={e => pickPayee(e.target.value)} placeholder="Supplier or shop name" />
        <datalist id="suppliers">{suppliers.map(s => <option key={s.id} value={s.name} />)}</datalist>
      </div>
      <div>
        <label>What for</label>
        <AccountSelect accounts={accounts} value={f.what} onChange={v => set('what', v)}
          filter={a => a.type === 'expense' || a.code === '2000' || a.code === '3100' || (a.type === 'asset' && a.code >= '1300')} />
      </div>
      <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
      <div>
        <label>Paid from</label>
        <select value={f.from} onChange={e => set('from', e.target.value)}>
          {accounts.filter(a => MONEY_ACCOUNTS.includes(a.code)).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
          <option value="2000">Not paid yet (owe supplier)</option>
        </select>
      </div>
      <div><label>Note (optional)</label><input value={f.note} onChange={e => set('note', e.target.value)} placeholder="Invoice no., items" /></div>
      <div><label>Receipt photo (optional)</label><input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></div>
      {error && <p className="text-red-700 text-sm">{error}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

export function MoneyIn() {
  const accounts = useAccounts()
  const [f, setF] = useState({ date: todayMY(), from: '', kind: '4900', amount: '', into: '1100' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      await postJournal(f.date, f.from || 'Money in', [
        { account: f.into, debit: amount },
        { account: f.kind, credit: amount },
      ])
      setDone(`Saved ${rm(amount)} received`)
      setF({ ...f, from: '', amount: '' })
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done} again={() => setDone('')} />
  return (
    <form onSubmit={submit} className="card space-y-4 max-w-lg">
      <h2 className="text-xl font-semibold">Money In</h2>
      <p className="text-sm text-stone-500">Daily sales come from Upload Sales. Use this for anything else.</p>
      <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
      <div><label>Received from</label><input value={f.from} onChange={e => set('from', e.target.value)} placeholder="e.g. event deposit, owner" /></div>
      <div>
        <label>Type</label>
        <AccountSelect accounts={accounts} value={f.kind} onChange={v => set('kind', v)}
          filter={a => a.type === 'income' || a.type === 'equity' || a.code === '1300'} />
      </div>
      <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
      <div>
        <label>Received into</label>
        <AccountSelect accounts={accounts} value={f.into} onChange={v => set('into', v)} filter={a => MONEY_ACCOUNTS.includes(a.code)} />
      </div>
      {error && <p className="text-red-700 text-sm">{error}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

export function Transfer() {
  const accounts = useAccounts()
  const [f, setF] = useState({ date: todayMY(), from: '1000', to: '1100', amount: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  const money = (a: Account) => MONEY_ACCOUNTS.includes(a.code)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (f.from === f.to) return setError('From and To must be different')
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const name = (c: string) => accounts.find(a => a.code === c)?.name
      await postJournal(f.date, `Transfer ${name(f.from)} to ${name(f.to)}`, [
        { account: f.to, debit: amount },
        { account: f.from, credit: amount },
      ])
      setDone(`Moved ${rm(amount)}`)
      setF({ ...f, amount: '' })
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done) return <Done msg={done} again={() => setDone('')} />
  return (
    <form onSubmit={submit} className="card space-y-4 max-w-lg">
      <h2 className="text-xl font-semibold">Transfer</h2>
      <div><label>Date</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} required /></div>
      <div><label>From</label><AccountSelect accounts={accounts} value={f.from} onChange={v => set('from', v)} filter={money} /></div>
      <div><label>To</label><AccountSelect accounts={accounts} value={f.to} onChange={v => set('to', v)} filter={money} /></div>
      <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
      {error && <p className="text-red-700 text-sm">{error}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

type EntryRow = {
  id: number; date: string; description: string; source: string; attachment: string | null
  journal_lines: { account: string; debit: number; credit: number; accounts: { name: string } }[]
}

export function Entries() {
  const [month, setMonth] = useState(todayMY().slice(0, 7))
  const [rows, setRows] = useState<EntryRow[]>([])

  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
    supabase.from('journals')
      .select('id, date, description, source, attachment, journal_lines(account, debit, credit, accounts(name))')
      .gte('date', `${month}-01`).lt('date', end)
      .order('date', { ascending: false }).order('id', { ascending: false })
      .then(({ data }) => setRows((data as unknown as EntryRow[]) ?? []))
  }, [month])

  async function remove(id: number) {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    const { error } = await supabase.from('journals').delete().eq('id', id)
    if (error) return alert(error.message)
    setRows(rows.filter(r => r.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <h2 className="text-xl font-semibold mr-auto">All Entries</h2>
        <div><label>Month</label><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>
      </div>
      {rows.length === 0 && <p className="text-stone-500">No entries this month.</p>}
      {rows.map(r => (
        <div key={r.id} className="card">
          <div className="flex gap-2 items-baseline">
            <span className="text-stone-500 text-sm">{dmy(r.date)}</span>
            <span className="font-semibold">{r.description}</span>
            <span className="text-xs rounded bg-stone-100 px-1.5 py-0.5">{r.source}</span>
            <span className="ml-auto flex gap-3 text-sm">
              {r.attachment && <button className="text-brand underline" onClick={() => openReceipt(r.attachment!)}>Receipt</button>}
              {r.source === 'manual' && <button className="text-red-700 underline" onClick={() => remove(r.id)}>Delete</button>}
            </span>
          </div>
          <table className="mt-2">
            <tbody>
              {r.journal_lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.accounts.name}</td>
                  <td className="text-right w-32">{l.debit ? rm(l.debit) : ''}</td>
                  <td className="text-right w-32">{l.credit ? rm(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

export function Suppliers() {
  const accounts = useAccounts()
  const { list, load } = useSuppliers()
  const [f, setF] = useState({ name: '', phone: '', default_account: '' })
  const [error, setError] = useState('')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('suppliers').insert({ ...f, default_account: f.default_account || null })
    if (error) return setError(error.message)
    setF({ name: '', phone: '', default_account: '' }); setError(''); load()
  }

  async function remove(id: number) {
    if (!confirm('Remove this supplier?')) return
    await supabase.from('suppliers').delete().eq('id', id); load()
  }

  const acctName = (c: string | null) => accounts.find(a => a.code === c)?.name ?? ''
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Suppliers</h2>
      <form onSubmit={add} className="card grid md:grid-cols-4 gap-3 items-end">
        <div><label>Name</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></div>
        <div><label>Phone</label><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
        <div><label>Usually for</label>
          <select value={f.default_account} onChange={e => setF({ ...f, default_account: e.target.value })}>
            <option value="">—</option>
            {accounts.filter(a => a.type === 'expense').map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
          </select>
        </div>
        <button className="btn">Add</button>
        {error && <p className="text-red-700 text-sm md:col-span-4">{error}</p>}
      </form>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Usually for</th><th></th></tr></thead>
          <tbody>
            {list.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.phone}</td><td>{acctName(s.default_account)}</td>
                <td className="text-right"><button className="text-red-700 underline text-sm" onClick={() => remove(s.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
