import { useState } from 'react'
import { rm } from './lib'

// Categorical slots 1 and 2 from the validated reference palette (light surface).
const SERIES = ['#2a78d6', '#eb6834']

const niceMax = (v: number) => {
  if (v <= 0) return 1000
  const step = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / step) * step
}
const short = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString('en-MY', { maximumFractionDigits: 1 })}k` : String(Math.round(v))

export type MonthPoint = { label: string; sales: number; expenses: number }

// Grouped columns: sales vs expenses per month, one shared axis.
export function SalesVsExpenses({ data }: { data: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(...data.flatMap(d => [d.sales, d.expenses])))
  const ticks = [0, max / 2, max]
  const H = 180

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-slate-600">
        {['Sales (food & drink)', 'Expenses'].map((s, i) => (
          <span key={s} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: SERIES[i] }} />{s}</span>
        ))}
      </div>
      <div className="relative flex gap-2" style={{ height: H + 24 }}>
        <div className="relative w-9 shrink-0 text-right text-[11px] text-slate-400" style={{ height: H }}>
          {ticks.map(t => <div key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>{short(t)}</div>)}
        </div>
        <div className="relative flex-1">
          {ticks.map(t => <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ top: H - (t / max) * H }} />)}
          <div className="relative flex h-full items-start">
            {data.map((d, i) => (
              <div key={d.label} className="relative flex flex-1 flex-col items-center"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className={`flex items-end justify-center gap-0.5 rounded-md px-1 ${hover === i ? 'bg-slate-50' : ''}`} style={{ height: H }}>
                  {[d.sales, d.expenses].map((v, k) => (
                    <div key={k} className="w-3.5 rounded-t sm:w-5" style={{ height: Math.max(v > 0 ? 2 : 0, (v / max) * H), background: SERIES[k] }} />
                  ))}
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500">{d.label}</div>
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 w-40 rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg">
                    <div className="mb-1 font-semibold text-slate-900">{d.label}</div>
                    {(['Sales (food & drink)', 'Expenses'] as const).map((s, k) => (
                      <div key={s} className="flex items-center justify-between gap-2 text-slate-600">
                        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: SERIES[k] }} />{s}</span>
                        <span className="font-medium tabular-nums text-slate-900">{rm(k ? d.expenses : d.sales)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-slate-500">Show as table</summary>
        <table className="mt-2">
          <thead><tr><th>Month</th><th className="text-right">Sales</th><th className="text-right">Expenses</th><th className="text-right">Profit</th></tr></thead>
          <tbody>{data.map(d => (
            <tr key={d.label}><td>{d.label}</td><td className="text-right">{rm(d.sales)}</td><td className="text-right">{rm(d.expenses)}</td><td className="text-right">{rm(d.sales - d.expenses)}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  )
}

// Ranked horizontal bars, single series, value at the tip.
export function RankedBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map(r => r.value), 1)
  return (
    <div className="space-y-3">
      {rows.map(r => (
        <div key={r.label} title={`${r.label}: ${rm(r.value)}`}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate text-slate-700">{r.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{rm(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: SERIES[0] }} />
          </div>
        </div>
      ))}
    </div>
  )
}
