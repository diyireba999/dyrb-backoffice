import { useSyncExternalStore } from 'react'
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
    <div className="no-print fixed inset-x-4 bottom-20 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end">
      {items.map(t => (
        <div key={t.id} role="status" onClick={() => store.dismiss(t.id)}
          className={`flex max-w-md cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] text-white shadow-lg ${t.kind === 'error' ? 'bg-red-700' : 'bg-slate-900'}`}>
          {t.kind === 'error'
            ? <XCircle className="size-4 shrink-0" />
            : <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />}
          <span>{t.message}</span>
          {t.action && (
            <button className="ml-2 font-semibold underline"
              onClick={e => { e.stopPropagation(); t.action!.onClick(); store.dismiss(t.id) }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}
