# UX Slice C: Daily Close and Tick-to-Pay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Upload screen takes the Bill Summary, Product Sales and Fiuu files in one drop and posts days and payouts with one button; Pay suppliers fills amounts by ticking invoices.

**Architecture:** A pure `detectFile()` in `zeoniq.ts` names a dropped file's kind. `UploadSales` in `Sales.tsx` is rewritten around three loaders (`loadBill`, `loadItems`, `loadFiuu`) and one `postAll()`; the Fiuu load/post code becomes two module-level helpers and a `FiuuCheck` component shared with the unchanged `CardSettlement` screen. `SupplierPayments` gains a checkbox column driven by the existing `pay` state.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `read-excel-file/browser`, Node assert tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-19-daily-close-design.md`.
- No new npm packages, no SQL, no route changes. Every RPC call keeps its name and arguments exactly as in the current `Sales.tsx` and `Purchase.tsx`.
- Posting order and rules unchanged: sales (or replace) then cost of sales per day; split used only when `unknown.length === 0 && |diff| <= 0.05 && lines.length > 0`; Replace owner-only.
- Every task ends with `npx tsc -b`, `npx oxlint` (warnings only) and `npm run build` passing in `web/` (plus the named test script), then one commit on branch `ux-daily` ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `web/src/zeoniq.ts` | `FileKind`, `detectFile()` |
| `web/dashboard-test.mjs` | `detectFile` asserts |
| `web/src/pages/Sales.tsx` | `loadFiuuFile`, `postSettlements`, `FiuuCheck`, rewritten `UploadSales`, slimmer `CardSettlement` |
| `web/src/pages/Purchase.tsx` | checkbox column in `SupplierPayments` |
| `README.md` | two notes |

---

### Task 1: `detectFile`

**Files:**
- Modify: `web/src/zeoniq.ts` (append after `toRows`)
- Modify: `web/dashboard-test.mjs` (append after the todo block)

**Interfaces:**
- Produces `export type FileKind = 'bill' | 'items' | 'fiuu'` and `export function detectFile(input: unknown): FileKind | null`.

- [ ] **Step 1: Branch**

```bash
cd "C:/Users/DELL/Documents/DYRB Accounting" && git checkout -b ux-daily master
```

- [ ] **Step 2: Write the failing test**

Append to `web/dashboard-test.mjs`:

```js
// --- which export is this file? ---
const { detectFile } = await import('./src/zeoniq.ts')
const billRows = [['Bill Summary Listing'], [], ['Business Date', 'Net Sales', 'Charges', 'Tax', 'Adj. Amount', 'Net Total', 'CASH', 'VISA'], ['21/9/2026', 1000, 100, 0, 0, 1100, 500, 600]]
const itemRows = [['Product Sales Listing'], ['Business Date', 'Net Sales', 'Item Qty', 'Net Total'], ['', 'Item: AC01-CARLSBERG'], ['21/9/2026', 120, 6, 120]]
const fiuuRows = [['Date', 'Settlement Date', 'Bill Amt', 'Transaction Fee', 'Net Amount', 'Status', 'Channel'], ['21-09-2026 20:10:00', '23-09-2026 09:00:00', 100, 1.5, 98.5, 'settled', 'VISA']]
assert.equal(detectFile(billRows), 'bill')
assert.equal(detectFile(itemRows), 'items', 'Item: rows win even with a Net Total column')
assert.equal(detectFile(fiuuRows), 'fiuu')
assert.equal(detectFile([['Something'], ['else', 1]]), null, 'no Business Date, no Settlement Date')
assert.equal(detectFile([['Business Date', 'Net Sales'], ['21/9/2026', 5]]), null, 'Business Date alone is not enough')
assert.equal(detectFile([{ data: billRows }]), 'bill', 'per-sheet wrapper shape')
console.log('detect file ok')
```

- [ ] **Step 3: Run to see it fail**

Run in `web/`: `npm run test:dash`
Expected: fails with `detectFile is not a function`.

- [ ] **Step 4: Implement**

Append to `web/src/zeoniq.ts` right after `toRows`:

```ts
// ---- Which export is this? The daily close takes all three in one drop. ----
export type FileKind = 'bill' | 'items' | 'fiuu'

// Fiuu listings carry Settlement Date and Bill Amt on the first row. Both Zeoniq
// exports have a Business Date header; the Product Sales one is told apart by its
// "Item:" group rows (it also has a Net Total column, so that test comes last).
export function detectFile(input: unknown): FileKind | null {
  const rows = toRows(input)
  const cell = (v: unknown) => String(v ?? '').trim()
  const first = (rows[0] ?? []).map(cell)
  if (first.includes('Settlement Date') && first.includes('Bill Amt')) return 'fiuu'
  const headIndex = rows.findIndex(r => r.some(c => cell(c) === 'Business Date'))
  if (headIndex < 0) return null
  if (rows.slice(headIndex + 1).some(r => cell(r[1]).startsWith('Item:'))) return 'items'
  if (rows[headIndex].map(cell).includes('Net Total')) return 'bill'
  return null
}
```

- [ ] **Step 5: Run the test, build, commit**

Run in `web/`: `npm run test:dash && npx tsc -b && npx oxlint && npm run build`
Expected: `detect file ok`.

```bash
git add web/src/zeoniq.ts web/dashboard-test.mjs
git commit -m "feat: detectFile tells the three daily exports apart

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Daily close on the Upload screen

**Files:**
- Modify: `web/src/pages/Sales.tsx` (`UploadSales` rewritten; `CardSettlement` uses the shared helpers; `SalesSettings`/`ItemCategories` untouched)

**Interfaces:**
- Consumes `detectFile`, `FileKind`, the existing parsers, `cogsLinesFor`, `salesLinesFor`, `daySuspect`, `dayTotal`, `paymentTotal`; `toast` is not needed (the screen keeps its inline error box and row results).
- Produces module-level `loadFiuuFile(rows)`, `postSettlements(rows, pick, bank)`, `FiuuCheck`.

- [ ] **Step 1: Shared Fiuu helpers**

Add to the imports of `Sales.tsx`: `detectFile, type FileKind` from `../zeoniq`, and `X` from `lucide-react`. Insert these three definitions above `export function UploadSales`:

```tsx
// Reads a Fiuu listing: settlements with their posted flag, takings per sale day, and
// what the POS already booked to 1200 on those days. Shared by the daily close and the
// stand-alone Card settlement screen.
async function loadFiuuFile(rows: unknown) {
  const parsed = parseFiuu(rows)
  const { data } = await supabase.from('journals').select('source_ref').eq('source', 'fiuu')
    .in('source_ref', parsed.settlements.map(s => s.settleDate))
  const already = new Set((data ?? []).map(r => r.source_ref))
  const list: Settlement[] = parsed.settlements.map(s => ({ ...s, posted: already.has(s.settleDate) }))
  const inBooks: Record<string, number> = {}
  const dates = parsed.takings.map(t => t.date)
  if (dates.length) {
    const { data: lines } = await supabase.from('journal_lines')
      .select('debit, journals!inner(date, source)')
      .eq('account', '1200').eq('journals.source', 'sales')
      .gte('journals.date', dates[0]).lte('journals.date', dates[dates.length - 1])
    for (const l of (lines ?? []) as unknown as { debit: number; journals: { date: string } }[]) {
      inBooks[l.journals.date] = round2((inBooks[l.journals.date] ?? 0) + Number(l.debit))
    }
  }
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
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 2: Rewrite `UploadSales`**

Replace the whole `UploadSales` function with:

```tsx
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
    if (!list || list.length === 0) return
    const problems: string[] = []
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
  }

  function removeFile(kind: FileKind) {
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
    setRows(payOut); setBusy(false)
    const failed = [
      ...out.filter(d => d.result && d.result !== 'ok').map(d => `${dmy(d.date)}: ${d.result}`),
      ...payOut.filter(s => s.result && s.result !== 'ok').map(s => `Payout ${dmy(s.settleDate)}: ${s.result}`),
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
                <button type="button" title="Remove this file" className="ml-1 rounded hover:text-red-600" onClick={() => removeFile(k)}><X className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
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
            <p className="muted">{info.pending > 0 && `${info.pending} payment(s) not settled yet. `}{info.skipped > 0 && `${info.skipped} row(s) not in "settled" status were skipped.`}</p>
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
```

- [ ] **Step 3: Slim `CardSettlement`**

In `CardSettlement`, replace the body of `onFile` with:

```tsx
  async function onFile(file: File) {
    setError(''); setRows([]); setFileName(file.name)
    try {
      const r = await loadFiuuFile(await readXlsxFile(file))
      setRows(r.list); setTakings(r.takings); setInBooks(r.inBooks); setInfo(r.info)
      setPick(Object.fromEntries(r.list.filter(s => !s.posted).map(s => [s.settleDate, true])))
    } catch (err) { setError((err as Error).message) }
  }
```

and `post` with:

```tsx
  async function post() {
    setBusy(true)
    const out = await postSettlements(rows, pick, bank)
    setRows(out); setBusy(false)
    const failed = out.filter(s => s.result && s.result !== 'ok')
    setError(failed.length ? failed.map(s => `${dmy(s.settleDate)}: ${s.result}`).join(' — ') : '')
  }
```

Replace its payouts `<table>…</table>` with `<PayoutRows rows={rows} pick={pick} onPick={(date, on) => setPick({ ...pick, [date]: on })} />` and its "Check only" card with `<FiuuCheck takings={takings} inBooks={inBooks} />`. Everything else in `CardSettlement` stays.

- [ ] **Step 4: Build, lint, commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`. Then `grep -n "rpc('" web/src/pages/Sales.tsx` must list exactly these RPC names and no others: `note_items`, `post_cogs_day` (twice), `resplit_sales_day`, `post_fiuu_settlement`, and the `rpc` variable call for `post_sales_day` / `replace_sales_day`.

```bash
git add web/src/pages/Sales.tsx
git commit -m "feat: daily close — drop all three files at once, one Post for days and payouts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Tick invoices to pay, README

**Files:**
- Modify: `web/src/pages/Purchase.tsx` (`SupplierPayments` table)
- Modify: `README.md`

- [ ] **Step 1: Checkbox column**

In `SupplierPayments`, the header row becomes:

```tsx
              <thead><tr><th className="w-10 pl-6"></th><th>Doc No</th><th>Inv no.</th><th>Date</th><th>Due</th><th className="text-right">Outstanding</th><th className="w-40 pr-6 text-right">Pay now</th></tr></thead>
```

Each invoice row gains a first cell and the Doc No cell loses its `pl-6`:

```tsx
                  <tr key={i.id}>
                    <td className="pl-6"><input type="checkbox" checked={Number(pay[i.id] ?? 0) > 0}
                      onChange={e => setPay({ ...pay, [i.id]: e.target.checked ? String(owingOn(i)) : '' })} /></td>
                    <td className="font-mono text-xs">{i.doc_no}</td><td>{i.invoice_no}</td>
```

The totals row's first cell becomes `<td className="pl-6" colSpan={5}>` (it was `colSpan={4}`), keeping the "Pay all in full" button.

- [ ] **Step 2: README**

Under "Everyday notes" add:

```markdown
- **Daily close:** on Sales › Upload, drop the Zeoniq Bill Summary, the Zeoniq Product Sales file and the Fiuu listing together (or one at a time). The screen works out which is which, shows every day and payout, and one **Post** button posts them all. Remove a file with the × on its chip.
- **Paying suppliers:** tick the invoices to pay and the full amount fills in; type a smaller figure for a part payment.
```

- [ ] **Step 3: Build, lint, commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`

```bash
git add web/src/pages/Purchase.tsx README.md
git commit -m "feat: tick invoices to pay them in full

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Final verification

Run in `web/`: `npm run test:dash && npm run test:ui && npm run test:db && npm run test:rls && npx tsc -b && npx oxlint && npm run build`. The controller runs the whole-branch review, merges `ux-daily` into `master` and pushes. No SQL to run.

---

## Self-review

**Spec coverage:** detection rules and order (Task 1, each rule asserted incl. the wrapper shape and the `Net Total` trap); one drop zone with `multiple`, drag-and-drop, per-file errors, chips with × (Task 2); days table unchanged; payouts card with bank picker and note; single Post with the three label forms and the posting order; secondary buttons; check table; shared helpers and `FiuuCheck`/`PayoutRows` used by `CardSettlement` (Task 2); checkbox column, untick clears, part payment keeps the tick, Pay all (Task 3); README (Task 3).

**Placeholders:** none.

**Type consistency:** `detectFile(input: unknown): FileKind | null` used with the raw `readXlsxFile` result in `onFiles`; `loadFiuuFile(rows: unknown)` returns `{ list: Settlement[], takings, inBooks, info }`, consumed identically in both screens; `postSettlements(rows, pick, bank)` returns `Settlement[]`; `PayoutRows.onPick(date, on)`; `owingOn(i)` already exists in `SupplierPayments`.
