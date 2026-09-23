import { useEffect, useState } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import { CheckCircle2, CloudUpload, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { MONEY_ACCOUNTS, dmy, rm, round2, supabase, useAccounts, type Account, type Role } from '../lib'
import { cogsLinesFor, dayTotal, daySuspect, parseBillSummary, parseFiuu, parseProductSales, paymentTotal, salesLinesFor, type Day, type ItemSale, type Settlement } from '../zeoniq'
import { AccountSelect, Empty } from '../ui'

export function UploadSales() {
  const [days, setDays] = useState<Day[]>([])
  const [pick, setPick] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [items, setItems] = useState<ItemSale[]>([])
  const [itemFile, setItemFile] = useState('')
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [costs, setCosts] = useState<Record<string, number>>({})
  const [accountNames, setAccountNames] = useState<Record<string, string>>({})

  useEffect(() => {
    supabase.from('item_category_map').select('prefix, account')
      .then(({ data }) => setCategories(Object.fromEntries((data ?? []).map(r => [r.prefix.toUpperCase(), r.account]))))
    supabase.from('accounts').select('code, name')
      .then(({ data }) => setAccountNames(Object.fromEntries((data ?? []).map(a => [a.code, a.name]))))
    supabase.from('item_costs').select('code, unit_cost')
      .then(({ data }) => setCosts(Object.fromEntries((data ?? []).map(r => [r.code.toUpperCase(), Number(r.unit_cost)]))))
  }, [])

  // Food / beverage / liquor split for one day, when the product file is loaded.
  const splitFor = (d: Day) => {
    const dayItems = items.filter(i => i.date === d.date)
    if (!dayItems.length) return null
    return salesLinesFor(dayItems, categories, d.sales)
  }

  // What the items sold that day cost us.
  const cogsFor = (d: Day) => {
    const dayItems = items.filter(i => i.date === d.date)
    if (!dayItems.length) return null
    return cogsLinesFor(dayItems, categories, costs)
  }

  async function onItemFile(file: File) {
    setError(''); setItemFile(file.name)
    try {
      const parsed = parseProductSales(await readXlsxFile(file))
      setItems(parsed)
      // Remember the items, so their cost can be filled in on the Item Costs screen.
      const seen = new Map<string, { code: string; name: string; date: string }>()
      for (const i of parsed) seen.set(i.code.toUpperCase(), { code: i.code, name: i.name, date: i.date })
      const { error } = await supabase.rpc('note_items', { p_items: [...seen.values()] })
      if (error) console.error('note_items', error)
    } catch (err) { setError((err as Error).message); setItems([]) }
  }

  async function onFile(file: File) {
    setError(''); setDays([]); setFileName(file.name)
    try {
      const parsed = parseBillSummary(await readXlsxFile(file))
      const { data } = await supabase.from('journals').select('source_ref').eq('source', 'sales')
        .in('source_ref', parsed.map(d => d.date))
      const already = new Set((data ?? []).map(r => r.source_ref))
      const withStatus = parsed.map(d => ({ ...d, posted: already.has(d.date) }))
      setDays(withStatus)
      setPick(Object.fromEntries(withStatus.filter(d => !d.posted).map(d => [d.date, true])))
    } catch (err) { setError((err as Error).message) }
  }

  // Cost of sales for a day, posted (or posted again) alongside it.
  async function postCogs(d: Day) {
    const cogs = cogsFor(d)
    if (!cogs || cogs.lines.length === 0) return
    const { error } = await supabase.rpc('post_cogs_day', { p_date: d.date, p_lines: cogs.lines })
    if (error) console.error('post_cogs_day', d.date, error)
  }

  async function postCogsOnly() {
    setBusy(true); setError('')
    const out: Day[] = []
    let done = 0
    for (const d of days) {
      const cogs = cogsFor(d)
      if (!pick[d.date] || !d.posted || !cogs || cogs.lines.length === 0) { out.push(d); continue }
      const { error } = await supabase.rpc('post_cogs_day', { p_date: d.date, p_lines: cogs.lines })
      if (error) console.error('post_cogs_day', d.date, error)
      else done++
      out.push({ ...d, result: error ? error.message : 'cost' })
    }
    setDays(out); setBusy(false)
    const failed = out.filter(d => d.result && !['ok', 'split', 'cost'].includes(d.result))
    setError(failed.length ? failed.map(d => `${dmy(d.date)}: ${d.result}`).join(' — ') : '')
    if (!failed.length && done === 0) setError('No cost to post: tick the days, and make sure the items have a cost on the Item Costs screen.')
  }

  // Days already posted as one line can take the split afterwards.
  async function resplit() {
    setBusy(true)
    const out: Day[] = []
    for (const d of days) {
      const split = splitFor(d)
      const usable = d.posted && split && split.unknown.length === 0 && Math.abs(split.diff) <= 0.05 && split.lines.length > 0
      if (!usable || !pick[d.date]) { out.push(d); continue }
      const { error } = await supabase.rpc('resplit_sales_day', {
        p_date: d.date, p_lines: split.lines.map(l => ({ account: l.account, amount: l.amount })),
      })
      if (error) console.error('resplit_sales_day', d.date, error)
      if (!error) await postCogs(d)
      out.push({ ...d, result: error ? error.message : 'split' })
    }
    setDays(out); setBusy(false)
    const failed = out.filter(d => d.result && !['ok', 'split'].includes(d.result))
    setError(failed.length ? failed.map(d => `${dmy(d.date)}: ${d.result}`).join(' — ') : '')
  }

  async function post() {
    setBusy(true)
    const out: Day[] = []
    for (const d of days) {
      if (!pick[d.date] || d.posted) { out.push(d); continue }
      const split = splitFor(d)
      const usable = split && split.unknown.length === 0 && Math.abs(split.diff) <= 0.05 && split.lines.length > 0
      const { error } = await supabase.rpc('post_sales_day', {
        p_date: d.date, p_sales: d.sales, p_service: d.service, p_tax: d.tax, p_rounding: d.rounding,
        p_payments: d.payments,
        p_sales_lines: usable ? split.lines.map(l => ({ account: l.account, amount: l.amount })) : null,
      })
      if (error) console.error('post_sales_day', d.date, error)
      if (!error) await postCogs(d)
      out.push({ ...d, posted: !error, result: error ? error.message : 'ok' })
    }
    setDays(out); setBusy(false)
    const failed = out.filter(d => d.result && d.result !== 'ok')
    setError(failed.length ? failed.map(d => `${dmy(d.date)}: ${d.result}`).join(' — ') : '')
  }

  const chosen = days.filter(d => pick[d.date] && !d.posted)
  // Posted days whose split is ready to be applied.
  // Posted days whose items have costs, so cost of sales can be written.
  const costable = days.filter(d => {
    if (!d.posted || !pick[d.date]) return false
    const cogs = cogsFor(d)
    return !!cogs && cogs.lines.length > 0
  })
  const splittable = days.filter(d => {
    if (!d.posted || !pick[d.date]) return false
    const split = splitFor(d)
    return !!split && split.unknown.length === 0 && Math.abs(split.diff) <= 0.05 && split.lines.length > 0
  })

  return (
    <div className="space-y-4">
      <div className="card">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-10 text-center hover:border-brand">
          <CloudUpload className="size-8 text-slate-400" />
          <span className="font-medium">Choose the Zeoniq Bill Summary file</span>
          <span className="muted">Zeoniq → Reports → Bill Summary Listing → Export to Excel (.xlsx)</span>
          {fileName && <span className="badge mt-1">{fileName}</span>}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-4 text-center text-sm hover:border-brand">
          <span className="font-medium">Optional: Product Sales export, to split food / beverage / liquor</span>
          {itemFile && <span className="badge">{itemFile}</span>}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && onItemFile(e.target.files[0])} />
        </label>
        <p className="muted mt-2 text-center">Export both reports with the same date range and the same status filter, or the split will not match.</p>
      </div>
      {error && <p className="alert-error">{error}</p>}

      {days.length > 0 && (
        <>
          <div className="card overflow-x-auto p-0">
            <table>
              <thead><tr>
                <th className="w-10"></th><th>Date</th><th className="text-right">Sales</th><th className="text-right">Service charge</th>
                <th className="text-right">Tax</th><th className="text-right">Rounding</th><th className="text-right">Day total</th>
                <th>Payments</th><th>Split</th><th className="text-right">Cost of sales</th><th></th>
              </tr></thead>
              <tbody>
                {days.map(d => {
                  const mismatch = daySuspect(d)
                  return (
                    <tr key={d.date} className={d.posted ? 'text-slate-400' : ''}>
                      <td><input type="checkbox" disabled={mismatch} checked={!!pick[d.date]}
                        onChange={e => setPick({ ...pick, [d.date]: e.target.checked })} /></td>
                      <td className="font-medium">{dmy(d.date)}</td>
                      <td className="text-right">{rm(d.sales)}</td>
                      <td className="text-right">{rm(d.service)}</td>
                      <td className="text-right">{rm(d.tax)}</td>
                      <td className="text-right">{rm(d.rounding)}</td>
                      <td className="text-right font-medium">{rm(d.netTotal)}</td>
                      <td className="text-xs text-slate-600">{d.payments.map(p => `${p.code} ${rm(p.amount)}`).join(' · ')}</td>
                      <td className="text-xs">{(() => {
                        const split = splitFor(d)
                        if (!split) return <span className="text-slate-400">One line</span>
                        if (split.unknown.length) return <span className="text-amber-600">Unknown item codes: {split.unknown.join(', ')}</span>
                        if (Math.abs(split.diff) > 0.05) return <span className="text-amber-600">Off by {rm(split.diff)} — posts as one line</span>
                        return <span className="text-slate-600">{split.lines.map(l => `${accountNames[l.account] ?? l.account} ${rm(l.amount)}`).join(' · ')}</span>
                      })()}</td>
                      <td className="text-right text-xs">{(() => {
                        const cogs = cogsFor(d)
                        if (!cogs) return <span className="text-slate-400">&mdash;</span>
                        if (cogs.total === 0) return <span className="text-amber-600">No costs set</span>
                        return (
                          <span title={cogs.missing.length ? `No cost yet for: ${cogs.missing.join(', ')}` : ''}>
                            {rm(cogs.total)}
                            {cogs.missing.length > 0 && <span className="block text-amber-600">{cogs.missing.length} item(s) without a cost</span>}
                          </span>
                        )
                      })()}</td>
                      <td className="whitespace-nowrap text-right text-xs">
                        {d.result === 'cost' && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-4" />Cost posted</span>}
                        {d.result === 'split' && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-4" />Split applied</span>}
                        {d.posted && !['split', 'cost'].includes(d.result ?? '') && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-4" />{d.result === 'ok' ? 'Posted' : 'Already in'}</span>}
                        {!d.posted && mismatch && <span className="inline-flex items-center gap-1 text-amber-600" title={`Totals do not add up: ${rm(dayTotal(d))} vs ${rm(d.netTotal)}, payments ${rm(paymentTotal(d))}`}><TriangleAlert className="size-4" />Does not add up</span>}
                        {!d.posted && d.result && d.result !== 'ok' && <span className="text-red-600">{d.result}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="muted">{chosen.length} day{chosen.length === 1 ? '' : 's'} ready · {rm(chosen.reduce((s, d) => s + d.netTotal, 0))}</p>
            <div className="ml-auto flex gap-2">
              {costable.length > 0 && (
                <button className="btn-light" disabled={busy} onClick={postCogsOnly} title="Write the cost of sales for these days from the item costs">
                  {busy ? 'Working…' : `Post cost of sales · ${costable.length} day${costable.length === 1 ? '' : 's'}`}
                </button>
              )}
              {splittable.length > 0 && (
                <button className="btn-light" disabled={busy} onClick={resplit} title="Replace the single sales line with the food / beverage / liquor split">
                  {busy ? 'Working…' : `Re-split ${splittable.length} posted day${splittable.length === 1 ? '' : 's'}`}
                </button>
              )}
              <button className="btn" disabled={busy || chosen.length === 0} onClick={post}>
                {busy ? 'Posting…' : `Post ${chosen.length} day${chosen.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
          {splittable.length > 0 && <p className="muted">Days already posted can take the split now — tick them and press <b>Re-split</b>. Only the sales lines change; payments, service charge and rounding stay as they are.</p>}
          <p className="muted">Cost of sales is posted as its own entry per day, from quantity sold times cost per unit. Fill in the costs on the <b>Item Costs</b> screen.</p>
          <p className="muted">Each day becomes one entry: money in by payment type, sales and service charge as income. A day already posted cannot go in twice.</p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Fiuu card settlements

export function CardSettlement() {
  const [rows, setRows] = useState<Settlement[]>([])
  const [takings, setTakings] = useState<{ date: string; gross: number }[]>([])
  const [inBooks, setInBooks] = useState<Record<string, number>>({})
  const [info, setInfo] = useState({ pending: 0, skipped: 0 })
  const [pick, setPick] = useState<Record<string, boolean>>({})
  const [bank, setBank] = useState('1100')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const accounts = useAccounts()

  async function onFile(file: File) {
    setError(''); setRows([]); setFileName(file.name)
    try {
      const parsed = parseFiuu(await readXlsxFile(file))
      const { data } = await supabase.from('journals').select('source_ref').eq('source', 'fiuu')
        .in('source_ref', parsed.settlements.map(s => s.settleDate))
      const already = new Set((data ?? []).map(r => r.source_ref))
      const list = parsed.settlements.map(s => ({ ...s, posted: already.has(s.settleDate) }))
      setRows(list)
      setTakings(parsed.takings)
      // What the POS already booked to 1200 on each of those days.
      const dates = parsed.takings.map(t => t.date)
      if (dates.length) {
        const { data: lines } = await supabase.from('journal_lines')
          .select('debit, journals!inner(date, source)')
          .eq('account', '1200').eq('journals.source', 'sales')
          .gte('journals.date', dates[0]).lte('journals.date', dates[dates.length - 1])
        const totals: Record<string, number> = {}
        for (const l of (lines ?? []) as unknown as { debit: number; journals: { date: string } }[]) {
          totals[l.journals.date] = round2((totals[l.journals.date] ?? 0) + Number(l.debit))
        }
        setInBooks(totals)
      }
      setInfo({ pending: parsed.pending, skipped: parsed.skipped })
      setPick(Object.fromEntries(list.filter(s => !s.posted).map(s => [s.settleDate, true])))
    } catch (err) { setError((err as Error).message) }
  }

  async function post() {
    setBusy(true)
    const out: Settlement[] = []
    for (const s of rows) {
      if (!pick[s.settleDate] || s.posted) { out.push(s); continue }
      const { error } = await supabase.rpc('post_fiuu_settlement', {
        p_settle_date: s.settleDate, p_gross: s.gross, p_fee: s.fee, p_net: s.net, p_bank: bank,
        p_note: `Fiuu settlement ${s.count} card payment${s.count === 1 ? '' : 's'}`,
        p_brands: s.brands.map(b => ({ brand: b.brand, gross: b.gross, fee: b.fee })),
      })
      if (error) console.error('post_fiuu_settlement', s.settleDate, error)
      out.push({ ...s, posted: !error, result: error ? error.message : 'ok' })
    }
    setRows(out); setBusy(false)
    const failed = out.filter(s => s.result && s.result !== 'ok')
    setError(failed.length ? failed.map(s => `${dmy(s.settleDate)}: ${s.result}`).join(' — ') : '')
  }

  const chosen = rows.filter(s => pick[s.settleDate] && !s.posted)
  return (
    <div className="space-y-4">
      <div className="card">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-10 text-center hover:border-brand">
          <CloudUpload className="size-8 text-slate-400" />
          <span className="font-medium">Choose the Fiuu transaction listing</span>
          <span className="muted">Fiuu portal → Transaction Listing → export to Excel</span>
          {fileName && <span className="badge mt-1">{fileName}</span>}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </div>
      {error && <p className="alert-error">{error}</p>}

      {rows.length > 0 && (
        <>
          <div className="card flex flex-wrap items-end gap-3">
            <div className="w-64"><label>Money paid into</label>
              <AccountSelect accounts={accounts} value={bank} onChange={setBank} filter={a => MONEY_ACCOUNTS.includes(a.code)} />
            </div>
            <p className="muted">{info.pending > 0 && `${info.pending} payment(s) not settled yet. `}{info.skipped > 0 && `${info.skipped} row(s) not in "settled" status were skipped.`}</p>
          </div>
          <div className="card overflow-x-auto p-0">
            <table>
              <thead><tr>
                <th className="w-10"></th><th>Paid into bank on</th><th className="text-right">Card payments</th>
                <th className="text-right">Customers paid</th><th className="text-right">Fiuu fee</th><th className="text-right">Rate</th>
                <th className="text-right">Into bank</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map(s => (
                  <>
                  <tr key={s.settleDate} className={s.posted ? 'text-slate-400' : ''}>
                    <td><input type="checkbox" disabled={s.posted} checked={!!pick[s.settleDate] && !s.posted}
                      onChange={e => setPick({ ...pick, [s.settleDate]: e.target.checked })} /></td>
                    <td className="font-medium">{dmy(s.settleDate)}</td>
                    <td className="text-right">{s.count}</td>
                    <td className="text-right">{rm(s.gross)}</td>
                    <td className="text-right text-rose-600">{rm(s.fee)}</td>
                    <td className="text-right text-xs text-slate-500">{s.gross ? (s.fee / s.gross * 100).toFixed(2) + '%' : ''}</td>
                    <td className="text-right font-semibold">{rm(s.net)}</td>
                    <td className="whitespace-nowrap text-right text-xs">
                      {s.posted && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-4" />{s.result === 'ok' ? 'Posted' : 'Already in'}</span>}
                      {!s.posted && s.result && s.result !== 'ok' && <span className="text-red-600">{s.result}</span>}
                    </td>
                  </tr>
                  {s.brands.map(b => (
                    <tr key={s.settleDate + b.brand} className="text-xs text-slate-500">
                      <td></td><td className="pl-6">{b.brand}</td><td className="text-right">{b.count}</td>
                      <td className="text-right">{rm(b.gross)}</td><td className="text-right">{rm(b.fee)}</td>
                      <td className="text-right">{b.gross ? (b.fee / b.gross * 100).toFixed(2) + '%' : ''}</td>
                      <td className="text-right">{rm(round2(b.gross - b.fee))}</td><td></td>
                    </tr>
                  ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="muted">{chosen.length} payout{chosen.length === 1 ? '' : 's'} ready · {rm(chosen.reduce((s, r) => s + r.net, 0))} into the bank</p>
            <button className="btn ml-auto" disabled={busy || chosen.length === 0} onClick={post}>
              {busy ? 'Posting…' : `Post ${chosen.length} payout${chosen.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {takings.length > 0 && (
            <div className="card">
              <h3 className="font-semibold">Check only — nothing here is posted</h3>
              <p className="muted">
                Card sales reach your books from the Zeoniq Bill Summary, not from Fiuu. This compares the two.
                A card paid after midnight may sit on the day before on the POS, so a difference that cancels out between
                two days is normal.
              </p>
              <table className="mt-3">
                <thead><tr><th>Day of sale</th><th className="text-right">Fiuu says</th><th className="text-right">In your books (POS)</th><th className="text-right">Difference</th></tr></thead>
                <tbody>{takings.map(t => {
                  const booked = inBooks[t.date]
                  const diff = booked === undefined ? null : round2(booked - t.gross)
                  return (
                    <tr key={t.date}>
                      <td>{dmy(t.date)}</td>
                      <td className="text-right">{rm(t.gross)}</td>
                      <td className="text-right">{booked === undefined ? <span className="text-amber-600">Sales not uploaded</span> : rm(booked)}</td>
                      <td className={`text-right ${diff ? 'text-amber-600' : 'text-slate-400'}`}>{diff === null ? '—' : diff === 0 ? 'Matches' : rm(diff)}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
          <p className="muted">Each payout moves money out of 1200 Fiuu Card into the bank and books the fee to 6200. When everything is settled, 1200 goes back to zero.</p>
        </>
      )}
    </div>
  )
}

type PayRow = { code: string; label: string; account: string }

export function SalesSettings({ role }: { role: Role }) {
  const accounts = useAccounts()
  const [rows, setRows] = useState<PayRow[]>([])
  const [settings, setSettings] = useState<Record<string, string> | null>(null)
  const [add, setAdd] = useState({ code: '', label: '', account: '1000' })
  const [msg, setMsg] = useState('')
  const canEdit = role === 'owner' || role === 'accountant'

  const load = () => {
    supabase.from('payment_map').select('*').order('account').order('code').then(({ data }) => setRows(data ?? []))
    supabase.from('sales_settings').select('*').single().then(({ data }) => setSettings(data))
  }
  useEffect(load, [])

  async function setAccount(code: string, account: string) {
    const { error } = await supabase.from('payment_map').update({ account }).eq('code', code)
    setMsg(error ? error.message : ''); load()
  }
  async function addRow(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('payment_map').insert({ ...add, code: add.code.toUpperCase(), label: add.label || add.code })
    if (error) return setMsg(error.message)
    setAdd({ code: '', label: '', account: '1000' }); load()
  }
  async function remove(code: string) {
    if (!confirm(`Remove ${code}? Files containing it will not import until it is added back.`)) return
    await supabase.from('payment_map').delete().eq('code', code); load()
  }
  async function setSetting(key: string, value: string) {
    const { error } = await supabase.from('sales_settings').update({ [key]: value }).eq('id', 1)
    setMsg(error ? error.message : ''); load()
  }

  const SETTINGS: [string, string][] = [
    ['sales_account', 'Sales'], ['service_account', 'Service charge'], ['tax_account', 'SST'],
    ['rounding_account', 'Rounding (Adj. Amount)'], ['discount_account', 'Discount given'],
  ]

  return (
    <div className="space-y-6">
      {msg && <p className="alert-error">{msg}</p>}
      <div className="card">
        <h3 className="font-semibold">Where the sales side goes</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {settings && SETTINGS.map(([k, label]) => (
            <div key={k}><label>{label}</label>
              <select value={settings[k]} disabled={!canEdit} onChange={e => setSetting(k, e.target.value)}>
                {accounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      <ItemCategories canEdit={canEdit} accounts={accounts} />

      <div className="card overflow-x-auto p-0">
        <div className="p-5 pb-3">
          <h3 className="font-semibold">Payment types from Zeoniq</h3>
          <p className="muted">The code must match the column name in the report exactly.</p>
        </div>
        {rows.length === 0 && <Empty text="No payment types." />}
        {rows.length > 0 && <table>
          <thead><tr><th className="w-32">Code</th><th>Name</th><th>Goes to</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code}>
                <td className="font-mono text-xs">{r.code}</td>
                <td>{r.label}</td>
                <td className="w-72"><AccountSelect accounts={accounts} value={r.account} onChange={v => setAccount(r.code, v)} /></td>
                <td className="text-right">{canEdit && <button title="Remove" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(r.code)}><Trash2 className="size-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>}
        {canEdit && (
          <form onSubmit={addRow} className="grid items-end gap-3 border-t border-slate-100 p-5 sm:grid-cols-[8rem_1fr_16rem_auto]">
            <div><label>Code</label><input value={add.code} onChange={e => setAdd({ ...add, code: e.target.value })} placeholder="e.g. BOOST" required /></div>
            <div><label>Name</label><input value={add.label} onChange={e => setAdd({ ...add, label: e.target.value })} /></div>
            <div><label>Goes to</label><AccountSelect accounts={accounts} value={add.account} onChange={v => setAdd({ ...add, account: v })} /></div>
            <button className="btn"><Plus className="size-4" />Add</button>
          </form>
        )}
      </div>
    </div>
  )
}

type CategoryRow = { prefix: string; label: string; account: string }

// Which sales account each Zeoniq item-code group belongs to (AC01 -> AC -> liquor).
function ItemCategories({ canEdit, accounts }: { canEdit: boolean; accounts: Account[] }) {
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [add, setAdd] = useState({ prefix: '', label: '', account: '4000' })
  const [msg, setMsg] = useState('')
  const load = () => { supabase.from('item_category_map').select('*').order('account').order('prefix').then(({ data }) => setRows(data ?? [])) }
  useEffect(load, [])

  async function setAccount(prefix: string, account: string) {
    const { error } = await supabase.from('item_category_map').update({ account }).eq('prefix', prefix)
    setMsg(error?.message ?? ''); load()
  }
  async function addRow(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('item_category_map')
      .insert({ ...add, prefix: add.prefix.toUpperCase(), label: add.label || add.prefix })
    if (error) return setMsg(error.message)
    setAdd({ prefix: '', label: '', account: '4000' }); load()
  }
  async function remove(prefix: string) {
    if (!confirm(`Remove ${prefix}?`)) return
    await supabase.from('item_category_map').delete().eq('prefix', prefix); load()
  }

  return (
    <div className="card overflow-x-auto p-0">
      <div className="p-5 pb-3">
        <h3 className="font-semibold">Item groups for the food / drink split</h3>
        <p className="muted">The start of the item code, for example AC in AC01-CARLSBERG.</p>
      </div>
      {msg && <p className="alert-error mx-5">{msg}</p>}
      {rows.length === 0 && <Empty text="No item groups." />}
      {rows.length > 0 && <table>
        <thead><tr><th className="w-24">Code starts with</th><th>Name</th><th>Sales account</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.prefix}>
              <td className="font-mono text-xs">{r.prefix}</td>
              <td>{r.label}</td>
              <td className="w-72"><AccountSelect accounts={accounts} value={r.account} onChange={v => setAccount(r.prefix, v)} filter={a => a.type === 'income'} /></td>
              <td className="text-right">{canEdit && <button title="Remove" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(r.prefix)}><Trash2 className="size-4" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>}
      {canEdit && (
        <form onSubmit={addRow} className="grid items-end gap-3 border-t border-slate-100 p-5 sm:grid-cols-[8rem_1fr_16rem_auto]">
          <div><label>Code starts with</label><input value={add.prefix} onChange={e => setAdd({ ...add, prefix: e.target.value })} placeholder="e.g. WN" required /></div>
          <div><label>Name</label><input value={add.label} onChange={e => setAdd({ ...add, label: e.target.value })} placeholder="Wine" /></div>
          <div><label>Sales account</label><AccountSelect accounts={accounts} value={add.account} onChange={v => setAdd({ ...add, account: v })} filter={a => a.type === 'income'} /></div>
          <button className="btn"><Plus className="size-4" />Add</button>
        </form>
      )}
    </div>
  )
}
