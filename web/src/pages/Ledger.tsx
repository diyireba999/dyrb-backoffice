import { useEffect, useState } from 'react'
import { CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { MONEY_ACCOUNTS, accountTotals, addDays, dmy, downloadCsv, monthStart, postJournal, rm, round2, supabase, todayMY, useAccounts, useSuppliers, type Account, type Role } from '../lib'
import { AccountSelect, Done, Empty, ReportBar } from '../ui'

const TYPE_LABEL: Record<Account['type'], string> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense' }
// Assets and expenses grow on the debit side; the rest grow on the credit side.
const debitNormal = (t: Account['type']) => t === 'asset' || t === 'expense'


export function ChartOfAccounts({ role }: { role: Role }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [bal, setBal] = useState<Map<string, number>>(new Map())
  useEffect(() => { accountTotals(null, todayMY()).then(setBal) }, [])
  const [f, setF] = useState({ code: '', name: '', type: 'expense' as Account['type'] })
  const [error, setError] = useState('')
  const canEdit = role === 'owner' || role === 'accountant'
  const load = () => { supabase.from('accounts').select('*').order('code').then(({ data }) => setAccounts(data ?? [])) }
  useEffect(load, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('accounts').insert(f)
    if (error) return setError(error.message.includes('duplicate') ? 'That account code already exists' : error.message)
    setF({ ...f, code: '', name: '' }); setError(''); load()
  }
  async function update(code: string, patch: Partial<Account>) {
    const { error } = await supabase.from('accounts').update(patch).eq('code', code)
    if (error) alert(error.message)
    load()
  }

  const balanceOf = (a: Account) => {
    const net = bal.get(a.code) ?? 0
    return debitNormal(a.type) ? net : -net
  }
  const csv = () => downloadCsv('chart-of-accounts.csv', [['Code', 'Name', 'Type', 'Balance', 'Active'],
    ...accounts.map(a => [a.code, a.name, TYPE_LABEL[a.type], round2(balanceOf(a)), a.active ? 'Yes' : 'No'])])

  return (
    <div className="space-y-6">
      {canEdit && (
        <form onSubmit={add} className="no-print card grid items-end gap-4 sm:grid-cols-[8rem_1fr_10rem_auto]">
          <div><label>Code</label><input value={f.code} onChange={e => setF({ ...f, code: e.target.value.trim() })} placeholder="e.g. 6450" required pattern="\d{4}" title="4 digits" /></div>
          <div><label>Account name</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></div>
          <div><label>Type</label>
            <select value={f.type} onChange={e => setF({ ...f, type: e.target.value as Account['type'] })}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <button className="btn"><Plus className="size-4" />Add account</button>
          {error && <p className="alert-error sm:col-span-4">{error}</p>}
        </form>
      )}
      <ReportBar title="Chart of Accounts" period={`As at ${dmy(todayMY())}`} onCsv={csv} />
      <div className="card overflow-x-auto p-0">
        <table>
          <thead><tr><th className="w-20">Code</th><th>Account name</th><th>Type</th><th className="text-right">Balance</th><th className="no-print w-24 text-center">Active</th></tr></thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.code} className={a.active ? '' : 'text-slate-400'}>
                <td className="font-mono text-xs">{a.code}</td>
                <td>{canEdit
                  ? <input className="h-8 border-transparent shadow-none hover:border-slate-300" defaultValue={a.name}
                      onBlur={e => e.target.value !== a.name && update(a.code, { name: e.target.value })} />
                  : a.name}</td>
                <td><span className="badge">{TYPE_LABEL[a.type]}</span></td>
                <td className="text-right">{rm(balanceOf(a))}</td>
                <td className="no-print text-center">
                  <input type="checkbox" className="size-4 h-4 w-4" checked={a.active} disabled={!canEdit} onChange={e => update(a.code, { active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type JvLine = { account: string; memo: string; debit: string; credit: string }
const emptyLine = (): JvLine => ({ account: '', memo: '', debit: '', credit: '' })

export function JournalEntry() {
  const accounts = useAccounts()
  const { list: suppliers } = useSuppliers()
  const [head, setHead] = useState({ date: todayMY(), description: '', reference: '', supplier: '' })
  const [lines, setLines] = useState<JvLine[]>([emptyLine(), emptyLine()])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState('')

  const setLine = (i: number, patch: Partial<JvLine>) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l))
  const dr = round2(lines.reduce((s, l) => s + Number(l.debit || 0), 0))
  const cr = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0))
  const balanced = dr > 0 && dr === cr
  const needsSupplier = lines.some(l => l.account === '2000')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const used = lines.filter(l => l.account && (Number(l.debit) || Number(l.credit)))
    if (used.some(l => Number(l.debit) && Number(l.credit))) return setError('Each line is either debit or credit, not both')
    if (!balanced) return setError('Total debit must equal total credit')
    setBusy(true); setError('')
    try {
      const id = await postJournal(head.date, head.description, used.map(l => ({
        account: l.account, memo: l.memo || undefined,
        ...(Number(l.debit) ? { debit: round2(Number(l.debit)) } : { credit: round2(Number(l.credit)) }),
      })), { source: 'jv', reference: head.reference, supplier: head.supplier ? Number(head.supplier) : undefined })
      const { data } = await supabase.from('journals').select('doc_no').eq('id', id).single()
      setDone(data?.doc_no ?? '')
      setHead({ ...head, description: '', reference: '', supplier: '' }); setLines([emptyLine(), emptyLine()])
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (done !== null) return <Done msg="Journal entry saved" doc={done} again={() => setDone(null)} />
  return (
    <form onSubmit={submit} className="card space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div><label>Date</label><input type="date" value={head.date} onChange={e => setHead({ ...head, date: e.target.value })} required /></div>
        <div className="sm:col-span-2"><label>Description</label><input value={head.description} onChange={e => setHead({ ...head, description: e.target.value })} placeholder="e.g. Depreciation September" required /></div>
        <div><label>Ref no.</label><input value={head.reference} onChange={e => setHead({ ...head, reference: e.target.value })} placeholder="Optional" /></div>
        {needsSupplier && <div className="sm:col-span-2"><label>Supplier (for Suppliers Owed line)</label>
          <select value={head.supplier} onChange={e => setHead({ ...head, supplier: e.target.value })} required>
            <option value="">— choose —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>}
      </div>
      <div className="-mx-6 overflow-x-auto">
        <table>
          <thead><tr><th className="pl-6">Account</th><th>Line description</th><th className="w-36 text-right">Debit</th><th className="w-36 text-right">Credit</th><th className="w-10 pr-6"></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="min-w-56 pl-6"><AccountSelect accounts={accounts} value={l.account} onChange={v => setLine(i, { account: v })} required={false} /></td>
                <td className="min-w-40"><input value={l.memo} onChange={e => setLine(i, { memo: e.target.value })} /></td>
                <td><input className="text-right" type="number" step="0.01" min="0" inputMode="decimal" value={l.debit} onChange={e => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                <td><input className="text-right" type="number" step="0.01" min="0" inputMode="decimal" value={l.credit} onChange={e => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                <td className="pr-6">{lines.length > 2 && <button type="button" title="Remove line" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td className="pl-6"><button type="button" className="link inline-flex items-center gap-1" onClick={() => setLines([...lines, emptyLine()])}><Plus className="size-4" />Add line</button></td>
              <td className="text-right text-slate-500">Total</td>
              <td className="text-right">{rm(dr)}</td>
              <td className="text-right">{rm(cr)}</td>
              <td className="pr-6"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`text-sm font-medium ${balanced ? 'text-emerald-600' : 'text-amber-600'}`}>
          {balanced ? 'Balanced' : dr + cr === 0 ? 'Enter debit and credit amounts' : `Out of balance by ${rm(Math.abs(dr - cr))}`}
        </span>
        <button className="btn" disabled={busy || !balanced}>{busy ? 'Saving…' : 'Save journal'}</button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </form>
  )
}

type LedgerLine = {
  id: number; debit: number; credit: number; memo: string | null; cleared_on: string | null
  journals: { date: string; doc_no: string; description: string; reference: string | null }
}

async function fetchLines(account: string, from: string | null, to: string, openOn?: string) {
  let q = supabase.from('journal_lines')
    .select('id, debit, credit, memo, cleared_on, journals!inner(date, doc_no, description, reference)')
    .eq('account', account).lte('journals.date', to)
  if (from) q = q.gte('journals.date', from)
  if (openOn) q = q.or(`cleared_on.is.null,cleared_on.eq.${openOn}`)
  const { data } = await q
  return ((data as unknown as LedgerLine[]) ?? [])
    .sort((a, b) => a.journals.date.localeCompare(b.journals.date) || a.journals.doc_no.localeCompare(b.journals.doc_no))
}

// General ledger for one account; with moneyOnly it is the Cash Book (cash and bank accounts).
export function AccountLedger({ moneyOnly = false }: { moneyOnly?: boolean }) {
  const accounts = useAccounts()
  const [code, setCode] = useState(moneyOnly ? '1100' : '')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayMY())
  const [opening, setOpening] = useState(0)
  const [lines, setLines] = useState<LedgerLine[]>([])
  const acct = accounts.find(a => a.code === code)
  const sign = acct && !debitNormal(acct.type) ? -1 : 1

  useEffect(() => {
    if (!code) return
    accountTotals(null, addDays(from, -1)).then(m => setOpening(m.get(code) ?? 0))
    fetchLines(code, from, to).then(setLines)
  }, [code, from, to])

  const rows = lines.reduce<(LedgerLine & { balance: number })[]>((acc, l) =>
    [...acc, { ...l, balance: (acc.at(-1)?.balance ?? opening) + Number(l.debit) - Number(l.credit) }], [])
  const closing = rows.at(-1)?.balance ?? opening
  const totalDr = lines.reduce((s, l) => s + Number(l.debit), 0)
  const totalCr = lines.reduce((s, l) => s + Number(l.credit), 0)
  const title = moneyOnly ? 'Cash Book' : 'General Ledger'
  const csv = () => downloadCsv(`${title.toLowerCase().replace(' ', '-')}-${code}-${from}-${to}.csv`, [
    ['Date', 'Doc No', 'Description', 'Ref', 'Debit', 'Credit', 'Balance'],
    ['', '', 'Opening balance', '', '', '', round2(sign * opening)],
    ...rows.map(r => [dmy(r.journals.date), r.journals.doc_no, r.memo || r.journals.description, r.journals.reference ?? '', r.debit || '', r.credit || '', round2(sign * r.balance)]),
  ])

  return (
    <div className="space-y-4">
      <ReportBar title={`${title}: ${acct ? `${acct.code} ${acct.name}` : ''}`} period={`${dmy(from)} to ${dmy(to)}`} onCsv={code ? csv : undefined}>
        <div className="w-72"><label>Account</label>
          <AccountSelect accounts={accounts} value={code} onChange={setCode} filter={moneyOnly ? a => MONEY_ACCOUNTS.includes(a.code) || a.code === '1200' || a.code === '1210' : undefined} />
        </div>
        <div className="w-40"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="w-40"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </ReportBar>
      <div className="card overflow-x-auto p-0">
        {!code && <Empty text="Choose an account." />}
        {code && (
          <table>
            <thead><tr><th className="w-24">Date</th><th className="w-28">Doc No</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              <tr className="bg-slate-50/60"><td></td><td></td><td className="font-medium">Opening balance</td><td></td><td></td><td className="text-right font-medium">{rm(sign * opening)}</td></tr>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="text-slate-500">{dmy(r.journals.date)}</td>
                  <td className="font-mono text-xs">{r.journals.doc_no}</td>
                  <td>{r.memo || r.journals.description}{r.journals.reference && <span className="text-xs text-slate-500"> · Ref {r.journals.reference}</span>}</td>
                  <td className="text-right">{Number(r.debit) ? rm(r.debit) : ''}</td>
                  <td className="text-right">{Number(r.credit) ? rm(r.credit) : ''}</td>
                  <td className="text-right">{rm(sign * r.balance)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td></td><td></td><td>Closing balance</td>
                <td className="text-right">{rm(totalDr)}</td><td className="text-right">{rm(totalCr)}</td>
                <td className="text-right">{rm(sign * closing)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function BankReconciliation() {
  const accounts = useAccounts()
  const [code, setCode] = useState('1100')
  const [date, setDate] = useState(todayMY())
  const [statement, setStatement] = useState('')
  const [lines, setLines] = useState<LedgerLine[]>([])
  const [book, setBook] = useState(0)
  const [cleared, setCleared] = useState(0)
  const load = () => {
    fetchLines(code, null, date, date).then(setLines)
    accountTotals(null, date).then(m => setBook(m.get(code) ?? 0))
    supabase.rpc('cleared_total', { p_account: code, p_date: date }).then(({ data }) => setCleared(Number(data ?? 0)))
  }
  useEffect(load, [code, date])

  async function toggle(l: LedgerLine) {
    const { error } = await supabase.rpc('set_cleared', { p_line_ids: [l.id], p_date: l.cleared_on ? null : date })
    if (error) return alert(error.message)
    load()
  }

  // Lines still open, plus those ticked for this statement so they can be unticked.
  const shown = lines
  const diff = statement === '' ? null : round2(Number(statement) - cleared)

  return (
    <div className="space-y-4">
      <div className="card grid items-end gap-4 sm:grid-cols-3">
        <div><label>Bank account</label><AccountSelect accounts={accounts} value={code} onChange={setCode} filter={a => MONEY_ACCOUNTS.includes(a.code)} /></div>
        <div><label>Statement date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label>Statement closing balance (RM)</label><input type="number" step="0.01" inputMode="decimal" value={statement} onChange={e => setStatement(e.target.value)} placeholder="From bank statement" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4"><div className="muted">Balance in books</div><div className="text-lg font-semibold">{rm(book)}</div></div>
        <div className="card p-4"><div className="muted">Ticked (cleared) balance</div><div className="text-lg font-semibold">{rm(cleared)}</div></div>
        <div className="card p-4"><div className="muted">Not yet on statement</div><div className="text-lg font-semibold">{rm(book - cleared)}</div></div>
        <div className={`card p-4 ${diff === 0 ? 'border-emerald-300 bg-emerald-50' : ''}`}>
          <div className="muted">Difference</div>
          <div className="flex items-center gap-2 text-lg font-semibold">{diff === null ? '—' : rm(diff)}{diff === 0 && <CheckCircle2 className="size-5 text-emerald-600" />}</div>
        </div>
      </div>
      <p className="muted">Tick each item that appears on the bank statement. When the difference is RM 0.00 the bank is reconciled.</p>
      <div className="card overflow-x-auto p-0">
        {shown.length === 0 && <Empty text="Everything up to this date is ticked." />}
        {shown.length > 0 && (
          <table>
            <thead><tr><th className="w-12"></th><th className="w-24">Date</th><th className="w-28">Doc No</th><th>Description</th><th className="text-right">Deposit</th><th className="text-right">Withdrawal</th></tr></thead>
            <tbody>
              {shown.map(l => (
                <tr key={l.id} className={l.cleared_on ? 'bg-emerald-50/50' : ''}>
                  <td><input type="checkbox" className="h-4 w-4" checked={!!l.cleared_on} onChange={() => toggle(l)} /></td>
                  <td className="text-slate-500">{dmy(l.journals.date)}</td>
                  <td className="font-mono text-xs">{l.journals.doc_no}</td>
                  <td>{l.memo || l.journals.description}</td>
                  <td className="text-right">{Number(l.debit) ? rm(l.debit) : ''}</td>
                  <td className="text-right">{Number(l.credit) ? rm(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
