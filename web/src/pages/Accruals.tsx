import { useEffect, useState } from 'react'
import { CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { accountTotals, dmy, rm, round2, supabase, todayMY, useAccounts, type Role } from '../lib'
import { AccountSelect, Empty } from '../ui'

type Item = { id: number; name: string; account: string; amount: number; active: boolean; sort: number }

const monthLabel = (ym: string) =>
  new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// Costs that come every month, put into the right month before the bill arrives.
export function Accruals({ role }: { role: Role }) {
  const accounts = useAccounts()
  const [items, setItems] = useState<Item[]>([])
  const [month, setMonth] = useState(todayMY().slice(0, 7))
  const [pick, setPick] = useState<Record<number, boolean>>({})
  const [posted, setPosted] = useState<{ doc_no: string; date: string } | null>(null)
  const [owing, setOwing] = useState(0)
  const [add, setAdd] = useState({ name: '', account: '6900', amount: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const canEdit = role === 'owner' || role === 'accountant'

  const load = () => {
    supabase.from('recurring_accruals').select('*').eq('active', true).order('sort').order('id')
      .then(({ data }) => {
        const list = (data ?? []) as Item[]
        setItems(list)
        setPick(Object.fromEntries(list.filter(i => Number(i.amount) > 0).map(i => [i.id, true])))
      })
    accountTotals(null, todayMY()).then(m => setOwing(-round2(m.get('2600') ?? 0)))
  }
  useEffect(load, [])
  useEffect(() => {
    supabase.from('journals').select('doc_no, date').eq('source', 'accrual').eq('source_ref', `${month}-01`).maybeSingle()
      .then(({ data }) => setPosted(data))
  }, [month, msg])

  async function save(id: number, patch: Partial<Item>) {
    const { error } = await supabase.from('recurring_accruals').update(patch).eq('id', id)
    if (error) return setError(error.message)
    setItems(items.map(i => i.id === id ? { ...i, ...patch } : i))
  }
  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('recurring_accruals')
      .insert({ name: add.name, account: add.account, amount: round2(Number(add.amount || 0)), sort: items.length + 1 })
    if (error) return setError(error.message)
    setAdd({ name: '', account: '6900', amount: '' }); load()
  }
  async function remove(id: number) {
    if (!confirm('Remove this line from the monthly list?')) return
    await supabase.from('recurring_accruals').update({ active: false }).eq('id', id); load()
  }

  const chosen = items.filter(i => pick[i.id] && Number(i.amount) > 0)
  const total = round2(chosen.reduce((s, i) => s + Number(i.amount), 0))

  async function post() {
    if (posted && !confirm(`${monthLabel(month)} already has an accrual (${posted.doc_no}). Replace it?`)) return
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('post_accruals', {
      p_month: `${month}-01`,
      p_lines: chosen.map(i => ({ account: i.account, amount: round2(Number(i.amount)), name: i.name })),
    })
    setBusy(false)
    if (error) return setError(error.message)
    setMsg(data ? `Posted for ${monthLabel(month)}` : 'Nothing to post')
    load()
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-4">
        <div className="w-48"><label>Month</label><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>
        <div>
          <div className="muted">Still owed on accruals</div>
          <div className="text-lg font-semibold tabular-nums">{rm(owing)}</div>
        </div>
        {posted && <p className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="size-4" />{monthLabel(month)} posted as {posted.doc_no} on {dmy(posted.date)}</p>}
      </div>

      <div className="card overflow-x-auto p-0">
        {items.length === 0 && <Empty text="No monthly costs on the list yet." />}
        {items.length > 0 && <table>
          <thead><tr><th className="w-10"></th><th>Cost</th><th>Account</th><th className="w-44 text-right">Amount each month (RM)</th><th></th></tr></thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id}>
                <td><input type="checkbox" checked={!!pick[i.id]} onChange={e => setPick({ ...pick, [i.id]: e.target.checked })} /></td>
                <td>{canEdit
                  ? <input className="h-8 border-transparent shadow-none hover:border-slate-300" defaultValue={i.name}
                      onBlur={e => e.target.value !== i.name && save(i.id, { name: e.target.value })} />
                  : i.name}</td>
                <td className="w-72"><AccountSelect accounts={accounts} value={i.account} onChange={v => save(i.id, { account: v })} filter={a => a.type === 'expense'} /></td>
                <td><input className="text-right" type="number" step="0.01" min="0" inputMode="decimal" disabled={!canEdit}
                  defaultValue={Number(i.amount)} onBlur={e => Number(e.target.value) !== Number(i.amount) && save(i.id, { amount: round2(Number(e.target.value)) })} /></td>
                <td className="text-right">{canEdit && <button title="Remove" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(i.id)}><Trash2 className="size-4" /></button>}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td></td><td colSpan={2}>Total for {monthLabel(month)}</td>
              <td className="text-right">{rm(total)}</td><td></td>
            </tr>
          </tbody>
        </table>}
      </div>

      {error && <p className="alert-error">{error}</p>}
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <p className="muted">Posted on the last day of the month: each cost is charged to its account, with the total owed sitting in 2600 Accrued Expenses.</p>
        {canEdit && <button className="btn ml-auto" disabled={busy || total <= 0} onClick={post}>
          {busy ? 'Posting…' : posted ? `Replace ${monthLabel(month)}` : `Post ${monthLabel(month)}`}
        </button>}
      </div>

      {canEdit && (
        <form onSubmit={addItem} className="card grid items-end gap-3 sm:grid-cols-[1fr_16rem_10rem_auto]">
          <div><label>Add a monthly cost</label><input value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} placeholder="e.g. Liquor licence" required /></div>
          <div><label>Account</label><AccountSelect accounts={accounts} value={add.account} onChange={v => setAdd({ ...add, account: v })} filter={a => a.type === 'expense'} /></div>
          <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={add.amount} onChange={e => setAdd({ ...add, amount: e.target.value })} /></div>
          <button className="btn"><Plus className="size-4" />Add</button>
        </form>
      )}

      <p className="muted">
        When the real bill arrives, pay it with a <b>Payment Voucher</b> against <b>2600 Accrued Expenses</b> — not the expense account, or the cost would be counted twice.
        If the bill differs from the estimate, clear the few ringgit left with a Journal Entry against the same expense account.
      </p>
    </div>
  )
}
