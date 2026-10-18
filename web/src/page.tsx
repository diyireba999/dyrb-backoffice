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
export const submittedAgain = (e: React.FormEvent) =>
  ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.name === 'again'
