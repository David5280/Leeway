import { describe, expect, it } from 'vitest'
import { essentials, EVERYDAY, fundChoice, fundView, RAINY } from '../test/emergency'
import {
  countedWords,
  essentialsSentence,
  essentialsWords,
  followHint,
  fundTargetHint,
  leftOutNotes,
  monthsWord,
  quietNote,
  targetWords,
} from './emergencyText'

describe('months', () => {
  it('says one month, many, and part of one', () => {
    expect(monthsWord(1)).toBe('1 month')
    expect(monthsWord(6)).toBe('6 months')
    expect(monthsWord(0.5)).toBe('0.5 months')
  })
})

describe('what counts as essential', () => {
  it('names up to three categories, then counts the rest', () => {
    const named = (categories: string[]) => essentialsWords(essentials({ categories }))
    expect(named(['Rent'])).toBe('Rent')
    expect(named(['Rent', 'Groceries'])).toBe('Rent and Groceries')
    expect(named(['Rent', 'Groceries', 'Gas'])).toBe('Rent, Groceries and Gas')
    expect(named(['Rent', 'Groceries', 'Gas', 'Insurance', 'Phone'])).toBe(
      'Rent, Groceries, Gas and 2 more',
    )
  })

  it('says bills while spending is too new, and spending when all of it counts', () => {
    expect(essentialsWords(essentials({ from: 'bills', categories: null }))).toBe('your bills')
    expect(essentialsWords(null)).toBe('your bills')
    expect(essentialsWords(essentials({ categories: null }))).toBe('your spending')
    expect(essentialsWords(essentials({ categories: [] }))).toBe('your spending')
  })
})

describe('the line about the essentials', () => {
  it('says what they cost, or that a pick had no spending to size the fund by', () => {
    expect(essentialsSentence(fundView())).toBe('What Rent and Groceries cost in a typical month.')
    const quiet = { pickedIds: ['cat-pets'], spentIds: [] }
    expect(essentialsSentence(fundView({ essentials: null, essentialsChoice: quiet }))).toBe(
      'The essentials you picked had no spending in recent months.',
    )
    // Unknown with no pick: only bills could size it.
    expect(essentialsSentence(fundView({ essentials: null }))).toBe(
      'What your bills cost in a typical month.',
    )
  })

  it('notes ticked categories that add nothing, one or several', () => {
    expect(quietNote([])).toBeNull()
    expect(quietNote(['Pets'])).toBe(
      'Pets had no spending in recent months, so it adds nothing to the fund.',
    )
    expect(quietNote(['Pets', 'Gifts'])).toBe(
      'Pets and Gifts had no spending in recent months, so they add nothing to the fund.',
    )
  })
})

describe('the target', () => {
  it('says the step in months of essentials', () => {
    expect(targetWords({ months: 3, ownTarget: false })).toBe('3 months of essentials')
  })

  it("tells the owner's own amount in months, never as a step it is not", () => {
    expect(targetWords({ months: 2.3, ownTarget: true })).toBe('About 2.3 months of essentials')
    expect(targetWords({ months: null, ownTarget: true })).toBe('Your own target')
  })

  it('hints in the form how the target is sized, and how to change that', () => {
    expect(fundTargetHint(fundView())).toMatch(/^Sized by essentials/)
    expect(fundTargetHint(fundView({ ownTarget: true }))).toMatch(/^Your own amount/)
  })
})

describe('the accounts counted', () => {
  it('says every savings account until some are picked, then names them', () => {
    expect(countedWords(fundView())).toBe('every savings account')
    const both = [RAINY, { ...EVERYDAY, counted: true }]
    expect(countedWords(fundView({ counts: 'marked', accounts: both }))).toBe(
      'Rainy Day and Everyday',
    )
  })

  it('names the one account the goal links, and says when it counts by hand', () => {
    expect(countedWords(fundView({ counts: 'account', accounts: [RAINY] }))).toBe('Rainy Day')
    expect(countedWords(fundView({ counts: 'hand' }))).toBe('what you add by hand')
  })

  it('says a savings account will count once there is one', () => {
    expect(countedWords(fundView({ accounts: [] }))).toBe(
      'your savings accounts, once you have one',
    )
  })

  it('never says every savings account when another goal follows the only one', () => {
    const followed = { ...RAINY, counted: false, leftOut: 'other_goal' as const, otherGoal: 'Trip' }
    expect(countedWords(fundView({ accounts: [followed] }))).toBe('no savings account yet')
  })

  it('says when marked accounts count nothing, rather than falling back to every account', () => {
    const hidden = { ...RAINY, counted: false, marked: true, leftOut: 'hidden' as const }
    expect(countedWords(fundView({ counts: 'marked', accounts: [hidden] }))).toBe(
      'none of the accounts you picked yet',
    )
  })
})

describe('why an account is left out', () => {
  it('says which goal follows an account, and why a marked one counts nothing', () => {
    const accounts = [
      fundChoice({
        id: 't',
        name: 'Savings',
        counted: false,
        leftOut: 'other_goal',
        otherGoal: 'Trip',
      }),
      fundChoice({ id: 'h', name: 'Spare', counted: false, marked: true, leftOut: 'hidden' }),
      fundChoice({ id: 'n', name: 'Old', counted: false, marked: true, leftOut: 'not_shared' }),
      fundChoice({ id: 'u', name: 'Euro', counted: false, marked: true, leftOut: 'unavailable' }),
      RAINY,
    ]
    expect(leftOutNotes(fundView({ counts: 'marked', accounts }))).toEqual([
      'Savings is left out, since Trip follows it.',
      'Spare is hidden, so it counts nothing until you show it again.',
      'Old is no longer shared with Leeway, so it counts nothing.',
      'Euro has no balance Leeway can count yet.',
    ])
  })

  it('says nothing of accounts while the fund is counted by hand', () => {
    const followed = { ...RAINY, leftOut: 'other_goal' as const, otherGoal: 'Trip' }
    expect(leftOutNotes(fundView({ counts: 'hand', accounts: [followed] }))).toEqual([])
  })
})

describe("following an account the fund counts, from another goal's form", () => {
  it('warns that the fund loses it', () => {
    expect(followHint(fundView(), 'goal-trip', 'acct-rainy')).toBe(
      'Your emergency fund counts Rainy Day now. Following it here leaves it out of the fund.',
    )
    // A new goal has no id yet, and is warned the same.
    expect(followHint(fundView(), null, 'acct-rainy')).not.toBeNull()
  })

  it('says nothing for an account it does not count, for the fund itself, or for the offer', () => {
    expect(followHint(fundView(), 'goal-trip', 'acct-check')).toBeNull()
    expect(followHint(fundView(), 'goal-emergency', 'acct-rainy')).toBeNull()
    expect(followHint(fundView({ goalId: null }), null, 'acct-rainy')).toBeNull()
    expect(followHint(null, null, 'acct-rainy')).toBeNull()
  })
})
