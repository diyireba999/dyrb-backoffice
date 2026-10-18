export type ToastKind = 'ok' | 'error'
export type ToastAction = { label: string; onClick: () => void }
export type ToastItem = { id: number; message: string; kind: ToastKind; action?: ToastAction }
export type ToastOpts = { kind?: ToastKind; action?: ToastAction }

// A list of toasts with no React in it, so it can be tested with plain asserts.
// `schedule` is injectable for tests; the app uses setTimeout.
export function createToastStore(schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms) }) {
  let items: ToastItem[] = []
  let nextId = 1
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach(l => l())
  const dismiss = (id: number) => {
    if (!items.some(t => t.id === id)) return
    items = items.filter(t => t.id !== id)
    emit()
  }
  const push = (message: string, opts: ToastOpts = {}) => {
    const id = nextId++
    items = [...items, { id, message, kind: opts.kind ?? 'ok', action: opts.action }]
    emit()
    schedule(() => dismiss(id), opts.kind === 'error' ? 8000 : 4000)
    return id
  }
  return {
    push, dismiss,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    getSnapshot: () => items,
  }
}
