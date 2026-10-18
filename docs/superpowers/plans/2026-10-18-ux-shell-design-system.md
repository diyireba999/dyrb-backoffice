# UX Slice A: Shell and Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every screen one calmer look (compact, orange only on actions), a task-grouped left rail with a phone bottom bar, a shared page header, and toast/confirm dialogs in place of browser pop-ups, without changing any posting logic, query, route or SQL.

**Architecture:** Design tokens and component classes live in `web/src/index.css`. Three small modules provide the shared behaviour: `toast-store.ts` (pure, tested), `feedback.tsx` (Toasts, confirmDialog), `page.tsx` (header action portal, Esc hook, submit helper). `App.tsx` renders the shell (rail, bottom bar, header with an action slot, dialog hosts). Screens change markup only: buttons move into the header through `<PageActions>`, `Done` screens become toasts with a highlighted row, `alert`/`confirm` become `toast`/`confirmDialog`.

**Tech Stack:** React 19, react-router-dom 7, Tailwind v4 (`@theme`, `@apply`), lucide-react, Vite 8, TypeScript 6, Node asserts run with `node --experimental-strip-types`. No new dependencies.

## Global Constraints

- No new npm packages. No SQL changes. No route changes: every `to:` in `PAGES` keeps its URL.
- Orange `#e0481c` (hover `#b8370f`, soft `#fff1ec`) only on primary buttons, active nav, focus ring, links.
- Compact density: body/table 13px, inputs/buttons/rows 32px, labels 12px, pills 11px, page title 18px, section title 15px.
- Every `alert(` and `confirm(` in `web/src` is gone by the end. `prompt(` (one use, reset password) stays.
- Each task ends with `npx tsc -b`, `npx oxlint` (warnings only, no errors) and `npm run build` passing in `web/`, then a commit.
- Work on branch `ux-shell` from `master`. Commits are normal prose, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-10-18-ux-shell-design-system-design.md`. One deliberate deviation: table headers are not sticky (the cards scroll sideways, which breaks `position: sticky` against the page); month-long lists are short enough.

## File map

| File | Responsibility |
|---|---|
| `web/src/index.css` | Tokens, base element styles, `.btn*`, `.pill*`, `.card`, `.row-new` |
| `web/src/toast-store.ts` (new) | Pure toast list with auto-expiry; no React |
| `web/src/feedback.tsx` (new) | `toast()`, `<Toasts/>`, `confirmDialog()`, `<ConfirmHost/>` |
| `web/src/page.tsx` (new) | `ActionSlot` context, `<PageActions/>` portal, `useEscape`, `submittedAgain` |
| `web/src/dashboard-math.ts` | gains `dueLabel()` |
| `web/src/ui.tsx` | `Pill`, `ReportBar` (buttons move to header), `Done` deleted at the end |
| `web/src/App.tsx` | `PAGES` regrouped, rail, bottom bar, header with action slot, hosts |
| `web/src/DocumentList.tsx` | Header actions, row highlight |
| `web/src/lib.ts` | `openReceipt` uses toast |
| `web/src/pages/*.tsx` | Markup-only changes per screen |
| `web/ui-test.mjs` (new), `web/dashboard-test.mjs`, `web/package.json` | Tests for toast store and `dueLabel` |

---

### Task 1: Tokens and component classes

**Files:**
- Modify: `web/src/index.css`

**Interfaces:**
- Produces CSS classes used by every later task: `.btn`, `.btn-light`, `.btn-ghost`, `.btn-danger`, `.pill`, `.pill-ok`, `.pill-warn`, `.pill-danger`, `.row-new`, `.card`, `.muted`, `.link`, `.tab`, `.tab-active`, `.alert-error`, `.badge` (kept for the upload file-name chips).

- [ ] **Step 1: Create the branch**

```bash
cd "C:/Users/DELL/Documents/DYRB Accounting" && git checkout -b ux-shell master
```

- [ ] **Step 2: Replace the `@layer base` block**

In `web/src/index.css` replace the whole `@layer base { … }` block with:

```css
@layer base {
  body { @apply bg-[#f8f9fb] text-[13px] text-slate-900 antialiased; font-feature-settings: "cv11", "ss01"; }
  h3 { @apply text-[15px]; }

  input, select, textarea {
    @apply w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-900 shadow-xs
           placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/10 focus:outline-none
           disabled:bg-slate-100 disabled:text-slate-500;
  }
  textarea { @apply h-auto py-1.5; }
  input[type="file"] { @apply h-auto py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-[13px] file:font-medium file:text-slate-700; }
  label { @apply block text-xs font-medium text-slate-700 mb-1; }

  table { @apply w-full text-[13px]; }
  th { @apply bg-slate-50 px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200; }
  td { @apply px-2.5 py-[7px] border-b border-slate-100 tabular-nums; }
  tr:last-child td { @apply border-b-0; }
  tbody tr:hover td { @apply bg-slate-50/60; }
  /* Keep "RM 1,260.00" on one line; narrow screens scroll the table instead. */
  td.text-right, th.text-right { @apply whitespace-nowrap; }

  input[type="checkbox"] { @apply h-4 w-4 p-0 shadow-none accent-brand cursor-pointer; }
}
```

- [ ] **Step 3: Replace the `@layer components` block**

```css
@layer components {
  .btn {
    @apply inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-brand px-3 text-[13px] font-semibold text-white
           shadow-xs transition hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
           focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25;
  }
  .btn-light {
    @apply inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px]
           font-medium text-slate-700 shadow-xs transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
           focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15;
  }
  .btn-ghost {
    @apply inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-slate-600
           transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 cursor-pointer;
  }
  .btn-danger {
    @apply inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 text-[13px] font-semibold text-white
           shadow-xs transition hover:bg-red-700 disabled:opacity-50 cursor-pointer
           focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-600/25;
  }
  .card { @apply rounded-lg border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_16px_-8px_rgba(15,23,42,0.08)]; }
  .muted { @apply text-[13px] text-slate-500; }
  .link { @apply text-[13px] font-medium text-brand hover:underline cursor-pointer; }
  .link-danger { @apply text-[13px] font-medium text-red-600 hover:underline cursor-pointer; }

  .tab { @apply rounded-md px-3 py-1 text-[13px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer; }
  .tab-active { @apply bg-white text-slate-900 shadow-xs; }

  .alert-error { @apply rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700; }

  .pill { @apply inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600; }
  .pill-ok { @apply bg-green-50 text-green-700; }
  .pill-warn { @apply bg-amber-50 text-amber-700; }
  .pill-danger { @apply bg-red-50 text-red-700; }
  .badge { @apply inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600; }

  /* A row just saved: amber that fades, so the eye finds it in the list. */
  .row-new td { animation: row-new 2s ease-out; }
}

@keyframes row-new {
  from { background-color: #fef3c7; }
  to { background-color: transparent; }
}
```

- [ ] **Step 4: Build**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`
Expected: build succeeds; oxlint prints only the pre-existing `set-state-in-effect` / `only-export-components` warnings.

- [ ] **Step 5: Commit**

```bash
git add web/src/index.css
git commit -m "style: compact tokens, ghost and danger buttons, status pills, saved-row highlight

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Toast store and Toasts component

**Files:**
- Create: `web/src/toast-store.ts`
- Create: `web/src/feedback.tsx`
- Create: `web/ui-test.mjs`
- Modify: `web/package.json` (scripts)

**Interfaces:**
- Produces `toast(message: string, opts?: { kind?: 'ok' | 'error'; action?: { label: string; onClick: () => void } }): number` and `<Toasts/>` from `web/src/feedback.tsx`.

- [ ] **Step 1: Write the failing test**

Create `web/ui-test.mjs`:

```js
import assert from 'node:assert/strict'
import { createToastStore } from './src/toast-store.ts'

// Timers are injected so the test controls time.
const timers = []
const store = createToastStore((fn, ms) => timers.push({ fn, ms }))
let notified = 0
store.subscribe(() => notified++)

const id = store.push('PV-000143 saved · RM 1,860.00')
assert.equal(store.getSnapshot().length, 1)
assert.equal(store.getSnapshot()[0].kind, 'ok')
assert.equal(timers[0].ms, 4000, 'ok toasts last 4s')

store.push('Could not save', { kind: 'error' })
assert.equal(timers[1].ms, 8000, 'error toasts last 8s')

store.dismiss(id)
assert.deepEqual(store.getSnapshot().map(t => t.message), ['Could not save'])

timers[1].fn()
assert.equal(store.getSnapshot().length, 0, 'expired toast is gone')
assert.equal(notified, 4, 'listeners told on push, push, dismiss, expire')
console.log('toast store ok')
```

Add to `web/package.json` scripts: `"test:ui": "node --experimental-strip-types ui-test.mjs"`.

- [ ] **Step 2: Run it to see it fail**

Run in `web/`: `npm run test:ui`
Expected: fails with "Cannot find module './src/toast-store.ts'".

- [ ] **Step 3: Write the store**

Create `web/src/toast-store.ts`:

```ts
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
  const dismiss = (id: number) => { items = items.filter(t => t.id !== id); emit() }
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
```

- [ ] **Step 4: Run the test**

Run: `npm run test:ui`
Expected: `toast store ok`.

- [ ] **Step 5: Write the React side**

Create `web/src/feedback.tsx` (the confirm half is added in Task 3):

```tsx
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
```

- [ ] **Step 6: Build and commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`

```bash
git add web/src/toast-store.ts web/src/feedback.tsx web/ui-test.mjs web/package.json
git commit -m "feat: toast store and Toasts component

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Confirm dialog

**Files:**
- Modify: `web/src/feedback.tsx`

**Interfaces:**
- Produces `confirmDialog(opts: { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean>` and `<ConfirmHost/>`.

- [ ] **Step 1: Append the confirm half to `feedback.tsx`**

Change the first import line to `import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'` and append:

```tsx
// ---- confirm dialog: await confirmDialog({ title: 'Delete PV-000012?', confirmLabel: 'Delete', danger: true })
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }
type Pending = ConfirmOpts & { resolve: (ok: boolean) => void }
let pending: Pending | null = null
const confirmListeners = new Set<() => void>()
const setPending = (p: Pending | null) => { pending = p; confirmListeners.forEach(l => l()) }
const subscribeConfirm = (l: () => void) => { confirmListeners.add(l); return () => { confirmListeners.delete(l) } }

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise(resolve => setPending({ ...opts, resolve }))
}

// Rendered once by the Shell. Enter confirms (the confirm button has focus), Esc cancels.
export function ConfirmHost() {
  const p = useSyncExternalStore(subscribeConfirm, () => pending)
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (p) okRef.current?.focus() }, [p])
  if (!p) return null
  const answer = (ok: boolean) => { p.resolve(ok); setPending(null) }
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => answer(false)} onKeyDown={e => { if (e.key === 'Escape') answer(false) }}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold">{p.title}</h3>
        {p.body && <div className="mt-2 text-[13px] text-slate-600">{p.body}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-light" onClick={() => answer(false)}>Cancel</button>
          <button ref={okRef} className={p.danger ? 'btn-danger' : 'btn'} onClick={() => answer(true)}>{p.confirmLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build and commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`

```bash
git add web/src/feedback.tsx
git commit -m "feat: confirmDialog and ConfirmHost in place of browser confirm

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Page actions portal, Esc hook, submit helper, due-date pill

**Files:**
- Create: `web/src/page.tsx`
- Modify: `web/src/dashboard-math.ts` (append `dueLabel`)
- Modify: `web/src/ui.tsx` (add `Pill`)
- Modify: `web/src/Search.tsx:127` (add `role="dialog"` to the panel)
- Modify: `web/dashboard-test.mjs`

**Interfaces:**
- Produces `ActionSlot` (context of `HTMLElement | null`), `<PageActions>{buttons}</PageActions>`, `useEscape(fn)`, `submittedAgain(e)` from `page.tsx`; `dueLabel(due, today)` from `dashboard-math.ts`; `<Pill tone>` from `ui.tsx`.

- [ ] **Step 1: Write the failing test for `dueLabel`**

Append to `web/dashboard-test.mjs` (after the zeoniq block):

```js
// --- due-date pill text ---
const { dueLabel } = await import('./src/dashboard-math.ts')
assert.deepEqual(dueLabel('2026-10-17', '2026-10-18'), { text: 'Overdue', tone: 'danger' })
assert.deepEqual(dueLabel('2026-10-18', '2026-10-18'), { text: 'Due today', tone: 'warn' })
assert.deepEqual(dueLabel('2026-10-20', '2026-10-18'), { text: 'Due Tue', tone: 'warn' }, 'within a week: weekday')
assert.deepEqual(dueLabel('2026-10-24', '2026-10-18'), { text: 'Due Sat', tone: 'warn' }, 'six days out still a weekday')
assert.deepEqual(dueLabel('2026-10-25', '2026-10-18'), { text: 'Due 25/10', tone: 'none' }, 'a week or more: date')
console.log('due label ok')
```

- [ ] **Step 2: Run to see it fail**

Run in `web/`: `npm run test:dash`
Expected: fails with "dueLabel is not a function".

- [ ] **Step 3: Implement `dueLabel`**

Append to `web/src/dashboard-math.ts`:

```ts
// ---- due-date pill for invoice lists ----
// Overdue (past), Due today, "Due Tue" within the next six days, else "Due 25/10".
export function dueLabel(due: string, today: string): { text: string; tone: 'danger' | 'warn' | 'none' } {
  if (due < today) return { text: 'Overdue', tone: 'danger' }
  if (due === today) return { text: 'Due today', tone: 'warn' }
  const days = Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
  if (days <= 6) {
    const weekday = new Date(due + 'T00:00:00Z').toLocaleDateString('en-MY', { weekday: 'short', timeZone: 'UTC' })
    return { text: `Due ${weekday}`, tone: 'warn' }
  }
  return { text: `Due ${due.slice(8, 10)}/${due.slice(5, 7)}`, tone: 'none' }
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:dash`
Expected: `due label ok`.

- [ ] **Step 5: Create `page.tsx`**

```tsx
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The Shell renders the page header and hands its action area down through this
// context. A screen puts its buttons there with <PageActions>…</PageActions>;
// when the screen (or its list view) unmounts, the buttons go with it.
export const ActionSlot = createContext<HTMLElement | null>(null)

export function PageActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionSlot)
  return slot ? createPortal(children, slot) : null
}

// Esc on a form goes back to its list. Ignored while a dialog is open.
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
      onEscape()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onEscape])
}

// Which submit button was pressed: <button name="again"> is "Save & add another".
export const submittedAgain = (e: React.FormEvent) =>
  ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.name === 'again'
```

- [ ] **Step 6: Add `Pill` to `ui.tsx`**

Append to `web/src/ui.tsx`:

```tsx
export function Pill({ tone = 'none', children }: { tone?: 'none' | 'ok' | 'warn' | 'danger'; children: React.ReactNode }) {
  return <span className={`pill ${tone === 'none' ? '' : `pill-${tone}`}`}>{children}</span>
}
```

- [ ] **Step 7: Mark the search panel as a dialog**

In `web/src/Search.tsx`, the inner panel `<div className="w-full max-w-lg overflow-hidden rounded-2xl …" onClick={e => e.stopPropagation()}>` gets `role="dialog"` so `useEscape` on a form does not also fire when Esc closes the search.

- [ ] **Step 8: Build and commit**

Run in `web/`: `npm run test:dash && npx tsc -b && npx oxlint && npm run build`

```bash
git add web/src/page.tsx web/src/dashboard-math.ts web/src/ui.tsx web/src/Search.tsx web/dashboard-test.mjs
git commit -m "feat: page action slot, Esc hook, Save-and-add helper, due-date pill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: App shell — rail, bottom bar, header action slot, hosts

**Files:**
- Modify: `web/src/App.tsx` (`PAGES`, `Sidebar`, `Shell`)

**Interfaces:**
- Consumes `ActionSlot`, `Toasts`, `ConfirmHost`.
- Produces the header action area every screen's `<PageActions>` renders into.

- [ ] **Step 1: Replace `OFFICE`/`EVERYONE`/`REPORTS` and `PAGES`**

Replace the block from `const OFFICE: Role[]` through the end of the `PAGES` array with:

```tsx
const OFFICE: Role[] = ['owner', 'manager', 'accountant']
const EVERYONE: Role[] = [...OFFICE, 'staff']
const REPORTS: Role[] = [...OFFICE, 'investor']
const STAFF_ONLY: Role[] = ['staff']

// group = rail heading, in this order. Pages sharing a section show as one rail
// item (the first of them) with tabs on the page. URLs are unchanged.
type Page = { to: string; label: string; subtitle: string; icon: LucideIcon; group: string; section?: string; roles: Role[] }
const PAGES: Page[] = [
  { to: '/', label: 'Today', subtitle: 'Money, sales and what needs doing', icon: LayoutDashboard, group: 'Today', roles: [...EVERYONE, 'investor'] },

  { to: '/sales/upload', label: 'Upload', subtitle: 'Daily takings from the Zeoniq Bill Summary', icon: CloudUpload, group: 'Money in', section: 'Sales', roles: OFFICE },
  { to: '/sales/fiuu', label: 'Card settlement', subtitle: 'Fiuu payouts into the bank, and the fee', icon: CreditCard, group: 'Money in', section: 'Sales', roles: OFFICE },
  { to: '/cash/receipt', label: 'Official receipt', subtitle: 'Money received, other than daily sales (OR)', icon: ArrowDownLeft, group: 'Money in', roles: OFFICE },
  { to: '/cash/transfer', label: 'Transfer', subtitle: 'Move money between cash, e-wallet and bank (TR)', icon: ArrowLeftRight, group: 'Money in', roles: OFFICE },

  { to: '/ap/invoices', label: 'Invoices', subtitle: 'Supplier bills bought on credit (PI)', icon: FileText, group: 'Money out', section: 'Purchases', roles: OFFICE },
  { to: '/ap/payments', label: 'Pay suppliers', subtitle: 'Pay supplier invoices (SP)', icon: HandCoins, group: 'Money out', section: 'Purchases', roles: OFFICE },
  { to: '/ap/suppliers', label: 'Suppliers', subtitle: 'Supplier list and balance owed', icon: Truck, group: 'Money out', section: 'Purchases', roles: OFFICE },
  { to: '/ap/aging', label: 'Aging', subtitle: 'Amount owed, by how overdue', icon: CalendarClock, group: 'Money out', section: 'Purchases', roles: OFFICE },
  { to: '/cash/payment', label: 'Payment voucher', subtitle: 'Pay out from cash or bank (PV)', icon: ArrowUpRight, group: 'Money out', roles: OFFICE },
  { to: '/claims', label: 'Claims', subtitle: 'Expenses paid from someone\'s own pocket', icon: Receipt, group: 'Money out', roles: EVERYONE },

  { to: '/payroll/timesheet', label: 'Timesheet', subtitle: 'Hours worked each day, feeding the monthly payroll', icon: CalendarClock, group: 'Month-end', section: 'Payroll', roles: OFFICE },
  { to: '/payroll/advances', label: 'Advances', subtitle: 'Money lent before payday, taken back on the payslip', icon: HandCoins, group: 'Month-end', section: 'Payroll', roles: OFFICE },
  { to: '/payroll/run', label: 'Monthly run', subtitle: 'Work out pay, approve and print payslips', icon: CalendarDays, group: 'Month-end', section: 'Payroll', roles: OFFICE },
  { to: '/payroll/year', label: 'Yearly summary', subtitle: 'Totals per staff for EA forms', icon: BookText, group: 'Month-end', section: 'Payroll', roles: OFFICE },
  { to: '/payslips', label: 'My payslips', subtitle: 'Your own payslips', icon: Wallet2, group: 'Month-end', roles: STAFF_ONLY },
  { to: '/gl/accruals', label: 'Accruals', subtitle: 'Rent and bills charged to the right month', icon: Repeat, group: 'Month-end', roles: OFFICE },
  { to: '/stock/count', label: 'Stock count', subtitle: 'Count the shelf and correct the cost', icon: Package, group: 'Month-end', roles: OFFICE },
  { to: '/cash/bank-rec', label: 'Bank reconciliation', subtitle: 'Match the books to the bank statement', icon: SquareCheckBig, group: 'Month-end', roles: OFFICE },

  { to: '/gl/listing', label: 'Documents', subtitle: 'All documents by month', icon: BookOpen, group: 'Books', roles: OFFICE },
  { to: '/gl/journal', label: 'Journal entry', subtitle: 'Manual debit / credit entry (JV)', icon: NotebookPen, group: 'Books', roles: OFFICE },
  { to: '/gl/ledger', label: 'All accounts', subtitle: 'Transactions and running balance of one account', icon: BookText, group: 'Books', section: 'Ledger', roles: OFFICE },
  { to: '/cash/book', label: 'Cash & bank', subtitle: 'Cash and bank movements with running balance', icon: Wallet, group: 'Books', section: 'Ledger', roles: OFFICE },
  { to: '/reports/pl', label: 'Profit & Loss', subtitle: 'Sales, costs and profit for a period', icon: TrendingUp, group: 'Books', section: 'Reports', roles: REPORTS },
  { to: '/reports/bs', label: 'Balance sheet', subtitle: 'What the business owns and owes', icon: PieChart, group: 'Books', section: 'Reports', roles: REPORTS },
  { to: '/reports/tb', label: 'Trial balance', subtitle: 'All account balances; debit equals credit', icon: Scale, group: 'Books', section: 'Reports', roles: REPORTS },

  { to: '/gl/accounts', label: 'Chart of accounts', subtitle: 'Account list and balances', icon: ListTree, group: 'Setup', roles: OFFICE },
  { to: '/payroll/staff', label: 'Staff', subtitle: 'Staff details, salary and deductions', icon: IdCard, group: 'Setup', roles: OFFICE },
  { to: '/stock/costs', label: 'Item costs', subtitle: 'What each drink and dish costs you', icon: Tags, group: 'Setup', roles: OFFICE },
  { to: '/sales/settings', label: 'Sales settings', subtitle: 'Where each payment type and sales figure goes', icon: Settings2, group: 'Setup', roles: OFFICE },
  { to: '/payroll/rates', label: 'Payroll settings', subtitle: 'EPF, SOCSO, EIS rates', icon: Settings2, group: 'Setup', roles: OFFICE },
  { to: '/company', label: 'Company details', subtitle: 'Name, SSM no. and address on printed reports', icon: Building2, group: 'Setup', roles: ['owner'] },
  { to: '/users', label: 'Users', subtitle: 'Who can sign in and what they can do', icon: UsersIcon, group: 'Setup', roles: ['owner'] },
]
```

Note `/payslips` is `STAFF_ONLY` in the rail but its route stays open to everyone (the `<Route>` list is unchanged), so an office login that opens the URL still works.

- [ ] **Step 2: Sidebar: heading rule and rail width**

In `Sidebar`, change `const groups = [...new Set(pages.map(p => p.group))].filter(g => g !== 'New')` to `const groups = [...new Set(pages.map(p => p.group))]` and change the heading line `: g !== 'Overview' && <div className={heading}>{g}</div>}` to `: g !== 'Today' && <div className={heading}>{g}</div>}`. Change the item row classes from `px-3 py-1.5 text-sm` to `h-8 px-3 text-[13px]`. Leave the search button, + New block, Setup collapse and the footer as they are.

- [ ] **Step 3: Rewrite `Shell`**

Replace the whole `Shell` function with:

```tsx
function Shell({ profile, onPassword }: { profile: Profile; onPassword: () => void }) {
  const [open, setOpen] = useState(false)        // phone drawer
  const [newSheet, setNewSheet] = useState(false) // phone "+ New" sheet
  const [search, setSearch] = useState(false)
  const [slot, setSlot] = useState<HTMLElement | null>(null)  // header action area, see page.tsx
  const { pathname } = useLocation()
  const pages = PAGES.filter(p => p.roles.includes(profile.role))
  const page = pages.find(p => p.to === pathname) ?? pages[0]
  const tabs = page.section ? pages.filter(p => p.section === page.section) : []
  const office = isOffice(profile.role)
  const newItems = NEW.filter(n => n.roles.includes(profile.role))
  const today = new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
  const hour = Number(new Date().toLocaleString('en-MY', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }))
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const barItem = 'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium'

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-58 lg:block">
        <Sidebar profile={profile} pages={pages} onNavigate={() => {}} onPassword={onPassword} onSearch={() => setSearch(true)} />
      </aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">
            <Sidebar profile={profile} pages={pages} onNavigate={() => setOpen(false)} onPassword={onPassword} onSearch={() => { setOpen(false); setSearch(true) }} />
          </div>
          <button className="absolute left-72 top-3 ml-2 rounded-md bg-white p-2 text-slate-700 shadow" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
      )}
      {newSheet && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" onClick={() => setNewSheet(false)}>
          <div className="absolute inset-0 bg-slate-900/30" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 pb-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">New</div>
            {newItems.map(n => (
              <Link key={n.to} to={n.to} onClick={() => setNewSheet(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] hover:bg-slate-100">
                <n.icon className="size-4 text-slate-400" />{n.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="lg:pl-58">
        <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200/70 bg-slate-50/80 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{pathname === '/' ? `${greeting}, ${profile.full_name.split(' ')[0]}` : page.section ?? page.label}</h1>
            <p className="truncate text-xs text-slate-500">{pathname === '/' ? today : page.subtitle}</p>
          </div>
          {/* Screens render their buttons here through <PageActions>. */}
          <div ref={setSlot} className="flex flex-wrap items-center gap-2 empty:hidden max-sm:basis-full" />
        </header>
        <SearchDialog pages={pages.map(p => p.section ? { ...p, label: `${p.section} · ${p.label}` } : p)} canSeeDocs={office} open={search} setOpen={setSearch} />
        <main className="mx-auto max-w-7xl p-4 pb-20 sm:p-6 lg:pb-6">
          {tabs.length > 1 && (
            <nav className="no-print -mt-1 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 [scrollbar-width:none]">
              {tabs.map(t => (
                <Link key={t.to} to={t.to} aria-current={t.to === pathname ? 'page' : undefined}
                  className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition ${
                    t.to === pathname ? 'border-brand font-medium text-brand-dark' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t.label}</Link>
              ))}
            </nav>
          )}
          <LoadingBar />
          <SetupWarning />
          <ActionSlot.Provider value={slot}>
            <Routes>
              {/* … the existing <Route> list, unchanged … */}
            </Routes>
          </ActionSlot.Provider>
        </main>
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Link to="/" className={`${barItem} ${pathname === '/' ? 'text-brand' : 'text-slate-500'}`}><LayoutDashboard className="size-5" />Today</Link>
        <button onClick={() => setSearch(true)} className={`${barItem} text-slate-500`}><SearchIcon className="size-5" />Search</button>
        <button onClick={() => setNewSheet(true)} disabled={newItems.length === 0} className={`${barItem} text-slate-500 disabled:opacity-40`}><Plus className="size-5" />New</button>
        <button onClick={() => setOpen(true)} className={`${barItem} text-slate-500`}><Menu className="size-5" />Menu</button>
      </nav>
      <Toasts />
      <ConfirmHost />
    </div>
  )
}
```

Keep the existing `<Route …>` lines exactly as they are inside `<Routes>`. Add imports: `import { ActionSlot } from './page'` and `import { ConfirmHost, Toasts } from './feedback'`. `w-58` and `lg:pl-58` are 232px in Tailwind v4's numeric scale.

- [ ] **Step 4: Build, then look**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`. Then `npm run dev`, open http://localhost:5173: the login page shows; sign-in is not possible locally, so the rail is checked on the live site after push. Narrow the window below 1024px on the login page only to confirm nothing overflows.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: task-grouped rail, phone bottom bar, header action slot, toast and confirm hosts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Shared list parts — ReportBar buttons to the header, DocumentList highlight

**Files:**
- Modify: `web/src/ui.tsx` (`ReportBar`)
- Modify: `web/src/DocumentList.tsx`
- Modify: `web/src/lib.ts` (`openReceipt`)

**Interfaces:**
- `ReportBar({ title, period, onCsv?, children? })` keeps its signature; Print/Excel now render in the header.
- `DocumentList` gains `highlight?: string` (a `doc_no`); its Print and New buttons render in the header.

- [ ] **Step 1: ReportBar**

In `web/src/ui.tsx` add `import { PageActions } from './page'` and replace the `ReportBar` function with:

```tsx
// Report screens: Print / Excel in the page header, filters in the body, and a
// print-only header carrying the logo, company details and when it was printed.
export function ReportBar({ title, period, onCsv, children }: {
  title: string; period: string; onCsv?: () => void; children?: React.ReactNode
}) {
  const company = useCompany()
  const printed = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })
  return (
    <>
      <PageActions>
        <button className="btn-light" onClick={() => window.print()}><Printer className="size-4" />Print / PDF</button>
        {onCsv && <button className="btn-light" onClick={onCsv}><Download className="size-4" />Excel</button>}
      </PageActions>
      {children && <div className="no-print flex flex-wrap items-end gap-3">{children}</div>}
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
```

- [ ] **Step 2: DocumentList**

Replace `web/src/DocumentList.tsx` with:

```tsx
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
```

- [ ] **Step 3: `openReceipt` without `alert`**

In `web/src/lib.ts` add `import { toast } from './feedback'` and change the `openReceipt` error line to:

```ts
  if (error || !data) return toast('Could not open the receipt: ' + (error?.message ?? 'not found'), { kind: 'error' })
```

- [ ] **Step 4: Build and commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`

```bash
git add web/src/ui.tsx web/src/DocumentList.tsx web/src/lib.ts
git commit -m "feat: report and document buttons move to the page header; saved row highlight

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Money out — Payment voucher, Purchases, Claims

**Files:**
- Modify: `web/src/pages/Books.tsx` (`PaymentVoucher`)
- Modify: `web/src/pages/Purchase.tsx` (all four screens)
- Modify: `web/src/pages/Claims.tsx`

**Interfaces:**
- Consumes `toast`, `confirmDialog`, `PageActions`, `useEscape`, `submittedAgain`, `Pill`, `dueLabel`, `DocumentList.highlight`.

- [ ] **Step 1: Payment voucher (`Books.tsx`)**

Imports: add `docTotal` to the `../lib` import; add `import { confirmDialog, toast } from '../feedback'` and `import { submittedAgain, useEscape } from '../page'`. In `PaymentVoucher`:

Replace `const [done, setDone] = useState<{ msg: string; doc?: string } | null>(null)` with `const [highlight, setHighlight] = useState('')`.

After `useEffect(load, [all])` add:

```tsx
  useEscape(() => { if (mode === 'form' && !busy) { setMode('list'); setError('') } })
```

Replace the `startEdit` alert line with:

```tsx
    if (!debit || !credit) return toast('This voucher has an unusual shape. Use Journal Entry to correct it.', { kind: 'error' })
```

Replace `remove` with:

```tsx
  async function remove(d: DocRow) {
    if (!await confirmDialog({ title: `Delete ${d.doc_no}?`, body: `${d.description} · ${rm(docTotal(d))}. This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return toast(error.message, { kind: 'error' })
    load()
  }
```

Replace the body of `submit` from `try {` to the end of the function with:

```tsx
    const again = submittedAgain(e)
    try {
      const desc = [f.payee, f.note].filter(Boolean).join(' – ') || 'Payment'
      const lines = [
        { account: f.what, debit: amount, memo: f.note },
        { account: f.from, credit: amount },
      ]
      let doc: string | undefined
      if (editing) {
        await updateJournal(editing.id, f.date, desc, lines, { reference: f.reference })
        doc = editing.doc_no
        toast(`${doc} changed to ${rm(amount)}`)
      } else {
        const id = await postJournal(f.date, desc, lines, { source: 'pv', reference: f.reference })
        doc = await docNo(id)
        toast(`${doc ?? 'Payment'} saved · ${rm(amount)}`)
      }
      setF({ ...blank, date: f.date, from: f.from }); setEditing(null)
      setHighlight(doc ?? '')
      if (!again) setMode('list')
      load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
```

Delete the two lines `if (done) return <Done msg={done.msg} doc={done.doc}` / `again={() => { setDone(null); setMode('list') }} />`.

Add `highlight={highlight}` to the `<DocumentList …>` props.

Replace the form's final button row with:

```tsx
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => { setMode('list'); setError('') }}>Cancel</button>
        {!editing && <button className="btn-light" name="again" disabled={busy}>Save & add another</button>}
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save payment'}</button>
      </div>
```

Add `autoFocus` to the Pay to input: `<input value={f.payee} … placeholder="Shop, TNB, landlord…" required autoFocus />`.

- [ ] **Step 2: Purchases — Suppliers (`Purchase.tsx`)**

Imports: `import { confirmDialog, toast } from '../feedback'`, `import { PageActions, submittedAgain, useEscape } from '../page'`, `import { dueLabel } from '../dashboard-math'`, and add `Pill` to the `../ui` import; remove `Done` from it.

In `Suppliers.remove`:

```tsx
  async function remove(id: number) {
    const s = list.find(s => s.id === id)
    if (!await confirmDialog({ title: `Remove ${s?.name ?? 'this supplier'}?`, body: 'Only possible while they have no documents.', confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.from('suppliers').delete().eq('id', id)
    if (error) toast('Cannot remove: this supplier already has documents.', { kind: 'error' })
    load()
  }
```

Change the remove button's class to `btn-ghost px-1.5 hover:bg-red-50 hover:text-red-600`.

- [ ] **Step 3: Purchases — Invoices**

`NewPurchaseInvoice`: change the prop type to `onSaved: (result: { msg: string; doc: string }, again: boolean) => void`. At the top of `submit` after `e.preventDefault()` add `const again = submittedAgain(e)`; pass `again` as the second argument in both `onSaved(…)` calls. Add `autoFocus` to the Supplier `<select>`. Replace the final button row with:

```tsx
      <div className="flex justify-end gap-2">
        {!editing && <button className="btn-light" name="again" disabled={busy || total <= 0}>Save & add another</button>}
        <button className="btn" disabled={busy || total <= 0}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save invoice'}</button>
      </div>
```

`PurchaseInvoices`: replace `const [saved, setSaved] = useState<{ msg: string; doc: string } | null>(null)` with `const [highlight, setHighlight] = useState('')`, and add after `useEffect(load, [show])`:

```tsx
  useEscape(() => { if (mode !== 'list') { setMode('list'); setEditing(null) } })
```

Replace `cancel`, `viewPhoto` and the `startEdit` error line:

```tsx
  async function cancel(inv: Invoice) {
    if (!await confirmDialog({ title: `Cancel ${inv.doc_no}?`, body: `${inv.supplier} · ${rm(inv.total)}. This removes it from the books.`, confirmLabel: 'Cancel invoice', danger: true })) return
    const { error } = await supabase.rpc('cancel_purchase_invoice', { p_id: inv.id })
    if (error) toast(error.message, { kind: 'error' })
    load()
  }
  async function viewPhoto(inv: Invoice) {
    const { data } = await supabase.from('journals').select('attachment').eq('doc_no', inv.doc_no).single()
    if (data?.attachment) openReceipt(data.attachment); else toast('No photo attached', { kind: 'error' })
  }
```

and in `startEdit`: `if (error || !data) return toast(error?.message ?? 'Could not open the invoice', { kind: 'error' })`.

Delete the line `if (saved !== null) return <Done … />`. Change the form-mode return to:

```tsx
  if (mode !== 'list') return (
    <div className="space-y-4">
      <button className="link" onClick={() => { setMode('list'); setEditing(null) }}>← Back to list</button>
      <NewPurchaseInvoice editing={editing}
        onSaved={(result, again) => {
          toast(`${result.doc || 'Invoice'} ${result.msg.includes('changed') ? 'changed' : 'saved'}`)
          setHighlight(result.doc); setEditing(null); load()
          if (!again) setMode('list')
        }} />
    </div>
  )
```

In the list view, move the New button into the header and use pills. Replace the top `<div className="flex flex-wrap items-center gap-3">…</div>` with:

```tsx
      <PageActions>
        <button className="btn" onClick={() => setMode('new')}><Plus className="size-4" />New purchase invoice</button>
      </PageActions>
      <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
        <button className={`tab ${show === 'open' ? 'tab-active' : ''}`} onClick={() => setShow('open')}>Unpaid</button>
        <button className={`tab ${show === 'all' ? 'tab-active' : ''}`} onClick={() => setShow('all')}>All</button>
      </div>
```

In the row, replace `const overdue = …` and the Due cell with:

```tsx
              const due = Number(r.outstanding) > 0 ? dueLabel(r.due_date, today) : null
              return (
                <tr key={r.id} className={r.doc_no === highlight ? 'row-new' : ''}>
                  …
                  <td>{due ? <Pill tone={due.tone}>{due.text}</Pill> : <span className="text-slate-500">{dmy(r.due_date)}</span>}</td>
```

and the Outstanding cell: `{Number(r.outstanding) > 0 ? rm(r.outstanding) : <Pill tone="ok">Paid</Pill>}`. Change the Photo link to `className="btn-ghost"` and the two icon buttons to `btn-ghost px-1.5` (cancel: `btn-ghost px-1.5 hover:bg-red-50 hover:text-red-600`).

- [ ] **Step 4: Purchases — Pay suppliers**

In `SupplierPayments`: replace `const [done, setDone] = useState<{ msg: string; doc: string } | null>(null)` with `const [highlight, setHighlight] = useState(0)` (a payment id). Replace the `startEdit` error line with `if (error || !data) return toast(error?.message ?? 'Could not open the payment', { kind: 'error' })`. In `submit`, replace `setDone({ msg: 'Supplier payment changed', doc: editing.doc_no })` with `toast(`${editing.doc_no} changed · ${rm(total)}`); setHighlight(editing.id)`, and the three lines after `if (error) return setError(error.message)` in the new-payment path with:

```tsx
    const { data: p } = await supabase.from('supplier_payments').select('journals(doc_no)').eq('id', data).single()
    toast(`${(p as unknown as { journals: { doc_no: string } })?.journals.doc_no ?? 'Payment'} saved · ${rm(total)}`)
    setHighlight(data as number)
    setSupplier(''); setHead({ ...head, reference: '' }); loadHistory()
```

Replace `cancel`:

```tsx
  async function cancel(p: Payment) {
    if (!await confirmDialog({ title: `Cancel ${p.journals.doc_no}?`, body: `${p.suppliers.name} · ${rm(p.amount)}. The invoices become unpaid again.`, confirmLabel: 'Cancel payment', danger: true })) return
    const { error } = await supabase.rpc('cancel_supplier_payment', { p_id: p.id })
    if (error) toast(error.message, { kind: 'error' })
    loadHistory()
  }
```

Delete `if (done !== null) return <Done … />`. In the history table give each row `className={p.id === highlight ? 'row-new' : ''}` and make the two icon buttons `btn-ghost px-1.5` (cancel with `hover:bg-red-50 hover:text-red-600`). Add `useEscape(() => { if (editing) cancelEdit() })` after the effects.

- [ ] **Step 5: Purchases — Aging**

No logic change. `ReportBar` already moved its buttons. Change the As-at input wrapper to `<div className="w-40">`.

- [ ] **Step 6: Claims (`Claims.tsx`)**

Imports: add `import { confirmDialog, toast } from '../feedback'` and `Pill` to the `../ui` import. In `review`, `pay`: `if (error) toast(error.message, { kind: 'error' })`. Replace `unpay` and `remove`:

```tsx
  async function unpay(c: Claim) {
    if (!await confirmDialog({ title: `Undo the payment of ${rm(c.amount)}?`, body: 'The claim goes back to approved and the payment entry is removed.', confirmLabel: 'Undo paid' })) return
    const { error } = await supabase.rpc('unpay_claim', { p_id: c.id })
    if (error) toast(error.message, { kind: 'error' })
    load()
  }

  async function remove(c: Claim) {
    if (!await confirmDialog({ title: 'Cancel this claim?', body: `${c.description} · ${rm(c.amount)}`, confirmLabel: 'Cancel claim', danger: true })) return
    await supabase.from('claims').delete().eq('id', c.id)
    load()
  }
```

In `NewClaim.submit`, after `onSaved()` add `toast(`Claim saved · ${rm(amount)}`)`. In `ClaimCard`, replace the status span with:

```tsx
        <Pill tone={c.status === 'paid' ? 'ok' : c.status === 'rejected' ? 'danger' : c.status === 'approved' ? 'none' : 'warn'}>{c.status}</Pill>
```

and delete the `STATUS_STYLE` constant.

- [ ] **Step 7: Build, grep, commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`, then `grep -n "alert(\|confirm(\|<Done" src/pages/Purchase.tsx src/pages/Claims.tsx` must print nothing, and the same grep on `src/pages/Books.tsx` must only hit OfficialReceipt, Transfer and JournalListing (Task 8 and 10).

```bash
git add web/src/pages/Books.tsx web/src/pages/Purchase.tsx web/src/pages/Claims.tsx
git commit -m "feat: Money out screens on the new shell: header actions, Save & add another, toasts, due pills

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Money in — Official receipt, Transfer, Sales upload, Card settlement

**Files:**
- Modify: `web/src/pages/Books.tsx` (`OfficialReceipt`, `Transfer`)
- Modify: `web/src/pages/Sales.tsx` (`UploadSales`, `CardSettlement` chrome only)

- [ ] **Step 1: Official receipt**

In `OfficialReceipt`, make exactly the same four changes as PaymentVoucher: `done` state → `highlight` state; `useEscape(() => { if (mode === 'form' && !busy) { setMode('list'); setError('') } })` after `useEffect(load, [all])`; `startEdit` alert → `toast(…, { kind: 'error' })`; `remove` →

```tsx
  async function remove(d: DocRow) {
    if (!await confirmDialog({ title: `Delete ${d.doc_no}?`, body: `${d.description} · ${rm(docTotal(d))}. This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return toast(error.message, { kind: 'error' })
    load()
  }
```

`submit` body from `try {`:

```tsx
    const again = submittedAgain(e)
    try {
      const lines = [{ account: f.into, debit: amount }, { account: f.kind, credit: amount }]
      let doc: string | undefined
      if (editing) {
        await updateJournal(editing.id, f.date, f.from || 'Receipt', lines, { reference: f.reference })
        doc = editing.doc_no
        toast(`${doc} changed to ${rm(amount)}`)
      } else {
        const id = await postJournal(f.date, f.from || 'Receipt', lines, { source: 'or', reference: f.reference })
        doc = await docNo(id)
        toast(`${doc ?? 'Receipt'} saved · ${rm(amount)}`)
      }
      setF({ ...blank, date: f.date }); setEditing(null)
      setHighlight(doc ?? '')
      if (!again) setMode('list')
      load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
```

Delete the `if (done) return <Done … />` line; add `highlight={highlight}` to `DocumentList`; `autoFocus` on the Received from input; button row:

```tsx
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => { setMode('list'); setError('') }}>Cancel</button>
        {!editing && <button className="btn-light" name="again" disabled={busy}>Save & add another</button>}
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save receipt'}</button>
      </div>
```

- [ ] **Step 2: Transfer**

Same pattern in `Transfer`. The balances effect depends on `[done, mode]`; change it to `[highlight, mode]`. `submit` body from `try {`:

```tsx
    const again = submittedAgain(e)
    try {
      const name = (c: string) => accounts.find(a => a.code === c)?.name
      const desc = `Transfer ${name(f.from)} to ${name(f.to)}`
      const lines = [{ account: f.to, debit: amount }, { account: f.from, credit: amount }]
      let doc: string | undefined
      if (editing) {
        await updateJournal(editing.id, f.date, desc, lines, { reference: f.reference })
        doc = editing.doc_no
        toast(`${doc} changed to ${rm(amount)}`)
      } else {
        const id = await postJournal(f.date, desc, lines, { source: 'transfer', reference: f.reference })
        doc = await docNo(id)
        toast(`${doc ?? 'Transfer'} saved · ${rm(amount)}`)
      }
      setF({ ...f, amount: '', reference: '' }); setEditing(null)
      setHighlight(doc ?? '')
      if (!again) setMode('list')
      load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
```

`remove` and `startEdit` as in Step 1 (the wording "This transfer has an unusual shape…" stays). Button row labels: `Save transfer` / `Save changes`. `autoFocus` on the Amount input.

- [ ] **Step 3: Sales upload and Card settlement**

No `alert`/`confirm` here. Only chrome: in `UploadSales` and `CardSettlement` change every `rounded-xl border-2 border-dashed` drop zone to `rounded-lg border-2 border-dashed` and every icon button class to `btn-ghost px-1.5`. In `SalesSettings` and `ItemCategories` (same file, Setup group but touched now to finish the file): replace the two `confirm(…)` calls:

```tsx
  async function remove(code: string) {
    if (!await confirmDialog({ title: `Remove ${code}?`, body: 'Files containing it will not import until it is added back.', confirmLabel: 'Remove', danger: true })) return
    await supabase.from('payment_map').delete().eq('code', code); load()
  }
```

```tsx
  async function remove(prefix: string) {
    if (!await confirmDialog({ title: `Remove ${prefix}?`, confirmLabel: 'Remove', danger: true })) return
    await supabase.from('item_category_map').delete().eq('prefix', prefix); load()
  }
```

Add `import { confirmDialog } from '../feedback'` to `Sales.tsx`.

- [ ] **Step 4: Build, grep, commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`; `grep -n "alert(\|confirm(" src/pages/Sales.tsx` prints nothing.

```bash
git add web/src/pages/Books.tsx web/src/pages/Sales.tsx
git commit -m "feat: Money in screens on the new shell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Month-end — Payroll, Accruals, Stock count, Bank reconciliation

**Files:**
- Modify: `web/src/pages/Payroll.tsx`
- Modify: `web/src/pages/Accruals.tsx`
- Modify: `web/src/pages/Stock.tsx` (`StockCount`)
- Modify: `web/src/pages/Ledger.tsx` (`BankReconciliation`)

- [ ] **Step 1: Payroll run (`Payroll.tsx`)**

Imports: `import { confirmDialog, toast } from '../feedback'`, `import { PageActions, submittedAgain, useEscape } from '../page'`; remove `Done` from the `../ui` import.

Replace the four `confirm(` lines in `act` and the two in `markPaid`:

```tsx
  async function act(fn: string) {
    if (!runId) return
    const ok =
      fn === 'cancel_payroll_run' ? await confirmDialog({ title: 'Cancel this approved payroll?', body: 'The salary entry will be removed.', confirmLabel: 'Cancel approval', danger: true }) :
      fn === 'approve_payroll_run' ? await confirmDialog({ title: `Approve ${run ? monthName(run.month) : ''} payroll?`, body: `${slips.length} staff, net ${rm(total('net_pay'))}. It will be posted to the books (not paid yet) and the payslips locked.`, confirmLabel: 'Approve & post' }) :
      fn === 'delete_payroll_run' ? await confirmDialog({ title: 'Delete this draft payroll?', confirmLabel: 'Delete', danger: true }) :
      fn === 'rerun_payroll_run' ? await confirmDialog({ title: 'Build this draft again?', body: 'From the latest timesheet, staff and rates. Changes typed on the payslips will be lost.', confirmLabel: 'Re-run' }) :
      true
    if (!ok) return
    const { data, error } = await supabase.rpc(fn, { p_id: runId })
    if (error) return setError(error.message)
    if (fn === 'delete_payroll_run') setRunId(null)
    if (fn === 'rerun_payroll_run') setRunId(data)
    setError(''); loadRuns(); loadSlips(); loadAdvances()
    toast(fn === 'approve_payroll_run' ? 'Payroll approved and posted' : fn === 'cancel_payroll_run' ? 'Approval cancelled' : fn === 'delete_payroll_run' ? 'Draft deleted' : 'Draft rebuilt')
  }

  async function markPaid(date: string | null) {
    if (!runId) return
    const from = paidFrom ? accounts.find(a => a.code === paidFrom)?.name ?? paidFrom : ''
    const ok = date
      ? await confirmDialog({ title: `Pay ${rm(total('net_pay'))} net salaries?`, body: from ? `From ${from} on ${dmy(date)}. This posts Dr 2300 Salaries Payable / Cr ${from}.` : `Mark as paid on ${dmy(date)} without a payment entry. Only do this if a Payment Voucher from 2300 already recorded it.`, confirmLabel: 'Mark as paid' })
      : await confirmDialog({ title: 'Take off the paid mark?', body: run?.paid_journal_id ? 'The salary payment entry will be removed and the amount goes back to 2300 Salaries Payable.' : undefined, confirmLabel: 'Undo paid', danger: true })
    if (!ok) return
    const { error } = await supabase.rpc('mark_payroll_paid', { p_id: runId, p_date: date, p_from: date ? paidFrom || null : null })
    if (error) return setError(error.message)
    setError(''); loadRuns(); loadSlips()
    toast(date ? `Marked paid on ${dmy(date)}` : 'Paid mark removed')
  }
```

Move the Create button into the header: replace the `{canEdit && <> <div className="w-44">…MonthInput…</div> <button className="btn-light" onClick={create}…>Create</button> </>}` fragment with:

```tsx
        {canEdit && <PageActions>
          <div className="flex items-end gap-2">
            <div className="w-40"><MonthInput value={newMonth} onChange={setNewMonth} /></div>
            <button className="btn-light" onClick={create} disabled={busyRun}><Plus className="size-4" />Create month</button>
          </div>
        </PageActions>}
```

Change `<th className="sticky left-0 z-10">Staff</th>` and the sticky `td`s to keep `sticky left-0` (that is horizontal, still fine). Change icon buttons to `btn-ghost px-1.5`.

- [ ] **Step 2: Payslip editor Esc**

In the `if (editing) return (<form …>)` block, add before the `return`:

```tsx
  useEscape(() => { if (editing) { setEditing(null); setError('') } })
```

Hooks must run on every render, so place this line next to the other hooks at the top of `PayrollRun` (after `useEffect(loadAdvances, [runId])`), not inside the `if`.

- [ ] **Step 3: Timesheet**

Replace `clearMonth`'s first line:

```tsx
    if (!await confirmDialog({ title: `Delete all attendance for ${e.name}?`, body: `${monthLabelOf(month)} · every day cleared.`, confirmLabel: 'Clear month', danger: true })) return
```

and add near the top of the file (after `closeEnough`): `const monthLabelOf = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' })`. After a successful `fillMonth`, add `toast(`Filled ${rows.length} day${rows.length === 1 ? '' : 's'} with ${dayHours}h`)`.

- [ ] **Step 4: Staff advances**

Replace `done` state with `const [highlight, setHighlight] = useState(0)`; delete the `if (done) return <Done … />` line; add `useEscape(() => { if (mode === 'form' && !busy) { setMode('list'); setError('') } })` after the effects. In `submit`, after `if (error) return setError(error.message)`:

```tsx
    const again = submittedAgain(e)
    toast(`Salary advance of ${rm(amount)} given to ${nameOf(Number(f.employee))}`)
    setHighlight(data as number)
    setF(blankAdvance)
    if (!again) setMode('list')
    load()
  }
```

(remove the old `msg`/`doc` lookup block). `remove`:

```tsx
  async function remove(a: Advance) {
    if (!await confirmDialog({ title: 'Remove this advance?', body: `${nameOf(a.employee_id)} · ${rm(a.amount)}`, confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.rpc('delete_advance', { p_id: a.id })
    if (error) return toast(error.message, { kind: 'error' })
    load()
  }
```

Move the New advance button into `<PageActions>`; row class `className={a.id === highlight ? 'row-new' : ''}`; button row:

```tsx
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => { setMode('list'); setError('') }}>Cancel</button>
          <button className="btn-light" name="again" disabled={busy}>Save & add another</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Give advance'}</button>
        </div>
```

- [ ] **Step 5: Employees, Payroll settings, Yearly summary**

`Employees`: move the New staff button into `<PageActions>`; icon button `btn-ghost px-1.5`; after a successful save `toast(`${f.name} saved`)`. `PayrollSettings`: replace `setMsg(error ? error.message : 'Saved')` with `error ? toast(error.message, { kind: 'error' }) : toast('Rates saved')` and delete the `msg` state and its `<p>`. `PayrollYear`: no change.

- [ ] **Step 6: Accruals (`Accruals.tsx`)**

Imports `confirmDialog, toast` and `PageActions`. `remove`:

```tsx
  async function remove(id: number) {
    const i = items.find(i => i.id === id)
    if (!await confirmDialog({ title: `Remove ${i?.name ?? 'this line'} from the monthly list?`, confirmLabel: 'Remove', danger: true })) return
    await supabase.from('recurring_accruals').update({ active: false }).eq('id', id); load()
  }
```

`post`: replace the `confirm` line with `if (posted && !await confirmDialog({ title: `Replace ${monthLabel(month)}?`, body: `${posted.doc_no} already holds this month's accrual.`, confirmLabel: 'Replace' })) return`, and `setMsg(data ? … : …)` with `toast(data ? `Posted for ${monthLabel(month)}` : 'Nothing to post')`. Delete the `msg` state and its `<p>`. Move the Post button into `<PageActions>` (keep `disabled={busy || total <= 0}` and its label).

- [ ] **Step 7: Stock count and Item costs (`Stock.tsx`)**

`StockCount`: replace `setMsg(data ? 'Stock count posted' : 'Nothing to adjust: the count matches the books')` with `toast(data ? 'Stock count posted' : 'Nothing to adjust: the count matches the books')`; delete `msg` state and its `<p>`. `ItemCosts`: `if (error) return setMsg(error.message)` → `if (error) return toast(error.message, { kind: 'error' })`; delete `msg`. Import `toast`.

- [ ] **Step 8: Bank reconciliation (`Ledger.tsx`)**

In `toggle`: `if (error) return toast(error.message, { kind: 'error' })`. Import `toast` from `../feedback` (the file also gets `confirmDialog` in Task 10).

- [ ] **Step 9: Build, grep, commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`; `grep -n "alert(\|confirm(\|<Done\|setMsg" src/pages/Payroll.tsx src/pages/Accruals.tsx src/pages/Stock.tsx` prints nothing.

```bash
git add web/src/pages/Payroll.tsx web/src/pages/Accruals.tsx web/src/pages/Stock.tsx web/src/pages/Ledger.tsx
git commit -m "feat: Month-end screens on the new shell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Books and Setup — Documents, Journal entry, Ledger, Chart of accounts, Users, Company

**Files:**
- Modify: `web/src/pages/Books.tsx` (`JournalListing`)
- Modify: `web/src/pages/Ledger.tsx` (`ChartOfAccounts`, `JournalEntry`)
- Modify: `web/src/pages/Admin.tsx`
- Modify: `web/src/pages/Reports.tsx` (chrome only)
- Modify: `web/src/pages/Dashboard.tsx` (none; confirm the header reads right)

- [ ] **Step 1: Documents (`JournalListing` in `Books.tsx`)**

```tsx
  async function remove(r: EntryRow) {
    if (!await confirmDialog({ title: `Delete ${r.doc_no}?`, body: `${r.description}. This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.rpc('delete_journal', { p_id: r.id })
    if (error) return toast(error.message, { kind: 'error' })
    setRows(rows.filter(x => x.id !== r.id))
  }
```

Change the Delete button's handler to `onClick={() => remove(r)}` and its class to `btn-ghost px-1.5 hover:bg-red-50 hover:text-red-600`; the paperclip button to `btn-ghost px-1.5`; the Open / Fix here link stays a `link`.

- [ ] **Step 2: Chart of accounts (`Ledger.tsx`)**

Imports: `import { confirmDialog, toast } from '../feedback'`, `import { PageActions, submittedAgain, useEscape } from '../page'`; remove `Done` from `../ui`. In `ChartOfAccounts.update`: `if (error) toast(error.message, { kind: 'error' })`. In `add`, after `setF(…); setError(''); load()` add `toast(`Account ${f.code} added`)`.

- [ ] **Step 3: Journal entry**

Replace `done` state with `const [highlight, setHighlight] = useState('')`; add `useEscape(() => { if (mode === 'form' && !busy) { setMode('list'); setError('') } })` after `useEffect(load, [all])`. `remove`:

```tsx
  async function remove(d: DocRow) {
    if (!await confirmDialog({ title: `Delete ${d.doc_no}?`, body: `${d.description} · ${rm(docTotal(d))}. This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.rpc('delete_journal', { p_id: d.id })
    if (error) return toast(error.message, { kind: 'error' })
    load()
  }
```

(add `docTotal` to the `../lib` import). In `submit`, from `try {`:

```tsx
    const again = submittedAgain(e)
    try {
      const payload = used.map(l => ({
        account: l.account, memo: l.memo || undefined,
        ...(Number(l.debit) ? { debit: round2(Number(l.debit)) } : { credit: round2(Number(l.credit)) }),
      }))
      let doc = ''
      if (editing) {
        await updateJournal(editing.id, head.date, head.description, payload, { reference: head.reference })
        doc = editing.doc_no
        toast(`${doc} changed`)
      } else {
        const id = await postJournal(head.date, head.description, payload,
          { source: 'jv', reference: head.reference, supplier: head.supplier ? Number(head.supplier) : undefined })
        const { data } = await supabase.from('journals').select('doc_no').eq('id', id).single()
        doc = data?.doc_no ?? ''
        toast(`${doc || 'Journal'} saved · ${rm(dr)}`)
      }
      setEditing(null)
      setHead({ ...head, description: '', reference: '', supplier: '' })
      setLines([emptyLine(), emptyLine()])
      setHighlight(doc)
      if (!again) setMode('list')
      load()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
```

Delete the `if (done !== null) return <Done … />` lines; add `highlight={highlight}` to `DocumentList`; `autoFocus` on the Description input; replace the save button with:

```tsx
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => { setMode('list'); setError('') }}>Cancel</button>
          {!editing && <button className="btn-light" name="again" disabled={busy || !balanced}>Save & add another</button>}
          <button className="btn" disabled={busy || !balanced}>{busy ? 'Saving…' : 'Save journal'}</button>
        </div>
```

- [ ] **Step 4: Users and Company (`Admin.tsx`)**

Imports `confirmDialog, toast`. `update`: `if (error) toast(error.message, { kind: 'error' })`. `addPerson`: `if (error) return toast(error.message, { kind: 'error' })` and the success alert → `toast(`Added. ${add.full_name} signs in as "${add.username.trim().toLowerCase()}".`)`. `resetPassword` keeps `prompt(…)`; its alert → `error ? toast(error.message, { kind: 'error' }) : toast(`Password changed. Tell ${p.full_name} the new one.`)`. `setActive`:

```tsx
  async function setActive(p: Profile, active: boolean) {
    if (!active && !await confirmDialog({ title: `Disable ${p.full_name}?`, body: 'They are signed out and cannot sign in until enabled again. Their records stay.', confirmLabel: 'Disable', danger: true })) return
    const { error } = await supabase.rpc('set_login_active', { p_user: p.id, p_active: active })
    if (error) toast(error.message, { kind: 'error' })
    load()
  }
```

`CompanyDetails.save`: `error ? toast(error.message, { kind: 'error' }) : toast('Company details saved')`; keep `msg` only for the "run 026 first" load error.

- [ ] **Step 5: Reports and Today**

`Reports.tsx`: the quick-range buttons (`This month`, `Last month`, `Year to date`) become `btn-ghost`. Nothing else; statements are slice D. `Dashboard.tsx`: `QuickButton` class `btn-light h-8`. Open `/` mentally: header shows the greeting and date from the Shell, as before.

- [ ] **Step 6: Build, grep, commit**

Run in `web/`: `npx tsc -b && npx oxlint && npm run build`; `grep -rn "alert(\|confirm(\|<Done" src/` prints nothing except `prompt(` in `Admin.tsx`.

```bash
git add web/src/pages/Books.tsx web/src/pages/Ledger.tsx web/src/pages/Admin.tsx web/src/pages/Reports.tsx web/src/pages/Dashboard.tsx
git commit -m "feat: Books and Setup screens on the new shell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Remove what is left over, document, push

**Files:**
- Modify: `web/src/ui.tsx` (delete `Done`)
- Modify: `README.md`

- [ ] **Step 1: Delete `Done`**

Remove the `Done` function from `web/src/ui.tsx` and the now-unused `CheckCircle2` import if nothing else in the file uses it. Run `grep -rn "Done\b" web/src` and confirm no import remains.

- [ ] **Step 2: Final checks**

Run in `web/`: `npm run test:dash && npm run test:ui && npm run test:db && npm run test:rls && npx tsc -b && npx oxlint && npm run build`. Expected: all tests print their `ok` lines with no `FAIL`; build succeeds.

- [ ] **Step 3: README**

In `README.md` under "Everyday notes" add:

```markdown
- The side menu is grouped by task: **Today**, **Money in**, **Money out**, **Month-end**, **Books**, **Setup**. On a phone the bottom bar has Today, Search, New and Menu. Every screen keeps its old web address, so bookmarks still work.
- After saving a voucher, receipt, transfer, invoice or journal, the list comes back with the new row highlighted; press **Save & add another** to stay on the form. Esc closes a form.
```

- [ ] **Step 4: Commit, merge, push**

```bash
git add web/src/ui.tsx README.md
git commit -m "chore: remove the Done screen; README notes for the new menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout master && git merge --no-ff ux-shell -m "Merge branch 'ux-shell': UX slice A, shell and design system" && git push origin master
```

Pushing deploys the live site (3–8 minutes). Then the owner checks each group on the live site: post one PV with Save & add another, delete it from the list (confirm dialog), pay an invoice, approve and cancel a draft payroll, and open the site on a phone to see the bottom bar.

---

## Self-review

**Spec coverage:** tokens (Task 1); rail groups and every URL (Task 5); header slot and section tabs (Tasks 4–6); phone bottom bar Today·Search·New·Menu and New sheet (Task 5); PageActions on every list screen (Tasks 6–10); Save & add another on PV, OR, Transfer, Journal, Purchase invoice, Staff advance (Tasks 7–10); after-save highlight and toast, `Done` deleted (Tasks 6–11); Empty/Loading/error unchanged; toast and confirm with amounts and document numbers (Tasks 2–3, 7–10); `.btn-ghost`/`.btn-danger` (Task 1); due-date pills (Tasks 4, 7); Esc hook on forms (Tasks 4, 7–10); tests for `dueLabel` and the toast store (Tasks 2, 4); README (Task 11). Sticky table headers: deliberately dropped, stated in Global Constraints.

**Placeholders:** none; every code step shows the code. "Same pattern" references in Task 8 repeat the full `submit`, `remove` and button-row code.

**Type consistency:** `toast(message, { kind, action })` and `confirmDialog({ title, body, confirmLabel, danger })` are used with those exact names throughout; `submittedAgain(e)` takes the form event; `DocumentList.highlight` is a `doc_no` string, while `SupplierPayments` and `StaffAdvances` highlight by numeric id against `p.id` / `a.id`; `Pill tone` is `'none' | 'ok' | 'warn' | 'danger'` matching `dueLabel().tone`.
