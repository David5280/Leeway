// A bill paid twice in a cycle, told once (leaks/doublePaidBills.ts): as
// "Charged twice?" while that shows it, and never later as a bill change.

import { describe, expect, it } from 'vitest'
import type { BillChange, WatchedBill } from '../src/domain/billChanges.js'
import type { BillCharge } from '../src/domain/billCycles.js'
import { wasPaidTwice, withoutDoublePaid } from '../src/domain/leaks/doublePaidBills.js'
import {
  DUPLICATE_DAYS,
  DUPLICATE_NEWS_DAYS,
  type DuplicateCharge,
} from '../src/domain/leaks/duplicates.js'
import { addDays } from '../src/lib/dates.js'

const TODAY = '2026-11-17'

const bill: WatchedBill = {
  id: 'bill-1',
  name: 'Gym',
  amountCents: 8999,
  cadence: 'month',
  trackedOn: '2026-01-01',
  amountVaries: false,
  amountSetOn: null,
  followAfterOn: null,
  charges: [],
}

/** A charge on the checking account. */
const paid = (date: string, amountCents: number, accountId = 'checking'): BillCharge => ({
  accountId,
  date,
  amountCents,
})

/** The bill's changed cycle, from its charges, newest first. */
function changed(...cycle: BillCharge[]): Extract<BillChange, { kind: 'changed' }> {
  const total = cycle.reduce((sum, charge) => sum + charge.amountCents, 0)
  return { kind: 'changed', bill, charge: { ...cycle[0]!, amountCents: total }, cycle }
}

/** "Charged twice?" for these charges, oldest first. */
const double = (...charges: BillCharge[]): DuplicateCharge => ({
  accountId: charges[0]!.accountId,
  charges: charges.map((charge, i) => ({
    ...charge,
    id: `tx-${i}`,
    name: 'GYM',
    merchantName: 'Gym',
  })),
})

describe('wasPaidTwice', () => {
  it('says so for the usual amount charged twice within a few days', () => {
    expect(wasPaidTwice(changed(paid('2026-11-04', 8999), paid('2026-11-03', 8999)))).toBe(true)
    // Three times over three days too.
    const thrice = changed(
      paid('2026-11-05', 8999),
      paid('2026-11-04', 8999),
      paid('2026-11-03', 8999),
    )
    expect(wasPaidTwice(thrice)).toBe(true)
  })

  it(`not when the charges are more than ${DUPLICATE_DAYS} days apart, or on two accounts`, () => {
    expect(wasPaidTwice(changed(paid('2026-11-10', 8999), paid('2026-11-03', 8999)))).toBe(false)
    expect(wasPaidTwice(changed(paid('2026-11-04', 8999), paid('2026-11-03', 8999, 'card')))).toBe(
      false,
    )
  })

  it('not when the price went up too, since that is news of its own', () => {
    expect(wasPaidTwice(changed(paid('2026-11-04', 9999), paid('2026-11-03', 9999)))).toBe(false)
  })

  it('not for a cycle with no repeat, or with two different amounts', () => {
    expect(wasPaidTwice(changed(paid('2026-11-04', 12000)))).toBe(false)
    expect(wasPaidTwice(changed(paid('2026-11-04', 8999), paid('2026-11-03', 4000)))).toBe(false)
  })
})

describe('withoutDoublePaid', () => {
  const twice = [paid('2026-11-04', 8999), paid('2026-11-03', 8999)] as const
  const told = double(twice[1], twice[0])

  it('leaves out a cycle paid twice that "Charged twice?" shows', () => {
    expect(withoutDoublePaid([changed(...twice)], [told], TODAY)).toEqual([])
  })

  it('keeps it while news if no "Charged twice?" shows it, so it is told once', () => {
    const change = changed(...twice)
    expect(withoutDoublePaid([change], [], TODAY)).toEqual([change])
    // One on another account, or ending another day, is not this cycle's.
    const elsewhere = double(paid('2026-11-03', 8999, 'card'), paid('2026-11-04', 8999, 'card'))
    const earlier = double(paid('2026-11-02', 8999), paid('2026-11-03', 8999))
    // Nor is one for another amount the same day, as a second shop's double.
    const otherAmount = double(paid('2026-11-03', 2500), paid('2026-11-04', 2500))
    expect(withoutDoublePaid([change], [elsewhere, earlier, otherAmount], TODAY)).toEqual([change])
  })

  it(`leaves it out once the double charge is past its ${DUPLICATE_NEWS_DAYS} days of news`, () => {
    const change = changed(...twice)
    const lastNewsDay = addDays('2026-11-04', DUPLICATE_NEWS_DAYS - 1)
    expect(withoutDoublePaid([change], [], lastNewsDay)).toEqual([change])
    expect(withoutDoublePaid([change], [], addDays(lastNewsDay, 1))).toEqual([])
  })

  it('tells a price change paid twice at what the cycle cost paid once', () => {
    // The gym went from $89.99 to $99.99 and the $99.99 went through twice.
    const rose = [paid('2026-11-04', 9999), paid('2026-11-03', 9999)] as const
    const change = changed(...rose)
    expect(change.charge.amountCents).toBe(19998)
    expect(withoutDoublePaid([change], [double(rose[1], rose[0])], TODAY)).toEqual([
      { ...change, charge: { ...change.charge, amountCents: 9999 }, cycle: [rose[1]] },
    ])
    // With no "Charged twice?" telling the repeat, the cycle's full cost is the news.
    expect(withoutDoublePaid([change], [], TODAY)).toEqual([change])
  })

  it('keeps every other change and a settled one', () => {
    const rise = changed(paid('2026-11-04', 12000))
    const settled: BillChange = { kind: 'settled', bill, amountCents: 9500 }
    expect(withoutDoublePaid([rise, settled], [told], TODAY)).toEqual([rise, settled])
  })
})
