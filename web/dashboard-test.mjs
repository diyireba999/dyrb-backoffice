import assert from 'node:assert/strict'
import {
  addDaysISO, breakEven, daysInMonth, pctChange, sameWeekdayLastWeek, sumRange, variableRate,
  supplierInvoiceCategory, shiftMonths, comparePeriod,
} from './src/dashboard-math.ts'

// --- date helpers ---
assert.equal(addDaysISO('2026-09-27', 1), '2026-09-28')
assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01', 'crosses the year')
assert.equal(addDaysISO('2027-03-01', -1), '2027-02-28', 'non-leap February')
assert.equal(addDaysISO('2028-03-01', -1), '2028-02-29', 'leap February')
assert.equal(sameWeekdayLastWeek('2026-09-27'), '2026-09-20')
assert.equal(daysInMonth('2026-02'), 28)
assert.equal(daysInMonth('2028-02'), 29)
assert.equal(daysInMonth('2026-09'), 30)
assert.equal(daysInMonth('2026-12'), 31)

// --- sumRange is inclusive at both ends and ignores days outside it ---
const days = [
  { date: '2026-09-01', amount: 100 },
  { date: '2026-09-02', amount: 200 },
  { date: '2026-09-03', amount: 400 },
]
assert.equal(sumRange(days, '2026-09-01', '2026-09-02'), 300)
assert.equal(sumRange(days, '2026-09-02', '2026-09-02'), 200)
assert.equal(sumRange(days, '2026-09-04', '2026-09-30'), 0, 'no days in range is zero, not NaN')

// Values arriving as strings from PostgREST must not concatenate.
const stringy = [{ date: '2026-09-01', amount: '100' }, { date: '2026-09-02', amount: '200' }]
assert.equal(sumRange(stringy, '2026-09-01', '2026-09-02'), 300, 'string amounts are coerced, not concatenated')

// --- variable rate ---
assert.equal(variableRate({ costOfSales: 3000, cardFees: 200, sales: 10000 }), 0.32)
assert.equal(variableRate({ costOfSales: 0, cardFees: 0, sales: 0 }), null, 'no sales means no rate')

// --- break-even ---
// fixed 30000, variable rate 0.32 -> 30000 / 0.68 = 44117.65 a month, /30 = 1470.59 a day
assert.equal(breakEven({ fixed: 30000, variableRate: 0.32, daysInMonth: 30 }), 1470.59)
assert.equal(breakEven({ fixed: 30000, variableRate: 1, daysInMonth: 30 }), null, 'variable eats every ringgit')
assert.equal(breakEven({ fixed: 30000, variableRate: 1.2, daysInMonth: 30 }), null, 'variable exceeds sales')
assert.equal(breakEven({ fixed: 0, variableRate: 0.32, daysInMonth: 30 }), 0, 'no fixed costs, break even at zero')
assert.equal(breakEven({ fixed: 30000, variableRate: null, daysInMonth: 30 }), null, 'no variable rate means no break-even')
assert.equal(breakEven({ fixed: 30000, variableRate: 0.32, daysInMonth: 0 }), null, 'no days means no daily figure')
assert.equal(breakEven({ fixed: 30000, variableRate: -0.1, daysInMonth: 30 }), 909.09, 'negative variable rate (credit note) gives lower break-even')

// --- percentage change ---
assert.equal(pctChange(110, 100), 10)
assert.equal(pctChange(90, 100), -10)
assert.equal(pctChange(133.333, 100), 33.3, 'one-decimal rounding on fractional percent')
assert.equal(pctChange(100, 0), null, 'no baseline means no percentage')
assert.equal(pctChange(0, 0), null)

// --- supplier invoice categorization ---
const today = '2026-09-27'
const cutoff = addDaysISO(today, 7) // '2026-10-04'
assert.equal(supplierInvoiceCategory('2026-09-26', today, cutoff), 'overdue', 'due yesterday')
assert.equal(supplierInvoiceCategory('2026-09-27', today, cutoff), 'dueSoon', 'due exactly today is dueSoon, not overdue')
assert.equal(supplierInvoiceCategory('2026-10-04', today, cutoff), 'dueSoon', 'due exactly at cutoff')
assert.equal(supplierInvoiceCategory('2026-10-05', today, cutoff), 'neither', 'due after cutoff')

console.log('dashboard math ok')

// --- report comparison periods ---
assert.equal(shiftMonths('2026-03-31', -1), '2026-02-28', 'month-end stays month-end')
assert.equal(shiftMonths('2026-02-28', -1), '2026-01-31', 'Feb end goes to Jan end')
assert.equal(shiftMonths('2026-01-15', -1), '2025-12-15', 'crosses the year')
assert.deepEqual(comparePeriod('2026-09-01', '2026-09-30', 'prev'), ['2026-08-01', '2026-08-31'], 'whole month')
assert.deepEqual(comparePeriod('2026-10-01', '2026-10-04', 'prev'), ['2026-09-01', '2026-09-04'], 'month to date')
assert.deepEqual(comparePeriod('2026-01-01', '2026-03-31', 'prev'), ['2025-10-01', '2025-12-31'], 'quarter')
assert.deepEqual(comparePeriod('2026-09-10', '2026-09-19', 'prev'), ['2026-08-31', '2026-09-09'], 'ten odd days')
assert.deepEqual(comparePeriod('2028-02-01', '2028-02-29', 'year'), ['2027-02-01', '2027-02-28'], 'leap year end')
assert.equal(comparePeriod('', '2026-09-30', 'prev'), null, 'half-typed date')
assert.equal(comparePeriod('2026-09-01', '2026-09-30', 'none'), null)
console.log('report periods ok')
