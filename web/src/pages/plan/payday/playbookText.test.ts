import { describe, expect, it } from 'vitest'
import { closeOutOf, IDEAS, LINES } from '../../../test/playbook'
import { billNames, hasCloseOut, ideaReason, leftoverTone, setAsideWords } from './playbookText'

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

  it("adds a goal's target date to its reason, and leaves any other reason alone", () => {
    const date = (iso: string) => `[${iso}]`
    expect(IDEAS.map((idea) => ideaReason(idea, date))).toEqual([
      'Your emergency fund is short of its target.',
      'A goal still to reach. Due [2027-01-15].',
    ])
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
})
