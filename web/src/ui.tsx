import { useEffect, useState } from 'react'
import { CheckCircle2, Download, Printer } from 'lucide-react'
import { supabase, todayMY, type Account } from './lib'

export function Done({ msg, doc, again }: { msg: string; doc?: string; again: () => void }) {
  return (
    <div className="card flex max-w-xl flex-col items-center gap-3 py-10 text-center">
      <CheckCircle2 className="size-10 text-emerald-500" />
      <p className="font-semibold">{msg}</p>
      {doc && <p className="badge">{doc}</p>}
      <button className="btn" onClick={again}>Add another</button>
    </div>
  )
}

export function AccountSelect({ accounts, value, onChange, filter = () => true, required = true, disabled = false }: {
  accounts: Account[]; value: string; onChange: (v: string) => void
  filter?: (a: Account) => boolean; required?: boolean; disabled?: boolean
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} required={required} disabled={disabled}>
      <option value="">— choose —</option>
      {accounts.filter(filter).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
    </select>
  )
}

export type Company = { name: string; reg_no: string; address: string; phone: string }
const DEFAULT_COMPANY: Company = { name: 'DYRB', reg_no: '', address: '', phone: '' }
let companyCache: Promise<Company> | null = null

// Company details for printed headers (026_company.sql). Falls back to the
// plain name if that file has not been run yet.
export function useCompany() {
  const [company, setCompany] = useState<Company>(DEFAULT_COMPANY)
  useEffect(() => {
    companyCache ??= Promise.resolve(supabase.from('company').select('name, reg_no, address, phone').maybeSingle())
      .then(({ data }) => ({ ...DEFAULT_COMPANY, ...(data ?? {}) }))
    companyCache.then(setCompany)
  }, [])
  return company
}
export const forgetCompany = () => { companyCache = null }

// Title block + Print / Excel buttons used on every report and listing.
// The printed header carries the logo, company details and when it was printed;
// page numbers come from @page in index.css.
export function ReportBar({ title, period, onCsv, children }: {
  title: string; period: string; onCsv?: () => void; children?: React.ReactNode
}) {
  const company = useCompany()
  const printed = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })
  return (
    <>
      <div className="no-print flex flex-wrap items-end gap-3">
        {children}
        <div className="ml-auto flex gap-2">
          <button className="btn-light" onClick={() => window.print()}><Printer className="size-4" />Print / PDF</button>
          {onCsv && <button className="btn-light" onClick={onCsv}><Download className="size-4" />Excel</button>}
        </div>
      </div>
      <div className="hidden print:block">
        <div className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-3">
          <div className="flex items-start gap-3">
            <img src="/logo.png" alt="" className="size-14 object-contain" />
            <div>
              <div className="text-lg font-bold leading-tight">{company.name}</div>
              {company.reg_no && <div className="text-xs text-slate-600">{company.reg_no}</div>}
              {company.address && <div className="whitespace-pre-line text-xs text-slate-600">{company.address}</div>}
              {company.phone && <div className="text-xs text-slate-600">Tel: {company.phone}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold uppercase tracking-wide">{title}</div>
            <div className="text-sm font-medium">{period}</div>
            <div className="mt-1 text-[10px] text-slate-500">Printed {printed}</div>
          </div>
        </div>
      </div>
    </>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="muted px-5 py-10 text-center">{text}</p>
}

// If part of the database setup is missing, reports quietly show zero. Say so instead.
export function SetupWarning() {
  const [missing, setMissing] = useState('')
  useEffect(() => {
    supabase.rpc('account_totals', { p_from: null, p_to: todayMY() })
      .then(({ error }) => setMissing(error ? error.message : ''))
  }, [])
  if (!missing) return null
  return (
    <div className="no-print mx-auto mb-4 max-w-7xl rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
      <b>Database setup is not finished.</b> Reports and the General Ledger will show zero until it is.
      Run <code>supabase/003b_repair.sql</code> in the Supabase SQL Editor, then reload this page.
      <div className="mt-1 text-xs opacity-80">{missing}</div>
    </div>
  )
}

// Month picker that only reports a complete month. While a year is being typed
// the browser reports 0002, 0020, 0202... (or blank) on every keystroke; passing
// those on reloaded the page for each one and could crash it on a blank.
export function MonthInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="month" defaultValue={value}
    onChange={e => { if (/^20\d\d-(0[1-9]|1[0-2])$/.test(e.target.value)) onChange(e.target.value) }} />
}
