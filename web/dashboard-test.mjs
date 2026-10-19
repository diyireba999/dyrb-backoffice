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

// --- Zeoniq date order: a day above 12 settles it; otherwise the tighter range wins ---
const { dateOrderOf, isoDate } = await import('./src/zeoniq.ts')
assert.equal(dateOrderOf(['21/9/2026', '22/9/2026']), 'dmy')
assert.equal(dateOrderOf(['9/21/26', '9/22/26']), 'mdy')
assert.equal(dateOrderOf(['10/1/26', '10/2/26', '10/12/26']), 'mdy', '1-12 Oct month-first: not twelve different months')
assert.equal(dateOrderOf(['1/10/26', '2/10/26', '12/10/26']), 'dmy', '1-12 Oct day-first')
assert.equal(dateOrderOf(['5/10/26']), 'dmy', 'one ambiguous day stays day-first')
assert.equal(isoDate('10/1/26', dateOrderOf(['10/1/26', '10/2/26', '10/3/26'])), '2026-10-01')
console.log('zeoniq date order ok')

// --- due-date pill text ---
const { dueLabel } = await import('./src/dashboard-math.ts')
assert.deepEqual(dueLabel('2026-10-17', '2026-10-18'), { text: 'Overdue', tone: 'danger' })
assert.deepEqual(dueLabel('2026-10-18', '2026-10-18'), { text: 'Due today', tone: 'warn' })
assert.deepEqual(dueLabel('2026-10-20', '2026-10-18'), { text: 'Due Tue', tone: 'warn' }, 'within a week: weekday')
assert.deepEqual(dueLabel('2026-10-24', '2026-10-18'), { text: 'Due Sat', tone: 'warn' }, 'six days out still a weekday')
assert.deepEqual(dueLabel('2026-10-25', '2026-10-18'), { text: 'Due 25/10', tone: 'none' }, 'a week or more: date')
console.log('due label ok')

// --- to-do sentences from month statuses ---
const { todoItems, listDays } = await import('./src/dashboard-math.ts')
const done = { days_missing: [], days_closed: [], card_unsettled: 0, card_since: null, timesheet_rows: 0, active_staff: 2,
  payroll: { status: 'paid', run_id: 1 }, accruals_posted: true, stock_count_posted: true, bank_uncleared: 0,
  invoices_entered: true, closed_at: '2026-10-03T00:00:00Z' }
const oct = { ...done, month: '2026-10-01' }, sep = { ...done, month: '2026-09-01' }
const T = '2026-10-19'
assert.deepEqual(todoItems([oct, sep], T), [], 'all done: nothing waiting')
assert.equal(listDays(['2026-10-16', '2026-10-17']), '16 Oct, 17 Oct')
assert.equal(listDays(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']), '10 Oct, 11 Oct, 12 Oct and 2 more')
let items = todoItems([{ ...oct, days_missing: ['2026-10-16', '2026-10-17'] }, sep], T)
assert.equal(items[0].text, 'Sales not uploaded: 16 Oct, 17 Oct')
assert.deepEqual([items[0].to, items[0].action, items[0].days], ['/sales/upload', 'Upload', ['2026-10-16', '2026-10-17']])
assert.equal(todoItems([{ ...oct, card_unsettled: 1234, card_since: '2026-10-14' }, sep], T)[0].text, 'Card takings RM 1,234.00 waiting since 14 Oct')
assert.equal(todoItems([{ ...oct, card_unsettled: 50.5, card_since: null }, sep], T)[0].text, 'Card takings RM 50.50 waiting')
assert.equal(todoItems([oct, { ...sep, card_unsettled: 99 }], T).length, 0, 'card check is for this month only')
items = todoItems([{ ...oct, payroll: { status: 'draft', run_id: 9 } }, sep], T)
assert.deepEqual([items[0].text, items[0].action], ['October payroll is a draft', 'Open'])
items = todoItems([oct, { ...sep, payroll: { status: 'approved', run_id: 8 }, closed_at: null }], T)
assert.deepEqual([items[0].text, items[0].to, items[0].action], ['September payroll approved, not paid', '/payroll/run', 'Pay'])
assert.equal(items.length, 1, 'payroll approved but everything else done: no "not closed" row')
items = todoItems([oct, { ...sep, closed_at: null, accruals_posted: false, bank_uncleared: 3 }], T)
assert.deepEqual([items[0].text, items[0].to, items[0].action], ['September not closed: accruals, bank', '/month-end', 'Month-end'])
assert.equal(todoItems([oct, { ...sep, closed_at: null, payroll: { status: 'none', run_id: null }, stock_count_posted: false }], T)[0].text, 'September not closed: stock count, payroll')
assert.equal(todoItems([{ ...oct, month: '2026-11-01', payroll: { status: 'draft', run_id: 1 } }, sep], T).length, 0, 'a month not started is quiet')

// Boundaries and gates a regression could slip past.
assert.equal(todoItems([oct, { ...sep, accruals_posted: false }], T).length, 0, 'a closed month never reports "not closed"')
assert.equal(listDays(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']), '10 Oct, 11 Oct, 12 Oct, 13 Oct', 'four days are listed in full')
items = todoItems([{ ...oct, card_unsettled: 10, card_since: null }, sep], T)
assert.deepEqual([items[0].to, items[0].action], ['/sales/fiuu', 'Settle'])
items = todoItems([{ ...oct, payroll: { status: 'draft', run_id: 9 } }, sep], T)
assert.deepEqual([items[0].to, items[0].action], ['/payroll/run', 'Open'])
assert.equal(todoItems([oct, { ...sep, closed_at: null, accruals_posted: false, stock_count_posted: false, bank_uncleared: 1, payroll: { status: 'none', run_id: null } }], T)[0].text,
  'September not closed: accruals, stock count, bank, payroll', 'full close list in order')
items = todoItems([oct, { ...sep, days_missing: ['2026-09-29'] }], T)
assert.deepEqual([items[0].text, items[0].to], ['Sales not uploaded: 29 Sept', '/sales/upload'], 'last month\'s missing days are listed too')
console.log('todo items ok')
