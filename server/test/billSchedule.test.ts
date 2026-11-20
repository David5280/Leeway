import { describe, expect, it } from 'vitest'
import { dueBefore, scheduleOf, type BillInput } from '../src/domain/bills.js'

const TODAY = '2026-11-17'

/** A stored bill: rent due on the 1st, matched by "landlord", with no payment yet. */
function bill(fields: Partial<BillInput> & { lastPaidDate?: string | null } = {}) {
  return {
    id: 'bill-1',
    name: 'Rent',
    kind: 'bill' as const,
    amountCents: 150000,
    cadence: 'month' as const,
    anchorDate: '2026-01-01',
    matchPattern: 'landlord',
    categoryId: null,
    autopay: false,
    reads: 'bank_text' as const,
    accountId: null,
    lastPaidCents: fields.lastPaidDate ? 150000 : null,
    lastPaidDate: null,
    ...fields,
  }
}

describe('scheduleOf', () => {
  it('shows the next due date as upcoming when it cannot see payments', () => {
    const rent = scheduleOf(bill({ matchPattern: null }), TODAY)
    expect(rent).toMatchObject({ nextDueDate: '2026-12-01', daysUntilDue: 14, status: 'upcoming' })
  })

  it('shows a bill as paid when this cycle was paid and the next is not close', () => {
    const rent = scheduleOf(bill({ lastPaidDate: '2026-10-30' }), TODAY)
    expect(rent).toMatchObject({ nextDueDate: '2026-12-01', status: 'paid' })
  })

  it('flags the latest due date as overdue when no payment matched it', () => {
    const rent = scheduleOf(bill({ lastPaidDate: '2026-10-01' }), TODAY)
    expect(rent).toMatchObject({ nextDueDate: '2026-11-01', daysUntilDue: -16, status: 'overdue' })
  })

  it('never calls an autopay bill overdue', () => {
    const rent = scheduleOf(bill({ autopay: true, lastPaidDate: '2026-10-01' }), TODAY)
    expect(rent).toMatchObject({ nextDueDate: '2026-12-01', status: 'upcoming' })
  })

  it('marks a bill due within a week as due soon', () => {
    const phone = scheduleOf(bill({ anchorDate: '2026-01-20', lastPaidDate: '2026-10-19' }), TODAY)
    expect(phone).toMatchObject({ nextDueDate: '2026-11-20', daysUntilDue: 3, status: 'due_soon' })
  })

  it('moves on to the following due date after an early payment', () => {
    const phone = scheduleOf(bill({ anchorDate: '2026-01-20', lastPaidDate: '2026-11-14' }), TODAY)
    expect(phone).toMatchObject({ nextDueDate: '2026-12-20', status: 'paid' })
  })

  it('does not let one payment cover two weekly due dates', () => {
    const lessons = scheduleOf(
      bill({ cadence: 'week', anchorDate: '2026-11-03', lastPaidDate: '2026-11-10' }),
      TODAY,
    )
    // Due the 10th (paid) and the 17th (today, not paid yet).
    expect(lessons).toMatchObject({
      nextDueDate: '2026-11-17',
      daysUntilDue: 0,
      status: 'due_soon',
    })
  })

  it('waits for a first due date still in the future', () => {
    const gym = scheduleOf(bill({ anchorDate: '2027-01-15' }), TODAY)
    expect(gym).toMatchObject({ nextDueDate: '2027-01-15', daysUntilDue: 59, status: 'upcoming' })
  })

  it('spreads the amount over a month to compare cadences', () => {
    expect(scheduleOf(bill({ cadence: 'year', amountCents: 12000 }), TODAY).monthlyCents).toBe(1000)
    expect(scheduleOf(bill({ cadence: 'week', amountCents: 1000 }), TODAY).monthlyCents).toBe(4348)
  })
})

describe('dueBefore', () => {
  it('lists every unpaid due date up to a day, starting with an overdue one', () => {
    const lessons = scheduleOf(
      bill({ cadence: 'week', anchorDate: '2026-11-03', lastPaidDate: '2026-11-03' }),
      TODAY,
    )
    expect(lessons.status).toBe('overdue')
    expect(dueBefore(lessons, '2026-12-01')).toEqual(['2026-11-10', '2026-11-17', '2026-11-24'])
  })

  it('leaves out the end day itself, and is empty when nothing is due before it', () => {
    const rent = scheduleOf(bill({ lastPaidDate: '2026-10-30' }), TODAY)
    expect(dueBefore(rent, '2026-12-01')).toEqual([])
    expect(dueBefore(rent, '2026-12-02')).toEqual(['2026-12-01'])
  })
})
