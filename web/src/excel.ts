// Turns report rows into write-excel-file cells: bold header, money cells formatted
// and right-aligned, columns sized to their content. Pure, so it is tested.

export type Cell = {
  value: string | number
  type?: NumberConstructor | StringConstructor
  format?: string
  fontWeight?: 'bold'
  align?: 'right'
} | null

export const MONEY = '#,##0.00'
const moneyText = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function toSheet(rows: (string | number)[][]): { data: Cell[][]; columns: { width: number }[] } {
  const widths: number[] = []
  const data = rows.map((row, r) => row.map((v, c): Cell => {
    const text = typeof v === 'number' ? moneyText(v) : String(v)
    widths[c] = Math.max(widths[c] ?? 0, text.length)
    const bold = r === 0 ? { fontWeight: 'bold' as const } : {}
    if (typeof v === 'number' && !Number.isFinite(v)) return { value: String(v), type: String, ...bold }
    if (typeof v === 'number') return { value: v, type: Number, format: MONEY, align: 'right', ...bold }
    if (v === '') return null
    return { value: v, type: String, ...bold }
  }))
  return { data, columns: widths.map(w => ({ width: Math.min(48, Math.max(8, w + 2)) })) }
}
