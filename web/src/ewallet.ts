// E-wallet money (account 1210) taken per sale day and wallet, less what has
// already been moved to the bank. No imports: this file is run by the Node tests.

export type WalletLine = { date: string; code: string; debit: number }
export type WalletRow = { date: string; code: string; gross: number; posted: boolean }

const round2 = (n: number) => Math.round(n * 100) / 100

// One entry per sale day and wallet, so the same day can be settled wallet by wallet.
export const walletRef = (date: string, code: string) => `${date} ${code}`

export function walletRows(lines: WalletLine[], settledRefs: Iterable<string>): WalletRow[] {
  const settled = new Set(settledRefs)
  const by = new Map<string, WalletRow>()
  for (const l of lines) {
    if (!(Number(l.debit) > 0)) continue
    const code = (l.code ?? '').trim() || 'E-wallet'
    const ref = walletRef(l.date, code)
    const r = by.get(ref) ?? { date: l.date, code, gross: 0, posted: settled.has(ref) }
    r.gross = round2(r.gross + Number(l.debit))
    by.set(ref, r)
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))
}
