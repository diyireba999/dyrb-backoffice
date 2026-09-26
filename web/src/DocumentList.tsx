import { useState } from 'react'
import { Paperclip, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { dmy, docTotal, isReconciled, openReceipt, rm, type DocRow } from './lib'
import { Empty } from './ui'

export function DocumentList({ rows, newLabel, emptyText, onNew, onEdit, onDelete, canEdit, canDelete }: {
  rows: DocRow[]
  newLabel: string
  emptyText: string
  onNew: () => void
  onEdit: (d: DocRow) => void
  onDelete: (d: DocRow) => void
  canEdit: boolean
  canDelete: boolean
}) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? rows.filter(d => d.doc_no.toLowerCase().includes(needle)
        || d.description.toLowerCase().includes(needle)
        || (d.reference ?? '').toLowerCase().includes(needle)
        || docTotal(d).toFixed(2).includes(needle))
    : rows

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <input className="w-64" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search number, description or amount" />
        <button className="btn-light ml-auto" onClick={() => window.print()}>
          <Printer className="size-4" />Print / PDF</button>
        <button className="btn" onClick={onNew}><Plus className="size-4" />{newLabel}</button>
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
                <tr key={d.id} className="hover:bg-slate-50/60">
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
                    {d.attachment && <button title="View receipt"
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand"
                      onClick={() => openReceipt(d.attachment!)}><Paperclip className="size-4" /></button>}
                    {canEdit && !isReconciled(d) && <button title="Edit"
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand"
                      onClick={() => onEdit(d)}><Pencil className="size-4" /></button>}
                    {canDelete && <button title="Delete"
                      className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                      onClick={() => onDelete(d)}><Trash2 className="size-4" /></button>}
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
