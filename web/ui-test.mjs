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
const before = notified
store.dismiss(999)
assert.equal(notified, before, 'dismissing a missing id is silent')
assert.equal(notified, 4, 'listeners told on push, push, dismiss, expire')
console.log('toast store ok')

// Amount-box calculator.
const { calc } = await import('./src/calc.ts')
assert.equal(calc('12.50 + 8 + 30'), 50.5)
assert.equal(calc('3 x 12.5'), 37.5)
assert.equal(calc('(10+5)/2 - 1'), 6.5)
assert.equal(calc('1,200.40'), 1200.4)
assert.equal(calc('-5 + 7'), 2)
assert.equal(calc(''), null, 'empty is not a sum')
assert.equal(calc('12 +'), null, 'dangling operator')
assert.equal(calc('abc'), null)
assert.equal(calc('1/0'), null, 'division by zero is not a number')
console.log('calc ok')
