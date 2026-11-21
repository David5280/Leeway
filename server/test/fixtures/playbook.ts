// Builders for the payday playbook's tests. Every name and amount is made up.

import type { Category } from '../../src/domain/categories.js'
import type { Goal } from '../../src/domain/goals.js'

/** A flexible budget: groceries at $400 a month, unless told otherwise. */
export function category(fields: Partial<Category>): Category {
  return {
    id: 'cat-groceries',
    name: 'Groceries',
    color: '#2a9d8f',
    icon: null,
    kind: 'expense',
    budgetCents: 40_000,
    budgetCadence: 'month',
    warnAtPercent: null,
    trackPace: true,
    providerCategories: [],
    group: null,
    rollover: false,
    rolloverSince: null,
    position: 0,
    ...fields,
  }
}

/** A goal on track, needing $100 a budget period, unless told otherwise. */
export const goal = (fields: Partial<Goal>): Goal =>
  ({
    id: 'goal-trip',
    name: 'Trip',
    status: 'in_progress',
    perPeriodCents: 10_000,
    targetDate: '2027-06-01',
    ...fields,
  }) as Goal
