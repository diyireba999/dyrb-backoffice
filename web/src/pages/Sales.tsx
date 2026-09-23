import { useEffect, useState } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import { CheckCircle2, CloudUpload, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { dmy, rm, supabase, useAccounts, type Role } from '../lib'
import { dayTotal, daySuspect, parseBillSummary, paymentTotal, type Day } from '../zeoniq'
import { AccountSelect, Empty } from '../ui'

export function UploadSales() {
  const [days, setDays] = useState<Day[]>([])
  const [pick, setPick] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')

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

  async function post() {
    setBusy(true)
    const out: Day[] = []
    for (const d of days) {
      if (!pick[d.date] || d.posted) { out.push(d); continue }
      const { error } = await supabase.rpc('post_sales_day', {
        p_date: d.date, p_sales: d.sales, p_service: d.service, p_tax: d.tax, p_rounding: d.rounding,
        p_payments: d.payments, p_sales_lines: null,
      })
      out.push({ ...d, posted: !error, result: error ? error.message : 'ok' })
    }
    setDays(out); setBusy(false)
  }

  const chosen = days.filter(d => pick[d.date] && !d.posted)

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
      </div>
      {error && <p className="alert-error">{error}</p>}

      {days.length > 0 && (
        <>
          <div className="card overflow-x-auto p-0">
            <table>
              <thead><tr>
                <th className="w-10"></th><th>Date</th><th className="text-right">Sales</th><th className="text-right">Service charge</th>
                <th className="text-right">Tax</th><th className="text-right">Rounding</th><th className="text-right">Day total</th>
                <th>Payments</th><th></th>
              </tr></thead>
              <tbody>
                {days.map(d => {
                  const mismatch = daySuspect(d)
                  return (
                    <tr key={d.date} className={d.posted ? 'text-slate-400' : ''}>
                      <td><input type="checkbox" disabled={d.posted || mismatch} checked={!!pick[d.date] && !d.posted}
                        onChange={e => setPick({ ...pick, [d.date]: e.target.checked })} /></td>
                      <td className="font-medium">{dmy(d.date)}</td>
                      <td className="text-right">{rm(d.sales)}</td>
                      <td className="text-right">{rm(d.service)}</td>
                      <td className="text-right">{rm(d.tax)}</td>
                      <td className="text-right">{rm(d.rounding)}</td>
                      <td className="text-right font-medium">{rm(d.netTotal)}</td>
                      <td className="text-xs text-slate-600">{d.payments.map(p => `${p.code} ${rm(p.amount)}`).join(' · ')}</td>
                      <td className="whitespace-nowrap text-right text-xs">
                        {d.posted && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-4" />{d.result === 'ok' ? 'Posted' : 'Already in'}</span>}
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
            <button className="btn ml-auto" disabled={busy || chosen.length === 0} onClick={post}>
              {busy ? 'Posting…' : `Post ${chosen.length} day${chosen.length === 1 ? '' : 's'}`}
            </button>
          </div>
          <p className="muted">Each day becomes one entry: money in by payment type, sales and service charge as income. A day already posted cannot go in twice.</p>
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
