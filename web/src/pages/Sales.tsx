import { Fragment, useEffect, useState } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import { CheckCircle2, CloudUpload, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { MONEY_ACCOUNTS, dmy, rm, round2, supabase, useAccounts, type Account, type Role } from '../lib'
import { cogsLinesFor, dayTotal, daySuspect, detectFile, parseBillSummary, parseFiuu, parseProductSales, paymentTotal, salesLinesFor, type Day, type FileKind, type ItemSale, type Settlement } from '../zeoniq'
import { AccountSelect, Empty } from '../ui'
import { confirmDialog } from '../feedback'

// What the POS booked to 1200 (card takings) per sale day, for ascending dates.
async function bookedCard(dates: string[]): Promise<Record<string, number>> {
  const booked: Record<string, number> = {}
  if (!dates.length) return booked
  const { data: lines, error } = await supabase.from('journal_lines')
    .select('debit, journals!inner(date, source)')
    .eq('account', '1200').eq('journals.source', 'sales')
    .gte('journals.date', dates[0]).lte('journals.date', dates[dates.length - 1])
  if (error) console.error('bookedCard', error)
  for (const l of (lines ?? []) as unknown as { debit: number; journals: { date: string } }[]) {
    booked[l.journals.date] = round2((booked[l.journals.date] ?? 0) + Number(l.debit))
  }
  return booked
}

// Reads a Fiuu listing: settlements with their posted flag, takings per sale day, and
// what the POS already booked to 1200 on those days. Shared by the daily close and the
// stand-alone Card settlement screen.
async function loadFiuuFile(rows: unknown) {
  const parsed = parseFiuu(rows)
  const { data } = await supabase.from('journals').select('source_ref, journal_lines(account, debit, credit)').eq('source', 'fiuu')
    .in('source_ref', parsed.settlements.map(s => s.settleDate))
  // A payout already in the books: its figures, so a second file for the same day can be compared.
  type Booked = { source_ref: string; journal_lines: { account: string; debit: number; credit: number }[] }
  const already = new Map<string, Settlement['booked']>()
  for (const j of (data ?? []) as unknown as Booked[]) {
    const sum = (f: (l: Booked['journal_lines'][number]) => number) => round2(j.journal_lines.reduce((s, l) => s + f(l), 0))
    already.set(j.source_ref, {
      gross: sum(l => l.account === '1200' ? Number(l.credit) : 0),
      fee: sum(l => l.account === '6200' ? Number(l.debit) : 0),
      net: sum(l => MONEY_ACCOUNTS.includes(l.account) ? Number(l.debit) : 0),
    })
  }
  const list: Settlement[] = parsed.settlements.map(s => ({ ...s, posted: already.has(s.settleDate), booked: already.get(s.settleDate) }))
  const inBooks = await bookedCard(parsed.takings.map(t => t.date))
  return { list, takings: parsed.takings, inBooks, info: { pending: parsed.pending, skipped: parsed.skipped } }
}

// Posts the ticked payouts that are not in yet; every row comes back with its result.
async function postSettlements(rows: Settlement[], pick: Record<string, boolean>, bank: string) {
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
  return out
}

// Fiuu takings per day of sale against what the POS upload booked. Check only.
function FiuuCheck({ takings, inBooks }: { takings: { date: string; gross: number }[]; inBooks: Record<string, number> }) {
  if (takings.length === 0) return null
  return (
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
  )
}

// Payout rows with their per-card-type breakdown. Shared by both screens.
// True when the file's figures for a posted day differ from what is in the books.
const bookedDiffers = (s: Settlement) =>
  !!s.booked && (Math.abs(s.booked.gross - s.gross) > 0.005 || Math.abs(s.booked.net - s.net) > 0.005)

function PayoutRows({ rows, pick, onPick }: { rows: Settlement[]; pick: Record<string, boolean>; onPick: (date: string, on: boolean) => void }) {
  return (
    <table>
      <thead><tr>
        <th className="w-10"></th><th>Paid into bank on</th><th className="text-right">Card payments</th>
        <th className="text-right">Customers paid</th><th className="text-right">Fiuu fee</th><th className="text-right">Rate</th>
        <th className="text-right">Into bank</th><th></th>
      </tr></thead>
      <tbody>
        {rows.map(s => (
          <Fragment key={s.settleDate}>
          <tr className={s.posted ? 'text-slate-400' : ''}>
            <td><input type="checkbox" disabled={s.posted} checked={!!pick[s.settleDate] && !s.posted} onChange={e => onPick(s.settleDate, e.target.checked)} /></td>
            <td className="font-medium">{dmy(s.settleDate)}</td>
            <td className="text-right">{s.count}</td>
            <td className="text-right">{rm(s.gross)}</td>
            <td className="text-right text-rose-600">{rm(s.fee)}</td>
            <td className="text-right text-xs text-slate-500">{s.gross ? (s.fee / s.gross * 100).toFixed(2) + '%' : ''}</td>
            <td className="text-right font-semibold">{rm(s.net)}</td>
            <td className="whitespace-nowrap text-right text-xs">
              {s.posted && !bookedDiffers(s) && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-4" />{s.result === 'ok' ? 'Posted' : 'Already in'}</span>}
              {s.posted && bookedDiffers(s) && <span className="text-amber-700" title="The entry already in the books for this day has different figures">
                Already in as {rm(s.booked!.gross)} / fee {rm(s.booked!.fee)} / bank {rm(s.booked!.net)}</span>}
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
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

const FILE_LABEL: Record<FileKind, string> = { bill: 'Bill Summary', items: 'Product Sales', fiuu: 'Fiuu listing' }

// The daily close: drop the Bill Summary, the Product Sales file and the Fiuu listing
// together, review one table, press Post once. Posting is exactly what the three
// separate screens did: sales (or replace) then cost of sales per day, then payouts.
export function UploadSales({ role }: { role: Role }) {
  const [days, setDays] = useState<Day[]>([])
  const [items, setItems] = useState<ItemSale[]>([])
  const [rows, setRows] = useState<Settlement[]>([])
  const [takings, setTakings] = useState<{ date: string; gross: number }[]>([])
  const [inBooks, setInBooks] = useState<Record<string, number>>({})
  const [info, setInfo] = useState({ pending: 0, skipped: 0 })
  const [files, setFiles] = useState<Partial<Record<FileKind, string>>>({})
  const [pick, setPick] = useState<Record<string, boolean>>({})
  const [pickPay, setPickPay] = useState<Record<string, boolean>>({})
  const [replace, setReplace] = useState<Record<string, boolean>>({})
  const [bank, setBank] = useState('1100')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [costs, setCosts] = useState<Record<string, number>>({})
  const [accountNames, setAccountNames] = useState<Record<string, string>>({})
  const accounts = useAccounts()

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

  async function loadBill(sheet: unknown) {
    const parsed = parseBillSummary(sheet)
    const { data } = await supabase.from('journals').select('source_ref').eq('source', 'sales')
      .in('source_ref', parsed.map(d => d.date))
    const already = new Set((data ?? []).map(r => r.source_ref))
    const withStatus = parsed.map(d => ({ ...d, posted: already.has(d.date) }))
    setDays(withStatus); setReplace({})
    setPick(Object.fromEntries(withStatus.filter(d => !d.posted && !daySuspect(d)).map(d => [d.date, true])))
  }

  async function loadItems(sheet: unknown) {
    const parsed = parseProductSales(sheet)
    setItems(parsed)
    // Remember the items, so their cost can be filled in on the Item Costs screen.
    const seen = new Map<string, { code: string; name: string; date: string }>()
    for (const i of parsed) seen.set(i.code.toUpperCase(), { code: i.code, name: i.name, date: i.date })
    const { error } = await supabase.rpc('note_items', { p_items: [...seen.values()] })
    if (error) console.error('note_items', error)
  }

  async function loadFiuu(sheet: unknown) {
    const r = await loadFiuuFile(sheet)
    setRows(r.list); setTakings(r.takings); setInBooks(r.inBooks); setInfo(r.info)
    setPickPay(Object.fromEntries(r.list.filter(s => !s.posted).map(s => [s.settleDate, true])))
  }

  // Any mix of the three exports, in any order. A kind dropped twice is replaced.
  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0 || busy) return
    const problems: string[] = []
    setBusy(true)
    try {
      for (const file of Array.from(list)) {
        try {
          const sheet = await readXlsxFile(file)
          const kind = detectFile(sheet)
          if (kind === 'bill') await loadBill(sheet)
          else if (kind === 'items') await loadItems(sheet)
          else if (kind === 'fiuu') await loadFiuu(sheet)
          else { problems.push(`${file.name}: not a Zeoniq Bill Summary, Product Sales or Fiuu listing`); continue }
          setFiles(f => ({ ...f, [kind]: file.name }))
        } catch (err) { problems.push(`${file.name}: ${(err as Error).message}`) }
      }
      setError(problems.join(' — '))
    } finally { setBusy(false) }
  }

  function removeFile(kind: FileKind) {
    setError('')
    setFiles(f => { const next = { ...f }; delete next[kind]; return next })
    if (kind === 'bill') { setDays([]); setPick({}); setReplace({}) }
    if (kind === 'items') setItems([])
    if (kind === 'fiuu') { setRows([]); setTakings([]); setInBooks({}); setInfo({ pending: 0, skipped: 0 }); setPickPay({}) }
  }

  // Cost of sales for a day, posted (or posted again) alongside it.
  async function postCogs(d: Day) {
    const cogs = cogsFor(d)
    if (!cogs || cogs.lines.length === 0) return null
    const { error } = await supabase.rpc('post_cogs_day', { p_date: d.date, p_lines: cogs.lines })
    if (error) console.error('post_cogs_day', d.date, error)
    return error ? `saved, but cost of sales failed: ${error.message}` : null
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
      const costError = error ? null : await postCogs(d)
      out.push({ ...d, result: error ? error.message : costError ?? 'split' })
    }
    setDays(out); setBusy(false)
    const failed = out.filter(d => d.result && !['ok', 'split'].includes(d.result))
    setError(failed.length ? failed.map(d => `${dmy(d.date)}: ${d.result}`).join(' — ') : '')
  }

  // One button: ticked days (sales then cost of sales), then ticked payouts.
  async function postAll() {
    setBusy(true); setError('')
    const out: Day[] = []
    for (const d of days) {
      const willReplace = d.posted && role === 'owner' && replace[d.date]
      if (!willReplace && (!pick[d.date] || d.posted)) { out.push(d); continue }
      const split = splitFor(d)
      const usable = split && split.unknown.length === 0 && Math.abs(split.diff) <= 0.05 && split.lines.length > 0
      const rpc = d.posted ? 'replace_sales_day' : 'post_sales_day'
      const { error } = await supabase.rpc(rpc, {
        p_date: d.date, p_sales: d.sales, p_service: d.service, p_tax: d.tax, p_rounding: d.rounding,
        p_payments: d.payments,
        p_sales_lines: usable ? split.lines.map(l => ({ account: l.account, amount: l.amount })) : null,
      })
      if (error) console.error(rpc, d.date, error)
      const costError = error ? null : await postCogs(d)
      out.push({ ...d, posted: !error, result: error ? error.message : costError ?? 'ok' })
    }
    setDays(out); setReplace({})
    const payOut = await postSettlements(rows, pickPay, bank)
    setRows(payOut)
    if (takings.length) setInBooks(await bookedCard(takings.map(t => t.date)))
    setBusy(false)
    const failed = [
      ...out.filter(d => d.result && !['ok', 'split', 'cost'].includes(d.result)).map(d => `${dmy(d.date)}: ${d.result}`),
      ...payOut.filter(s => pickPay[s.settleDate] && s.result && s.result !== 'ok').map(s => `Payout ${dmy(s.settleDate)}: ${s.result}`),
    ]
    setError(failed.join(' — '))
  }

  const chosen = days.filter(d => pick[d.date] && !d.posted)
  const replacing = role === 'owner' ? days.filter(d => d.posted && replace[d.date]) : []
  const chosenPay = rows.filter(s => pickPay[s.settleDate] && !s.posted)
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
  const dayCount = chosen.length + replacing.length
  const postLabel = [dayCount > 0 && `${dayCount} day${dayCount === 1 ? '' : 's'}`, chosenPay.length > 0 && `${chosenPay.length} payout${chosenPay.length === 1 ? '' : 's'}`]
    .filter(Boolean).join(' and ')
  const loadedKinds = (Object.keys(FILE_LABEL) as FileKind[]).filter(k => files[k])
  const fiuuParts = [
    info.pending > 0 && `${info.pending} payment(s) not settled yet`,
    info.skipped > 0 && `${info.skipped} row(s) not in "settled" status skipped`,
    rows.length > 0 && `${rows.length} payout(s)`,
  ].filter(Boolean)
  const fiuuNote = rows.length === 0 && info.pending === 0 ? ['no settled payouts in this file', ...fiuuParts] : fiuuParts

  return (
    <div className="space-y-4">
      <div className="card">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-10 text-center hover:border-brand"
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files) }}>
          <CloudUpload className="size-8 text-slate-400" />
          <span className="font-medium">Drop the day's files here, or click to choose</span>
          <span className="muted">Zeoniq Bill Summary, Zeoniq Product Sales and the Fiuu transaction listing — any of them, together or one at a time (.xlsx)</span>
          <input type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
        </label>
        {loadedKinds.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {loadedKinds.map(k => (
              <span key={k} className="badge gap-1">{FILE_LABEL[k]}: {files[k]}
                <button type="button" title="Remove this file" aria-label={`Remove ${FILE_LABEL[k]}`} className="ml-1 rounded hover:text-red-600 disabled:opacity-50" disabled={busy} onClick={() => removeFile(k)}><X className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        {files.fiuu && <p className="muted mt-2">Fiuu: {fiuuNote.join(' · ')}</p>}
        <p className="muted mt-2 text-center">Export the two Zeoniq reports with the same date range and the same status filter, or the split will not match.</p>
      </div>
      {error && <p className="alert-error">{error}</p>}

      {days.length > 0 && (
        <>
          <div className="card overflow-x-auto p-0">
            <table>
              <thead><tr>
                <th className="w-10"></th><th>Date</th><th className="text-right">Sales</th><th className="text-right">Service charge</th>
                <th className="text-right">Tax</th><th className="text-right">Rounding</th><th className="text-right">Day total</th>
                <th>Payments</th><th>Split</th><th className="text-right">Cost of sales</th>
                {role === 'owner' && <th className="w-16">Replace</th>}<th></th>
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
                      {role === 'owner' && <td className="text-center">
                        {d.posted && <input type="checkbox" checked={!!replace[d.date]}
                          onChange={e => setReplace({ ...replace, [d.date]: e.target.checked })} />}
                      </td>}
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
          {replacing.some(d => { const cogs = cogsFor(d); return !cogs || cogs.lines.length === 0 }) && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
              <TriangleAlert className="size-4 shrink-0" />
              Replacing a day also removes its cost of sales. Load the Product Sales file too, or that day
              will show sales with no cost against it until you re-split.
            </p>
          )}
        </>
      )}

      {rows.length > 0 && (
        <div className="card p-0">
          <div className="flex flex-wrap items-end gap-3 p-4">
            <h3 className="font-semibold">Card payouts</h3>
            <div className="w-56"><label>Money paid into</label>
              <AccountSelect accounts={accounts} value={bank} onChange={setBank} filter={a => MONEY_ACCOUNTS.includes(a.code)} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <PayoutRows rows={rows} pick={pickPay} onPick={(date, on) => setPickPay({ ...pickPay, [date]: on })} />
          </div>
        </div>
      )}

      {(days.length > 0 || rows.length > 0) && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="muted">
              {dayCount > 0 && `${dayCount} day${dayCount === 1 ? '' : 's'} ready · ${rm([...chosen, ...replacing].reduce((s, d) => s + d.netTotal, 0))}`}
              {dayCount > 0 && chosenPay.length > 0 && ' · '}
              {chosenPay.length > 0 && `${chosenPay.length} payout${chosenPay.length === 1 ? '' : 's'} · ${rm(chosenPay.reduce((s, r) => s + r.net, 0))} into the bank`}
            </p>
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
              <button className="btn" disabled={busy || !postLabel} onClick={postAll}>
                {busy ? 'Posting…' : postLabel ? `Post ${postLabel}` : 'Nothing to post'}
              </button>
            </div>
          </div>
          {splittable.length > 0 && <p className="muted">Days already posted can take the split now — tick them and press <b>Re-split</b>. Only the sales lines change; payments, service charge and rounding stay as they are.</p>}
          <FiuuCheck takings={takings} inBooks={inBooks} />
          <p className="muted">Each day becomes one entry: money in by payment type, sales and service charge as income. Cost of sales is posted as its own entry per day, from quantity sold times cost per unit (fill in costs on <b>Item Costs</b>). Each payout moves money out of 1200 Fiuu Card into the bank and books the fee to 6200.</p>
          <p className="muted">A day already posted cannot go in twice. The owner can tick <b>Replace</b> to swap the old entry for the new one.</p>
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
      const r = await loadFiuuFile(await readXlsxFile(file))
      setRows(r.list); setTakings(r.takings); setInBooks(r.inBooks); setInfo(r.info)
      setPick(Object.fromEntries(r.list.filter(s => !s.posted).map(s => [s.settleDate, true])))
    } catch (err) { setError((err as Error).message) }
  }

  async function post() {
    setBusy(true)
    const out = await postSettlements(rows, pick, bank)
    setRows(out); setBusy(false)
    const failed = out.filter(s => s.result && s.result !== 'ok')
    setError(failed.length ? failed.map(s => `${dmy(s.settleDate)}: ${s.result}`).join(' — ') : '')
  }

  const chosen = rows.filter(s => pick[s.settleDate] && !s.posted)
  return (
    <div className="space-y-4">
      <div className="card">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-10 text-center hover:border-brand">
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
            <PayoutRows rows={rows} pick={pick} onPick={(date, on) => setPick({ ...pick, [date]: on })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="muted">{chosen.length} payout{chosen.length === 1 ? '' : 's'} ready · {rm(chosen.reduce((s, r) => s + r.net, 0))} into the bank</p>
            <button className="btn ml-auto" disabled={busy || chosen.length === 0} onClick={post}>
              {busy ? 'Posting…' : `Post ${chosen.length} payout${chosen.length === 1 ? '' : 's'}`}
            </button>
          </div>
          <FiuuCheck takings={takings} inBooks={inBooks} />
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
    if (!await confirmDialog({ title: `Remove ${code}?`, body: 'Files containing it will not import until it is added back.', confirmLabel: 'Remove', danger: true })) return
    await supabase.from('payment_map').delete().eq('code', code); load()
  }
  async function setSetting(key: string, value: string) {
    const { error } = await supabase.from('sales_settings').update({ [key]: value }).eq('id', 1)
    setMsg(error ? error.message : ''); load()
  }

  const SETTINGS: [string, string][] = [
    ['sales_account', 'Sales'], ['service_account', 'Service charge'], ['tax_account', 'SST'],
    ['rounding_account', 'Rounding (Adj. Amount)'],
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
                <td className="w-72"><AccountSelect accounts={accounts} value={r.account} onChange={v => setAccount(r.code, v)} disabled={!canEdit} /></td>
                <td className="text-right">{canEdit && <button title="Remove" className="btn-ghost px-1.5 hover:bg-red-50 hover:text-red-600" onClick={() => remove(r.code)}><Trash2 className="size-4" /></button>}</td>
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
    if (!await confirmDialog({ title: `Remove ${prefix}?`, confirmLabel: 'Remove', danger: true })) return
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
              <td className="w-72"><AccountSelect accounts={accounts} value={r.account} onChange={v => setAccount(r.prefix, v)} filter={a => a.type === 'income'} disabled={!canEdit} /></td>
              <td className="text-right">{canEdit && <button title="Remove" className="btn-ghost px-1.5 hover:bg-red-50 hover:text-red-600" onClick={() => remove(r.prefix)}><Trash2 className="size-4" /></button>}</td>
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
