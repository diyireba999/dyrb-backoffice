import { useEffect, useState } from 'react'
import { accountTotals, dmy, downloadCsv, round2, rm, todayMY, useAccounts, type Account } from '../lib'
import { Empty, ReportBar } from '../ui'

// Net debit (debit minus credit) per account for entries dated within [from, to].
function useNet(from: string | null, to: string) {
  const [net, setNet] = useState<Map<string, number>>(new Map())
  useEffect(() => { accountTotals(from, to).then(setNet) }, [from, to])
  return net
}

const yearStart = () => todayMY().slice(0, 4) + '-01-01'

function Section({ title, rows, total, totalLabel }: { title: string; rows: [Account, number][]; total: number; totalLabel: string }) {
  return (
    <>
      <tr><td colSpan={2} className="bg-slate-50 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</td></tr>
      {rows.map(([a, v]) => (
        <tr key={a.code}><td className="pl-6"><span className="font-mono text-xs text-slate-400">{a.code}</span> {a.name}</td><td className="text-right">{rm(v)}</td></tr>
      ))}
      <tr className="font-semibold"><td>{totalLabel}</td><td className="text-right border-t border-slate-300">{rm(total)}</td></tr>
    </>
  )
}

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

export function ProfitAndLoss() {
  const accounts = useAccounts(true)
  const [from, setFrom] = useState(todayMY().slice(0, 8) + '01')
  const [to, setTo] = useState(todayMY())
  const net = useNet(from, to)
  const pick = (f: (a: Account) => boolean, sign: number) =>
    accounts.filter(f).map(a => [a, round2(sign * (net.get(a.code) ?? 0))] as [Account, number]).filter(([, v]) => v !== 0)
  const sales = pick(a => a.type === 'income' && a.code < '4900', -1)
  const other = pick(a => a.type === 'income' && a.code >= '4900', -1)
  const cost = pick(a => a.type === 'expense' && a.code < '6000', 1)
  const opex = pick(a => a.type === 'expense' && a.code >= '6000', 1)
  const sum = (r: [Account, number][]) => r.reduce((s, [, v]) => s + v, 0)
  const gross = sum(sales) - sum(cost)
  const profit = gross + sum(other) - sum(opex)
  const pct = (v: number) => sum(sales) ? ` (${((v / sum(sales)) * 100).toFixed(1)}%)` : ''
  const csv = () => downloadCsv(`profit-and-loss-${from}-${to}.csv`, [['Section', 'Code', 'Account', 'Amount'],
    ...([['Sales', sales], ['Cost of sales', cost], ['Other income', other], ['Operating expenses', opex]] as [string, [Account, number][]][])
      .flatMap(([s, r]) => r.map(([a, v]) => [s, a.code, a.name, v])),
    ['', '', 'Gross profit', round2(gross)], ['', '', 'Net profit / (loss)', round2(profit)]])

  return (
    <div className="space-y-4">
      <ReportBar title="Profit & Loss" period={`${dmy(from)} to ${dmy(to)}`} onCsv={csv}>
        <div className="w-40"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="w-40"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <button className="btn-light" onClick={() => { setFrom(yearStart()); setTo(todayMY()) }}>Year to date</button>
      </ReportBar>
      <div className="card max-w-3xl overflow-x-auto p-0">
        <table>
          <tbody>
            <Section title="Sales" rows={sales} total={sum(sales)} totalLabel="Total sales" />
            <Section title="Cost of sales" rows={cost} total={sum(cost)} totalLabel={`Total cost of sales${pct(sum(cost))}`} />
            <tr className="bg-brand-soft font-semibold"><td>Gross profit{pct(gross)}</td><td className="text-right">{rm(gross)}</td></tr>
            {other.length > 0 && <Section title="Other income" rows={other} total={sum(other)} totalLabel="Total other income" />}
            <Section title="Operating expenses" rows={opex} total={sum(opex)} totalLabel="Total operating expenses" />
            <tr className={`text-base font-bold ${profit < 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
              <td>Net profit / (loss){pct(profit)}</td><td className="text-right">{rm(profit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function BalanceSheet() {
  const accounts = useAccounts(true)
  const [asAt, setAsAt] = useState(todayMY())
  const net = useNet(null, asAt)
  const pick = (type: Account['type'], sign: number) =>
    accounts.filter(a => a.type === type).map(a => [a, round2(sign * (net.get(a.code) ?? 0))] as [Account, number]).filter(([, v]) => v !== 0)
  const sum = (r: [Account, number][]) => r.reduce((s, [, v]) => s + v, 0)
  const assets = pick('asset', 1), liabilities = pick('liability', -1), equity = pick('equity', -1)
  // No year-end closing yet: all profit to date shows as one line under equity.
  const profit = -accounts.filter(a => a.type === 'income' || a.type === 'expense').reduce((s, a) => s + (net.get(a.code) ?? 0), 0)
  const totalEquity = sum(equity) + profit
  const balanced = round2(sum(assets)) === round2(sum(liabilities) + totalEquity)
  const csv = () => downloadCsv(`balance-sheet-${asAt}.csv`, [['Section', 'Code', 'Account', 'Amount'],
    ...assets.map(([a, v]) => ['Assets', a.code, a.name, v]), ['', '', 'Total assets', round2(sum(assets))],
    ...liabilities.map(([a, v]) => ['Liabilities', a.code, a.name, v]), ['', '', 'Total liabilities', round2(sum(liabilities))],
    ...equity.map(([a, v]) => ['Equity', a.code, a.name, v]), ['Equity', '', 'Profit / (loss) to date', round2(profit)],
    ['', '', 'Total equity', round2(totalEquity)]])

  return (
    <div className="space-y-4">
      <ReportBar title="Balance Sheet" period={`As at ${dmy(asAt)}`} onCsv={csv}>
        <div className="w-44"><label>As at</label><input type="date" value={asAt} onChange={e => setAsAt(e.target.value)} /></div>
      </ReportBar>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto p-0">
          <table><tbody>
            <Section title="Assets" rows={assets} total={sum(assets)} totalLabel="Total assets" />
          </tbody></table>
        </div>
        <div className="card overflow-x-auto p-0">
          <table><tbody>
            <Section title="Liabilities" rows={liabilities} total={sum(liabilities)} totalLabel="Total liabilities" />
            <tr><td colSpan={2} className="bg-slate-50 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Equity</td></tr>
            {equity.map(([a, v]) => <tr key={a.code}><td className="pl-6"><span className="font-mono text-xs text-slate-400">{a.code}</span> {a.name}</td><td className="text-right">{rm(v)}</td></tr>)}
            <tr><td className="pl-6">Profit / (loss) to date</td><td className="text-right">{rm(profit)}</td></tr>
            <tr className="font-semibold"><td>Total equity</td><td className="border-t border-slate-300 text-right">{rm(totalEquity)}</td></tr>
            <tr className="bg-slate-50 font-bold"><td>Total liabilities + equity</td><td className="text-right">{rm(sum(liabilities) + totalEquity)}</td></tr>
          </tbody></table>
        </div>
      </div>
      {!balanced && <p className="alert-error">Assets do not equal liabilities + equity. Please tell the developer.</p>}
    </div>
  )
}
