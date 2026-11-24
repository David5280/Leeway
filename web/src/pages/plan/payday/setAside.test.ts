// What is set aside each paycheck, as Payday's one line to Goals says it.

import { describe, expect, it } from 'vitest'
import { planOf } from '../../../test/playbook'
import { setAsideLines, setAsideRow, setAsideUnit } from './setAside'

const money = (cents: number) => `$${cents / 100}`

describe('set-aside words', () => {
  it('keeps only what is set aside, leaving the bills out', () => {
    expect(setAsideLines(planOf()).map((line) => line.name)).toEqual([
      'New laptop',
      'Car insurance',
    ])
  })

  it('counts each paycheck once pay is known, and each budget period before', () => {
    expect(setAsideUnit(planOf(), 'month')).toBe('paycheck')
    expect(setAsideUnit(planOf(undefined, null), 'month')).toBe('month')
  })

  it('gives the total and what it is for, linking to Goals', () => {
    expect(setAsideRow(planOf(), money, 'month')).toEqual({
      to: '/goals',
      icon: 'piggy',
      label: 'Set aside: $150 each paycheck',
      detail: 'Goals, trips and yearly costs, on Goals',
    })
  })

  it('still points to Goals before the plan loads, or with nothing set aside', () => {
    const plain = {
      to: '/goals',
      label: 'Goals and yearly costs',
      detail: 'What you are saving for',
    }
    expect(setAsideRow(undefined, money, 'month')).toMatchObject(plain)
    expect(setAsideRow(planOf([]), money, 'month')).toMatchObject(plain)
  })
})
