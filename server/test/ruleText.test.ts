import { describe, expect, it } from 'vitest'
import { shownName, shownNamesOf, withShownNames } from '../src/domain/ruleText.js'
import { ruleMatches, type Rule } from '../src/domain/rules.js'

const masks = ['9876', '4417']

/** A bank line, as categorizing reads one. */
const line = (name: string, merchantName: string | null = null, amountCents = 2500) => ({
  name,
  merchantName,
  amountCents,
  providerCategoryPrimary: null,
  providerCategoryDetailed: null,
})

const rule = (reads: Rule['reads']): Rule => ({
  id: `rule-${reads}`,
  field: 'description',
  matchType: 'contains',
  pattern: 'gym',
  minAmountCents: null,
  maxAmountCents: null,
  categoryId: 'fitness',
  position: 0,
  reads,
})

describe('shownName', () => {
  it('is the name the app shows, with no account number in it', () => {
    expect(shownName(line('GYM DUES 9876', 'Iron Gym'), masks)).toBe('Iron Gym')
    expect(shownName(line('SQ *BLUE BOTTLE 4417'), masks)).not.toMatch(/4417|41|17/)
  })

  it("never takes the category's name when nothing readable is left", () => {
    // No words at all reads as a bank transaction, as in the app.
    expect(shownName(line('#9876'), masks)).toBe('Bank transaction')
    // Digits that spell the mask across words leave nothing that can be shown.
    expect(shownName(line('PURCHASE', 'Card ending 7 6'), masks)).toBe('')
  })
})

describe('withShownNames', () => {
  it('works the shown name out when a rule reads it, people included', () => {
    const zelle = { ...line('Zelle payment to Jane Doe 9876'), amountCents: 5000 }
    const [gym, paid] = withShownNames(
      [line('GYM DUES 9876', 'Iron Gym'), zelle],
      [rule('bank_text'), rule('shown_name')],
      masks,
    )
    expect(gym!.shownName).toBe('Iron Gym')
    expect(paid!.shownName).toBe('To Jane Doe')
    // The row is otherwise as it was.
    expect(gym).toMatchObject(line('GYM DUES 9876', 'Iron Gym'))
  })

  it('leaves it empty when no rule reads it', () => {
    const rows = withShownNames([line('GYM DUES', 'Iron Gym')], [rule('bank_text')], masks)
    expect(rows[0]!.shownName).toBe('')
  })
})

describe('every name a row has been shown under', () => {
  it('is its name now, then the one before names were read more closely, when it differs', () => {
    const via = line('Payment to Wilhelmina Ashcombe via Zelle')
    expect(shownNamesOf(via, masks)).toEqual([
      'To Wilhelmina Ashcombe',
      'To Wilhelmina Ashcombe via Zelle',
    ])
    expect(shownNamesOf(line('GYM DUES', 'Iron Gym'), masks)).toEqual(['Iron Gym'])
  })

  it('is what a rule reading shown names matches, any of them, or the name now alone', () => {
    const saved = { ...rule('shown_name'), pattern: 'ashcombe via zelle' }
    const tx = {
      ...line('Payment to Wilhelmina Ashcombe via Zelle'),
      shownName: 'To Wilhelmina Ashcombe',
    }
    expect(ruleMatches(saved, tx)).toBe(false)
    expect(ruleMatches(saved, { ...tx, shownNames: shownNamesOf(tx, masks) })).toBe(true)
  })
})
