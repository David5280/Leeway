import { describe, expect, it } from 'vitest'
import { monthYear } from '../../lib/format'
import { bill } from '../../test/planning'
import { billStatus, dueText, durationText } from './text'

describe('dueText', () => {
  it('counts the days while they are close, then gives the date', () => {
    expect(dueText('2026-11-17', 0, 'en-US')).toBe('Due today')
    expect(dueText('2026-11-18', 1, 'en-US')).toBe('Due tomorrow')
    expect(dueText('2026-11-20', 3, 'en-US')).toBe('Due in 3 days')
    expect(dueText('2026-11-24', 7, 'en-US')).toBe('Due Nov 24')
  })
})

describe('billStatus', () => {
  it('says when a bill was paid, is due, or has no payment found', () => {
    const paid = bill({
      name: 'Rent',
      amountCents: 150000,
      anchorDate: '2026-12-01',
      matchPattern: 'rent',
      lastPaidDate: '2026-11-25',
    })
    expect(billStatus(paid, 'en-US')).toEqual({ text: 'Paid Nov 25', tone: 'good' })

    const soon = bill({ name: 'Phone', amountCents: 6000, anchorDate: '2026-11-20' })
    expect(billStatus(soon, 'en-US')).toEqual({ text: 'Due in 3 days', tone: 'warn' })

    const later = bill({ name: 'Car', amountCents: 30000, anchorDate: '2026-12-15' })
    expect(billStatus(later, 'en-US')).toEqual({ text: 'Due Dec 15', tone: '' })

    const missed = bill({
      name: 'Water',
      amountCents: 4000,
      anchorDate: '2026-10-05',
      matchPattern: 'water',
    })
    expect(billStatus(missed, 'en-US')).toEqual({ text: 'No payment found yet', tone: 'over' })
  })
})

describe('durationText', () => {
  it('reads as years and months', () => {
    expect(durationText(1)).toBe('1 month')
    expect(durationText(12)).toBe('1 year')
    expect(durationText(16)).toBe('1 year 4 months')
    expect(durationText(26)).toBe('2 years 2 months')
    expect(durationText(0)).toBe('Paid off')
    expect(durationText(null)).toBe('Never, at these payments')
  })
})

describe('monthYear', () => {
  it('names the month and year', () => {
    expect(monthYear('2028-03-01')).toBe('Mar 2028')
  })
})
