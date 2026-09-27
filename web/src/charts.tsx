import { useState } from 'react'
import { dmy, rm } from './lib'
import { pctChange, type DayAmount } from './dashboard-math'

// Categorical slots 1 and 2 from the validated reference palette (light surface).
const SERIES = ['#2a78d6', '#eb6834']

const niceMax = (v: number) => {
  if (v <= 0) return 1000
  const step = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / step) * step
}
const short = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString('en-MY', { maximumFractionDigits: 1 })}k` : String(Math.round(v))

// One thin bar per day, oldest left, with an optional dashed break-even rule.
// A day with no sales still renders a visible baseline stub, not a gap.
export function DailyBars({ days, breakEvenLine }: { days: DayAmount[]; breakEvenLine: number | null }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(...days.map(d => Number(d.amount)), breakEvenLine ?? 0))
  const H = 140
  // Floor at 0 as well as ceiling at 1: a break-even figure should never be negative
  // by the time it reaches this component, but clamping both ends means a bad number
  // can never draw the rule off the top or bottom of the plot.
  const linePct = breakEvenLine !== null ? Math.max(0, Math.min(1, breakEvenLine / max)) : null

  return (
    <div>
      <div className="relative flex gap-2" style={{ height: H + 8 }}>
        <div className="relative w-9 shrink-0 text-right text-[11px] text-slate-400" style={{ height: H }}>
          {[0, max / 2, max].map(t => <div key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>{short(t)}</div>)}
        </div>
        <div className="relative flex-1">
          {linePct !== null && (
            <div className="absolute inset-x-0 border-t border-dashed border-slate-400" style={{ top: H - linePct * H }}>
              <span className="absolute right-0 -top-2.5 bg-white pl-1 text-[10px] text-slate-500">break even (avg/day)</span>
            </div>
          )}
          <div className="relative flex h-full items-end gap-px">
            {days.map((d, i) => {
              const v = Number(d.amount)
              return (
                <div key={d.date} className="relative flex-1" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <div
                    className={`rounded-t ${hover === i ? 'opacity-70' : ''} ${v < 0 ? 'bg-rose-600' : ''}`}
                    style={{ height: Math.max(2, (v / max) * H), ...(v < 0 ? {} : { background: SERIES[0] }) }}
                  />
                  {hover === i && (
                    <div className="pointer-events-none absolute bottom-full z-10 mb-1 w-32 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-lg">
                      <div className="font-semibold text-slate-900">{dmy(d.date)}</div>
                      <div className="tabular-nums text-slate-600">{rm(v)}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-slate-500">Show as table</summary>
        <table className="mt-2">
          <thead><tr><th>Date</th><th className="text-right">Sales</th></tr></thead>
          <tbody>{days.map(d => (
            <tr key={d.date}><td>{dmy(d.date)}</td><td className="text-right">{rm(Number(d.amount))}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  )
}

// Ranked horizontal bars, single series, value at the tip.
// `before` (optional) adds a same-period-last-month change line. Unlike the sales
// figures elsewhere on the dashboard, a rise here is bad (costs went up), so the
// colours are the opposite of Trend's — which is exactly why each also gets a word,
// not just a colour.
export function RankedBars({ rows }: { rows: { label: string; value: number; before?: number }[] }) {
  const max = Math.max(...rows.map(r => r.value), 1)
  return (
    <div className="space-y-3">
      {rows.map(r => {
        const change = r.before === undefined ? undefined : pctChange(r.value, r.before)
        const color = change === undefined ? '' : change === null ? 'text-slate-400' : change === 0 ? 'text-slate-500' : change > 0 ? 'text-rose-600' : 'text-emerald-600'
        return (
          <div key={r.label} title={`${r.label}: ${rm(r.value)}`}>
            <div className="mb-1 flex justify-between gap-2 text-sm">
              <span className="truncate text-slate-700">{r.label}</span>
              <span className="shrink-0 font-medium tabular-nums">{rm(r.value)}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: SERIES[0] }} />
            </div>
            {change !== undefined && (
              <div className={`mt-0.5 text-xs font-medium ${color}`}>
                {change === null ? 'new' : change === 0 ? 'flat vs last month' : `${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% vs last month`}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
