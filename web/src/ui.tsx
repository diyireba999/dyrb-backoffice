import { CheckCircle2, Download, Printer } from 'lucide-react'
import type { Account } from './lib'

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
