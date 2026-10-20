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
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return
      onEscape()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onEscape])
}

// Which submit button was pressed: <button name="again"> is "Save & add another".
// Print one document (payslips, a signed form) instead of the page around it:
// `.print-doc` parts show and `.print-page` parts hide while `printing-doc` is on <body>.
export function printDocument() {
  document.body.classList.add('printing-doc')
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-doc'), { once: true })
  setTimeout(() => window.print())  // let the document render first
}

export const submittedAgain = (e: React.FormEvent) =>
  ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.name === 'again'
