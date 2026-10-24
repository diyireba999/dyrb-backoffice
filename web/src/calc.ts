// Tiny calculator for amount boxes: "12.50 + 8 + 30", "3 x 12.5", "(10+5)/2".
// null when the text is not a sum. No imports: this file is run by the Node assert tests.
export function calc(text: string): number | null {
  const s = text.replace(/\s+|,/g, '').replace(/×|x/gi, '*').replace(/÷/g, '/')
  if (!s || !/^[\d.+\-*/()]+$/.test(s)) return null
  let i = 0
  const num = (): number | null => {
    if (s[i] === '(') { i++; const v = sum(); if (s[i] !== ')') return null; i++; return v }
    if (s[i] === '-') { i++; const v = num(); return v === null ? null : -v }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    return Number(m[0])
  }
  const prod = (): number | null => {
    let v = num()
    while (v !== null && (s[i] === '*' || s[i] === '/')) { const op = s[i++]; const r = num(); if (r === null) return null; v = op === '*' ? v * r : v / r }
    return v
  }
  const sum = (): number | null => {
    let v = prod()
    while (v !== null && (s[i] === '+' || s[i] === '-')) { const op = s[i++]; const r = prod(); if (r === null) return null; v = op === '+' ? v + r : v - r }
    return v
  }
  const v = sum()
  return v !== null && i === s.length && Number.isFinite(v) ? v : null
}
