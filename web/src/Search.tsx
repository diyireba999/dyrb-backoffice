import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, FileSearch, Search as SearchIcon, type LucideIcon } from 'lucide-react'
import { dmy, supabase } from './lib'

type Target = { to: string; label: string; group: string; icon: LucideIcon }
type Hit = { key: string; to: string; label: string; sub: string; icon: LucideIcon }

// Ctrl+K / Cmd+K: jump to a screen, or find a document by number or description.
export function SearchDialog({ pages, canSeeDocs, open, setOpen }: {
  pages: Target[]; canSeeDocs: boolean; open: boolean; setOpen: (v: boolean) => void
}) {
  const [q, setQ] = useState('')
  const [docs, setDocs] = useState<Hit[]>([])
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => input.current?.focus(), 0) } }, [open])

  useEffect(() => {
    const term = q.trim()
    if (!canSeeDocs || term.length < 2) { setDocs([]); return }
    const t = setTimeout(() => {
      const safe = term.replace(/[%,()]/g, ' ')
      supabase.from('journals').select('doc_no, date, description')
        .or(`doc_no.ilike.%${safe}%,description.ilike.%${safe}%,reference.ilike.%${safe}%`)
        .order('date', { ascending: false }).limit(6)
        .then(({ data }) => setDocs((data ?? []).map(d => ({
          key: d.doc_no, to: `/gl/listing?doc=${d.doc_no}`, label: `${d.doc_no} · ${d.description}`, sub: dmy(d.date), icon: FileSearch,
        }))))
    }, 200)
    return () => clearTimeout(t)
  }, [q, canSeeDocs])

  if (!open) return null
  const term = q.trim().toLowerCase()
  const pageHits: Hit[] = pages
    .filter(p => !term || p.label.toLowerCase().includes(term) || p.group.toLowerCase().includes(term))
    .map(p => ({ key: p.to, to: p.to, label: p.label, sub: p.group, icon: p.icon }))
  const hits = [...pageHits, ...docs]
  const go = (h?: Hit) => { if (!h) return; setOpen(false); navigate(h.to) }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <SearchIcon className="size-4 text-slate-400" />
          <input ref={input} value={q} placeholder="Search screens or documents (e.g. PV-000012, TNB)…"
            className="h-12 !border-0 px-0 !shadow-none !ring-0"
            onChange={e => { setQ(e.target.value); setActive(0) }}
            onKeyDown={e => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
              if (e.key === 'Enter') go(hits[active])
            }} />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {hits.length === 0 && <p className="muted px-3 py-6 text-center">Nothing found.</p>}
          {hits.map((h, i) => (
            <button key={h.key} onMouseEnter={() => setActive(i)} onClick={() => go(h)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-soft text-brand-dark' : 'text-slate-700'}`}>
              <h.icon className="size-4 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
              <span className="shrink-0 text-xs text-slate-400">{h.sub}</span>
              {i === active && <CornerDownLeft className="size-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
