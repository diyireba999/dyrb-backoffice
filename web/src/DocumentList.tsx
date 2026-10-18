import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Paperclip, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { dmy, docTotal, isReconciled, openReceipt, rm, type DocRow } from './lib'
import { Empty } from './ui'
import { PageActions } from './page'

// Lists the last three months unless `all` is set (the page loads everything
// then). Opened with ?doc=PV-000012 from the Documents screen, the search box
// starts on that number so an old document is found straight away. `highlight`
// is the doc_no just saved; its row glows for two seconds.
export function DocumentList({ rows, all, onShowAll, newLabel, emptyText, onNew, onEdit, onDelete, canEdit, canDelete, highlight }: {
  rows: DocRow[]
  all: boolean
  onShowAll: () => void
  newLabel: string
  emptyText: string
  onNew: () => void
  onEdit: (d: DocRow) => void
  onDelete: (d: DocRow) => void
  canEdit: boolean
  canDelete: boolean
  highlight?: string
}) {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('doc') ?? '')
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? rows.filter(d => d.doc_no.toLowerCase().includes(needle)
        || d.description.toLowerCase().includes(needle)
        || (d.reference ?? '').toLowerCase().includes(needle)
        || docTotal(d).toFixed(2).includes(needle))
    : rows

  return (
    <div className="space-y-4">
      <PageActions>
        <button className="btn-light" onClick={() => window.print()}><Printer className="size-4" />Print / PDF</button>
        <button className="btn" onClick={onNew}><Plus className="size-4" />{newLabel}</button>
      </PageActions>
      <div className="no-print flex flex-wrap items-center gap-3">
        <input type="search" className="w-full sm:w-80" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search number, description or amount" />
        {!all && <button type="button" className="link" onClick={onShowAll}>Show older than 3 months</button>}
      </div>
      <div className="card overflow-x-auto p-0">
        {shown.length === 0 && <Empty text={needle ? 'Nothing matches that search.' : emptyText} />}
        {shown.length > 0 && (
          <table>
            <thead><tr>
              <th className="w-28">Doc No</th><th className="w-24">Date</th><th>Description</th>
              <th className="text-right">Amount</th><th className="no-print"></th>
            </tr></thead>
            <tbody>
              {shown.map(d => (
                <tr key={d.id} className={d.doc_no === highlight ? 'row-new' : ''}>
                  <td className="font-mono text-xs font-medium">{d.doc_no}</td>
                  <td className="text-slate-500">{dmy(d.date)}</td>
                  <td>
                    <div className="font-medium">{d.description}</div>
                    {d.reference && <div className="text-xs text-slate-500">Ref: {d.reference}</div>}
                    {isReconciled(d) && <div className="text-xs text-slate-400">Ticked on the bank reconciliation</div>}
                    {d.updated_at && <div className="text-xs text-slate-400">Changed {dmy(d.updated_at.slice(0, 10))}</div>}
                  </td>
                  <td className="text-right font-medium">{rm(docTotal(d))}</td>
                  <td className="no-print whitespace-nowrap text-right">
                    {d.attachment && <button title="View receipt" className="btn-ghost px-1.5" onClick={() => openReceipt(d.attachment!)}><Paperclip className="size-4" /></button>}
                    {canEdit && !isReconciled(d) && <button title="Edit" className="btn-ghost px-1.5" onClick={() => onEdit(d)}><Pencil className="size-4" /></button>}
                    {canDelete && !isReconciled(d) && <button title="Delete" className="btn-ghost px-1.5 hover:bg-red-50 hover:text-red-600" onClick={() => onDelete(d)}><Trash2 className="size-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
