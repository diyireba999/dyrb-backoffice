import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { createToastStore, type ToastOpts } from './toast-store'

const store = createToastStore()

// toast('PV-000143 saved · RM 1,860.00'); toast(error.message, { kind: 'error' })
export const toast = (message: string, opts?: ToastOpts) => store.push(message, opts)

// Rendered once by the Shell. Bottom-right on a laptop, above the bottom bar on a phone.
export function Toasts() {
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (items.length === 0) return null
  return (
    <div className="no-print pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end">
      {items.map(t => (
        <div key={t.id} role="status" onClick={() => store.dismiss(t.id)}
          className={`pointer-events-auto flex max-w-md cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] text-white shadow-lg ${t.kind === 'error' ? 'bg-red-700' : 'bg-slate-900'}`}>
          {t.kind === 'error'
            ? <XCircle className="size-4 shrink-0" />
            : <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />}
          <span>{t.message}</span>
          {t.action && (
            <button className="ml-2 font-semibold underline"
              onClick={e => { e.stopPropagation(); store.dismiss(t.id); t.action!.onClick() }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---- confirm dialog: await confirmDialog({ title: 'Delete PV-000012?', confirmLabel: 'Delete', danger: true })
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }
type Pending = ConfirmOpts & { resolve: (ok: boolean) => void }
let pending: Pending | null = null
const confirmListeners = new Set<() => void>()
const setPending = (p: Pending | null) => { pending = p; confirmListeners.forEach(l => l()) }
const subscribeConfirm = (l: () => void) => { confirmListeners.add(l); return () => { confirmListeners.delete(l) } }

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise(resolve => {
    pending?.resolve(false) // a superseded confirm is cancelled rather than left hanging
    setPending({ ...opts, resolve })
  })
}

// Rendered once by the Shell. While open, Enter confirms and Esc cancels from anywhere; Tab stays inside the card.
export function ConfirmHost() {
  const p = useSyncExternalStore(subscribeConfirm, () => pending)
  const cardRef = useRef<HTMLDivElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (p) okRef.current?.focus() }, [p])
  const answer = (ok: boolean) => { p?.resolve(ok); setPending(null) }
  useEffect(() => {
    if (!p) return
    const close = (ok: boolean) => { p.resolve(ok); setPending(null) }
    const onKey = (e: KeyboardEvent) => {
      const card = cardRef.current
      const active = document.activeElement
      const inCard = !!card && card.contains(active)
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      // Enter on a focused Cancel keeps its native click (cancel); a destructive confirm must not fire from it.
      else if (e.key === 'Enter' && (!inCard || active === okRef.current)) { e.preventDefault(); close(true) }
      else if (e.key === 'Tab') {
        const buttons = card?.querySelectorAll<HTMLButtonElement>('button') ?? []
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (!inCard) { e.preventDefault(); okRef.current?.focus() }
        else if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])
  if (!p) return null
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => answer(false)}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 id="confirm-title" className="font-semibold">{p.title}</h3>
        {p.body && <div className="mt-2 text-[13px] text-slate-600">{p.body}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-light" onClick={() => answer(false)}>Cancel</button>
          <button ref={okRef} className={p.danger ? 'btn-danger' : 'btn'} onClick={() => answer(true)}>{p.confirmLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  )
}
