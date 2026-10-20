// Amount in words for signed documents, Malaysian cheque style:
// "Ringgit Malaysia one thousand two hundred and fifty and sen fifty only".
// No imports: this file is run by the Node assert tests.

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

// Whole numbers below a billion.
export function numberInWords(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + numberInWords(n % 100) : '')
  const chunk = (size: number, name: string) => {
    const head = Math.floor(n / size), rest = n % size
    return numberInWords(head) + ' ' + name + (rest ? (rest < 100 ? ' and ' : ' ') + numberInWords(rest) : '')
  }
  if (n < 1_000_000) return chunk(1000, 'thousand')
  return chunk(1_000_000, 'million')
}

export function ringgitInWords(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100)
  const rm = Math.floor(cents / 100), sen = cents % 100
  return `Ringgit Malaysia ${rm ? numberInWords(rm) : 'zero'}${sen ? ' and sen ' + numberInWords(sen) : ''} only`
}
