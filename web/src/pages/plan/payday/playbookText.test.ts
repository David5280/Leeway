import { describe, expect, it } from 'vitest'
import { closeOutOf, LINES, planOf, SHORT } from '../../../test/playbook'
import { billNames, hasCloseOut, leftoverTone, setAsideWords, shortClass } from './playbookText'

describe('playbook words', () => {
  it('draws money left green, money over amber and nothing left plain', () => {
    expect([leftoverTone(1), leftoverTone(-1), leftoverTone(0)]).toEqual(['in', 'warn', 'neutral'])
  })

  it('skips a close-out with no flexible budget and no spending', () => {
    expect(hasCloseOut(closeOutOf([]))).toBe(false)
    expect(hasCloseOut(null)).toBe(false)
    const spentOnly = closeOutOf([{ name: 'Dining', budgetCents: 0, spentCents: 500 }])
    expect(hasCloseOut(spentOnly)).toBe(true)
  })

  it('names two bills, then counts the rest', () => {
    const bill = (name: string) => ({ ...LINES[0]!, name })
    expect(billNames([bill('Rent')])).toBe('Rent')
    expect(billNames(['Rent', 'Phone', 'Water', 'Power'].map(bill))).toBe('Rent, Phone and 2 more')
  })

  it('says what is set aside for, from the kinds held back', () => {
    const only = (kind: string) => LINES.filter((line) => line.kind === kind)
    expect(setAsideWords(only('sinking_fund'))).toBe('Yearly costs')
    expect(setAsideWords(only('set_aside'))).toBe('Goals and trips')
  })

  it('turns the short-cash note red unless payday is an estimate and checking is still above zero', () => {
    const plan = planOf(undefined, undefined, { short: SHORT })
    const below = { ...plan, short: { ...SHORT, now: true } }
    expect(shortClass({ plan, paydayEstimate: true })).toBe('warn')
    expect(shortClass({ plan, paydayEstimate: false })).toBe('over')
    expect(shortClass({ plan: below, paydayEstimate: true })).toBe('over')
  })
})
