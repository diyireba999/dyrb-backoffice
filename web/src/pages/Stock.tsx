import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { accountTotals, dmy, downloadCsv, rm, round2, supabase, todayMY, type Role } from '../lib'
import { Empty, ReportBar } from '../ui'
import { codePrefix } from '../zeoniq'

type ItemCost = { code: string; name: string; unit_cost: number; last_seen: string | null }
type Costing = { sales_account: string; cost_account: string; stock_account: string }

// Cost per unit for every item seen in a Product Sales upload.
export function ItemCosts({ role }: { role: Role }) {
  const [rows, setRows] = useState<ItemCost[]>([])
  const [groups, setGroups] = useState<Record<string, string>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [msg, setMsg] = useState('')
  const canEdit = role === 'owner' || role === 'accountant'

  const load = () => {
    supabase.from('item_costs').select('*').order('code').then(({ data }) => setRows(data ?? []))
    supabase.from('item_category_map').select('prefix, account')
      .then(({ data }) => setGroups(Object.fromEntries((data ?? []).map(r => [r.prefix.toUpperCase(), r.account]))))
    supabase.from('accounts').select('code, name')
      .then(({ data }) => setNames(Object.fromEntries((data ?? []).map(a => [a.code, a.name]))))
  }
  useEffect(load, [])

  async function setCost(code: string, value: string) {
    const unit_cost = round2(Number(value || 0))
    const { error } = await supabase.from('item_costs').update({ unit_cost, updated_at: new Date().toISOString() }).eq('code', code)
    if (error) return setMsg(error.message)
    setRows(rows.map(r => r.code === code ? { ...r, unit_cost } : r))
  }

  const term = q.trim().toLowerCase()
  const shown = rows.filter(r =>
    (!term || r.code.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)) &&
    (!onlyMissing || Number(r.unit_cost) === 0))
  const missing = rows.filter(r => Number(r.unit_cost) === 0).length
  const csv = () => downloadCsv('item-costs.csv', [['Code', 'Name', 'Cost per unit', 'Last seen'],
    ...rows.map(r => [r.code, r.name, Number(r.unit_cost), r.last_seen ?? ''])])

  return (
    <div className="space-y-4">
      <ReportBar title="Item Costs" period={`As at ${dmy(todayMY())}`} onCsv={csv}>
        <div className="w-64"><label>Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder="Code or name" />
          </div>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm font-normal">
          <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />
          Only items without a cost ({missing})
        </label>
      </ReportBar>
      {msg && <p className="alert-error">{msg}</p>}
      <p className="muted">
        Cost per unit is what the drink or dish costs you — one mug, one bottle, one plate.
        Items appear here by themselves when you upload a Product Sales file. An item with no cost adds nothing to cost of sales.
      </p>
      <div className="card overflow-x-auto p-0">
        {shown.length === 0 && <Empty text={rows.length ? 'Nothing matches.' : 'Upload a Product Sales file first; the items will appear here.'} />}
        {shown.length > 0 && <table>
          <thead><tr><th className="w-32">Code</th><th>Item</th><th>Goes to</th><th className="w-40 text-right">Cost per unit (RM)</th><th className="w-28">Last sold</th></tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.code} className={Number(r.unit_cost) === 0 ? 'bg-amber-50/40' : ''}>
                <td className="font-mono text-xs">{r.code}</td>
                <td>{r.name}</td>
                <td className="text-slate-600">{names[groups[codePrefix(r.code)]] ?? <span className="text-amber-600">Group not mapped</span>}</td>
                <td><input className="text-right" type="number" step="0.01" min="0" inputMode="decimal" disabled={!canEdit}
                  defaultValue={Number(r.unit_cost)} onBlur={e => Number(e.target.value) !== Number(r.unit_cost) && setCost(r.code, e.target.value)} /></td>
                <td className="text-slate-500">{r.last_seen ? dmy(r.last_seen) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </div>
  )
}

// Count the shelf, and let the difference fall into cost of sales.
export function StockCount({ role }: { role: Role }) {
  const [costing, setCosting] = useState<Costing[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [book, setBook] = useState<Map<string, number>>(new Map())
  const [date, setDate] = useState(todayMY())
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const canEdit = role === 'owner' || role === 'accountant'

  const load = () => {
    supabase.from('category_costing').select('*').then(({ data }) => setCosting(data ?? []))
    supabase.from('accounts').select('code, name')
      .then(({ data }) => setNames(Object.fromEntries((data ?? []).map(a => [a.code, a.name]))))
    accountTotals(null, date).then(setBook)
  }
  useEffect(load, [date])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const lines = costing
      .filter(c => counted[c.stock_account] !== undefined && counted[c.stock_account] !== '')
      .map(c => ({ stock_account: c.stock_account, counted: round2(Number(counted[c.stock_account])) }))
    if (!lines.length) return setError('Enter at least one counted value')
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('post_stock_count', { p_date: date, p_lines: lines })
    setBusy(false)
    if (error) return setError(error.message)
    setMsg(data ? 'Stock count posted' : 'Nothing to adjust: the count matches the books')
    setCounted({}); load()
  }

  return (
    <form onSubmit={submit} className="card max-w-3xl space-y-5 p-6">
      <p className="muted">
        Count what is left on the shelf and in the store, work out its cost value, and type it in.
        Anything missing (wastage, free pours, breakage) goes to cost of sales.
      </p>
      <div className="w-48"><label>Count date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} required /></div>
      <div className="-mx-6 overflow-x-auto">
        <table>
          <thead><tr><th className="pl-6">Stock</th><th className="text-right">Value in the books</th><th className="w-44 text-right">Counted value (RM)</th><th className="w-40 pr-6 text-right">Difference</th></tr></thead>
          <tbody>
            {costing.map(c => {
              const value = round2(book.get(c.stock_account) ?? 0)
              const typed = counted[c.stock_account]
              const diff = typed === undefined || typed === '' ? null : round2(Number(typed) - value)
              return (
                <tr key={c.stock_account}>
                  <td className="pl-6 font-medium">{names[c.stock_account] ?? c.stock_account}</td>
                  <td className="text-right">{rm(value)}</td>
                  <td><input className="text-right" type="number" step="0.01" min="0" inputMode="decimal" disabled={!canEdit}
                    value={typed ?? ''} onChange={e => setCounted({ ...counted, [c.stock_account]: e.target.value })} /></td>
                  <td className={`pr-6 text-right ${diff && diff < 0 ? 'text-rose-600' : diff ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {diff === null ? '—' : diff === 0 ? 'Matches' : rm(diff)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="alert-error">{error}</p>}
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {canEdit && <div className="flex justify-end"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Post stock count'}</button></div>}
    </form>
  )
}
