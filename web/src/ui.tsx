import { useEffect, useState } from 'react'
import { CheckCircle2, Download, Printer } from 'lucide-react'
import { supabase, type Account } from './lib'

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

export function AccountSelect({ accounts, value, onChange, filter = () => true, required = true }: {
  accounts: Account[]; value: string; onChange: (v: string) => void; filter?: (a: Account) => boolean; required?: boolean
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} required={required}>
      <option value="">— choose —</option>
      {accounts.filter(filter).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
    </select>
  )
}

// Title block + Print / Excel buttons used on every report and listing.
export function ReportBar({ title, period, onCsv, children }: {
  title: string; period: string; onCsv?: () => void; children?: React.ReactNode
}) {
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
        <div className="text-lg font-bold">DYRB</div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm">{period}</div>
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
    supabase.rpc('account_totals', { p_from: null, p_to: new Date().toISOString().slice(0, 10) })
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
