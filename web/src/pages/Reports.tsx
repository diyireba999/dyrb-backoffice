import { useEffect, useState } from 'react'
import { accountTotals, addDays, dmy, downloadCsv, round2, rm, todayMY, useAccounts, type Account } from '../lib'
import { Empty, ReportBar } from '../ui'
import { comparePeriod, shiftMonths, type CompareMode } from '../dashboard-math'

// Net debit (debit minus credit) per account for entries dated within [from, to].
function useNet(from: string | null, to: string) {
  const [net, setNet] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    let stale = false  // a slow reply for dates already changed must not win
    accountTotals(from, to).then(m => { if (!stale) setNet(m) })
    return () => { stale = true }
  }, [from, to])
  return net
}

const yearStart = () => todayMY().slice(0, 4) + '-01-01'

export function TrialBalance() {
  const accounts = useAccounts(true)
  const [asAt, setAsAt] = useState(todayMY())
  const net = useNet(null, asAt)
  const rows = accounts.map(a => [a, round2(net.get(a.code) ?? 0)] as const).filter(([, v]) => v !== 0)
  const dr = rows.reduce((s, [, v]) => s + (v > 0 ? v : 0), 0)
  const cr = rows.reduce((s, [, v]) => s + (v < 0 ? -v : 0), 0)
  const csv = () => downloadCsv(`trial-balance-${asAt}.csv`, [['Code', 'Account', 'Debit', 'Credit'],
    ...rows.map(([a, v]) => [a.code, a.name, v > 0 ? v : '', v < 0 ? -v : '']), ['', 'Total', round2(dr), round2(cr)]])

  return (
    <div className="space-y-4">
      <ReportBar title="Trial Balance" period={`As at ${dmy(asAt)}`} onCsv={csv}>
        <div className="w-44"><label>As at</label><input type="date" value={asAt} onChange={e => setAsAt(e.target.value)} /></div>
      </ReportBar>
      <div className="card overflow-x-auto p-0">
        {rows.length === 0 && <Empty text="No entries up to this date." />}
        {rows.length > 0 && <table>
          <thead><tr><th className="w-20">Code</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
          <tbody>
            {rows.map(([a, v]) => (
              <tr key={a.code}><td className="font-mono text-xs">{a.code}</td><td>{a.name}</td>
                <td className="text-right">{v > 0 ? rm(v) : ''}</td><td className="text-right">{v < 0 ? rm(-v) : ''}</td></tr>
            ))}
            <tr className="bg-slate-50 font-semibold"><td></td><td>Total</td><td className="text-right">{rm(dr)}</td><td className="text-right">{rm(cr)}</td></tr>
          </tbody>
        </table>}
      </div>
      {rows.length > 0 && round2(dr) !== round2(cr) && <p className="alert-error">Debit and credit totals do not agree. Please tell the developer.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- Statements

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

const COMPARE_LABEL: Record<CompareMode, string> = { prev: 'Previous period', year: 'Same period last year', none: 'No comparison' }

// Statement figures: no "RM" on every cell, negatives in brackets.
const fig = (v: number) => {
  const s = Math.abs(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return round2(v) < 0 ? `(${s})` : s
}
const change = (cur: number, prev: number) => {
  if (round2(prev) === 0) return round2(cur) === 0 ? '' : 'new'
  const p = ((cur - prev) / Math.abs(prev)) * 100
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`
}

type Figures = { cur: number; prev: number }
type Line = { kind: 'head'; label: string } | ({ kind: 'item' | 'sub' | 'total' | 'grand'; label: string; code?: string } & Figures)

const ROW_STYLE = {
  item: '',
  sub: 'font-semibold [&>td]:border-t [&>td]:border-slate-300',
  total: 'font-semibold bg-slate-50',
  grand: 'font-bold [&>td]:border-t-2 [&>td]:!border-b-4 [&>td]:border-double [&>td]:border-slate-800',
}

function StatementTable({ lines, curLabel, prevLabel, pctOf }: {
  lines: Line[]; curLabel: string; prevLabel: string | null
  pctOf?: Figures  // show each line as a % of this (sales)
}) {
  const pct = (v: number, base: number) => base ? `${((v / base) * 100).toFixed(1)}%` : ''
  const cols = 2 + (prevLabel ? 2 : 0) + (pctOf ? (prevLabel ? 2 : 1) : 0)
  return (
    <div className="card overflow-x-auto p-0 print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
      <table className="print:text-[10.5px] print:[&_td]:py-1 print:[&_th]:py-1.5">
        <thead>
          <tr>
            <th>RM</th>
            <th className="text-right">{curLabel}</th>
            {pctOf && <th className="w-16 text-right">%</th>}
            {prevLabel && <th className="text-right">{prevLabel}</th>}
            {prevLabel && pctOf && <th className="w-16 text-right">%</th>}
            {prevLabel && <th className="w-20 text-right">Change</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => l.kind === 'head'
            ? <tr key={i}><td colSpan={cols} className="pt-5 text-xs font-bold uppercase tracking-wide text-slate-600 print:pt-3">{l.label}</td></tr>
            : (
              <tr key={i} className={`${ROW_STYLE[l.kind]} ${l.kind === 'grand' && round2(l.cur) < 0 ? 'text-rose-700' : ''}`}>
                <td className={l.kind === 'item' ? 'pl-6' : ''}>
                  {l.code && <span className="mr-2 font-mono text-xs text-slate-400">{l.code}</span>}{l.label}
                </td>
                <td className="text-right">{fig(l.cur)}</td>
                {pctOf && <td className="text-right text-xs text-slate-500">{pct(l.cur, pctOf.cur)}</td>}
                {prevLabel && <td className="text-right text-slate-600">{fig(l.prev)}</td>}
                {prevLabel && pctOf && <td className="text-right text-xs text-slate-500">{pct(l.prev, pctOf.prev)}</td>}
                {prevLabel && <td className="text-right text-xs text-slate-500">{change(l.cur, l.prev)}</td>}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

const linesCsv = (lines: Line[], curLabel: string, prevLabel: string | null) => [
  ['Code', 'Account', curLabel, ...(prevLabel ? [prevLabel, 'Change'] : [])],
  ...lines.map(l => l.kind === 'head' ? ['', l.label.toUpperCase()]
    : [l.code ?? '', l.label, round2(l.cur), ...(prevLabel ? [round2(l.prev), change(l.cur, l.prev)] : [])]),
]

// One group of accounts as item lines plus its totals. Accounts that are zero
// in both columns are left out.
function group(accounts: Account[], cur: Map<string, number>, prev: Map<string, number>, sign: number) {
  const items = accounts
    .map(a => ({ kind: 'item' as const, code: a.code, label: a.name, cur: round2(sign * (cur.get(a.code) ?? 0)), prev: round2(sign * (prev.get(a.code) ?? 0)) }))
    .filter(l => l.cur !== 0 || l.prev !== 0)
  return { items, cur: items.reduce((s, l) => s + l.cur, 0), prev: items.reduce((s, l) => s + l.prev, 0) }
}
type Group = ReturnType<typeof group>

const block = (label: string, g: Group, total: string, always = true): Line[] =>
  always || g.items.length ? [{ kind: 'head', label }, ...g.items, { kind: 'sub', label: total, cur: g.cur, prev: g.prev }] : []

function Tiles({ tiles, compare }: { tiles: [string, Figures][]; compare: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
      {tiles.map(([label, f]) => (
        <div key={label} className="card p-4">
          <div className="muted">{label}</div>
          <div className={`mt-1 text-lg font-semibold tabular-nums ${round2(f.cur) < 0 ? 'text-rose-700' : ''}`}>{rm(f.cur)}</div>
          {compare && <div className="text-xs text-slate-500">{change(f.cur, f.prev) || 'no change'} · was {rm(f.prev)}</div>}
        </div>
      ))}
    </div>
  )
}

export function ProfitAndLoss() {
  const accounts = useAccounts(true)
  const [from, setFrom] = useState(todayMY().slice(0, 8) + '01')
  const [to, setTo] = useState(todayMY())
  const [mode, setMode] = useState<CompareMode>('prev')
  const cmp = comparePeriod(from, to, mode)
  const cur = useNet(from, to)
  const prevNet = useNet(cmp?.[0] ?? from, cmp?.[1] ?? to)
  const prev = cmp ? prevNet : new Map<string, number>()

  const by = (f: (a: Account) => boolean, sign: number) => group(accounts.filter(f), cur, prev, sign)
  // Service charge is shown on its own, so the margins are measured on food and drink only.
  const sales = by(a => a.type === 'income' && a.code < '4100', -1)
  const service = by(a => a.type === 'income' && a.code >= '4100' && a.code < '4900', -1)
  const other = by(a => a.type === 'income' && a.code >= '4900', -1)
  const cost = by(a => a.type === 'expense' && a.code < '6000', 1)
  const opex = by(a => a.type === 'expense' && a.code >= '6000', 1)
  const gross = { cur: sales.cur - cost.cur, prev: sales.prev - cost.prev }
  const profit = { cur: gross.cur + service.cur + other.cur - opex.cur, prev: gross.prev + service.prev + other.prev - opex.prev }

  const lines: Line[] = [
    ...block('Sales', sales, 'Total sales'),
    ...block('Cost of sales', cost, 'Total cost of sales'),
    { kind: 'total', label: 'Gross profit', ...gross },
    ...block('Service charge', service, 'Total service charge', false),
    ...block('Other income', other, 'Total other income', false),
    ...block('Operating expenses', opex, 'Total operating expenses'),
    { kind: 'grand', label: round2(profit.cur) < 0 ? 'Net loss' : 'Net profit', ...profit },
  ]
  const curLabel = `${dmy(from)} – ${dmy(to)}`
  const prevLabel = cmp ? `${dmy(cmp[0])} – ${dmy(cmp[1])}` : null
  const csv = () => downloadCsv(`profit-and-loss-${from}-${to}.csv`, linesCsv(lines, curLabel, prevLabel))
  const monthStart = todayMY().slice(0, 8) + '01'
  const setRange = (f: string, t: string) => { setFrom(f); setTo(t) }

  return (
    <div className="space-y-4">
      <ReportBar title="Profit & Loss Statement" period={`For the period ${dmy(from)} to ${dmy(to)}`} onCsv={csv}>
        <div className="w-40"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="w-40"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="w-52"><label>Compare with</label>
          <select value={mode} onChange={e => setMode(e.target.value as CompareMode)}>
            {(Object.keys(COMPARE_LABEL) as CompareMode[]).map(k => <option key={k} value={k}>{COMPARE_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-light" onClick={() => setRange(monthStart, todayMY())}>This month</button>
          <button className="btn-light" onClick={() => setRange(shiftMonths(monthStart, -1), addDays(monthStart, -1))}>Last month</button>
          <button className="btn-light" onClick={() => setRange(yearStart(), todayMY())}>Year to date</button>
        </div>
      </ReportBar>
      <Tiles compare={!!cmp} tiles={[['Sales', sales], ['Gross profit', gross], ['Operating expenses', opex], [round2(profit.cur) < 0 ? 'Net loss' : 'Net profit', profit]]} />
      <div className="max-w-4xl print:max-w-none">
        <StatementTable lines={lines} curLabel={curLabel} prevLabel={prevLabel} pctOf={sales} />
        <p className="muted mt-2 print:text-[9px]">% is of food and drink sales. Service charge is passed on to staff, so it is left out of the margins.</p>
      </div>
    </div>
  )
}

export function BalanceSheet() {
  const accounts = useAccounts(true)
  const [asAt, setAsAt] = useState(todayMY())
  const [compare, setCompare] = useState(true)
  const ok = isDate(asAt)
  const prevAt = ok ? addDays(asAt.slice(0, 8) + '01', -1) : asAt  // end of the month before
  const lastYearEnd = (d: string) => ok ? `${Number(d.slice(0, 4)) - 1}-12-31` : asAt
  const cur = useNet(null, asAt)
  const prevAll = useNet(null, prevAt)
  const curBf = useNet(null, lastYearEnd(asAt))
  const prevBf = useNet(null, lastYearEnd(prevAt))
  const prev = compare ? prevAll : new Map<string, number>()

  const of = (f: (a: Account) => boolean, sign: number) => group(accounts.filter(f), cur, prev, sign)
  // Code ranges follow the chart of accounts: 1500+ is equipment and
  // renovation; 25xx (owed to director) is not due within the year.
  const currentAssets = of(a => a.type === 'asset' && a.code < '1500', 1)
  const fixedAssets = of(a => a.type === 'asset' && a.code >= '1500', 1)
  const currentLiab = of(a => a.type === 'liability' && !a.code.startsWith('25'), -1)
  const longLiab = of(a => a.type === 'liability' && a.code.startsWith('25'), -1)
  const equity = of(a => a.type === 'equity', -1)
  // There is no year-end closing entry: earlier years' profit is brought
  // forward here, and this year's shown on its own line.
  const pl = (m: Map<string, number>) => -accounts.filter(a => a.type === 'income' || a.type === 'expense').reduce((s, a) => s + (m.get(a.code) ?? 0), 0)
  const bf = { cur: round2(pl(curBf)), prev: compare ? round2(pl(prevBf)) : 0 }
  const yearProfit = { cur: round2(pl(cur)) - bf.cur, prev: compare ? round2(pl(prevAll)) - bf.prev : 0 }

  const add = (...f: Figures[]) => ({ cur: f.reduce((s, x) => s + x.cur, 0), prev: f.reduce((s, x) => s + x.prev, 0) })
  const totalAssets = add(currentAssets, fixedAssets)
  const totalLiab = add(currentLiab, longLiab)
  const totalEquity = add(equity, bf, yearProfit)
  const working = { cur: currentAssets.cur - currentLiab.cur, prev: currentAssets.prev - currentLiab.prev }
  const balanced = round2(totalAssets.cur) === round2(totalLiab.cur + totalEquity.cur)

  const lines: Line[] = [
    ...block('Non-current assets', fixedAssets, 'Total non-current assets', false),
    ...block('Current assets', currentAssets, 'Total current assets'),
    { kind: 'grand', label: 'Total assets', ...totalAssets },
    ...block('Current liabilities', currentLiab, 'Total current liabilities'),
    ...block('Non-current liabilities', longLiab, 'Total non-current liabilities', false),
    { kind: 'total', label: 'Total liabilities', ...totalLiab },
    { kind: 'head', label: 'Equity' },
    ...equity.items,
    { kind: 'item', label: 'Profit brought forward from earlier years', ...bf },
    { kind: 'item', label: 'Profit / (loss) this year to date', ...yearProfit },
    { kind: 'sub', label: 'Total equity', ...totalEquity },
    { kind: 'grand', label: 'Total liabilities and equity', ...add(totalLiab, totalEquity) },
  ]
  const curLabel = dmy(asAt)
  const prevLabel = compare ? dmy(prevAt) : null
  const csv = () => downloadCsv(`balance-sheet-${asAt}.csv`, linesCsv(lines, curLabel, prevLabel))

  return (
    <div className="space-y-4">
      <ReportBar title="Balance Sheet" period={`As at ${dmy(asAt)}`} onCsv={csv}>
        <div className="w-44"><label>As at</label><input type="date" value={asAt} onChange={e => setAsAt(e.target.value)} /></div>
        <label className="flex items-center gap-2 pb-2.5 text-sm font-normal text-slate-700">
          <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
          Compare with end of previous month
        </label>
      </ReportBar>
      <Tiles compare={compare} tiles={[['Total assets', totalAssets], ['Total liabilities', totalLiab], ['Equity', totalEquity], ['Working capital', working]]} />
      <div className="max-w-4xl print:max-w-none">
        <StatementTable lines={lines} curLabel={curLabel} prevLabel={prevLabel} />
        <p className="muted mt-2 print:text-[9px]">Working capital is current assets less current liabilities: what is left to run the business day to day.</p>
      </div>
      {!balanced && <p className="alert-error">Assets do not equal liabilities + equity. Please tell the developer.</p>}
    </div>
  )
}
