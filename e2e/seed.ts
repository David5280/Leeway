// Fills the test install with enough to draw every list on every screen,
// with the longest names Leeway takes, then takes it all away again so the
// other browser tests find the install as they left it.

import { expect, type APIRequestContext } from '@playwright/test'

/** Runs a server action as the signed-in owner and returns its result. */
export async function action<T = unknown>(
  request: APIRequestContext,
  name: string,
  input: object = {},
): Promise<T> {
  const response = await request.post(`/api/actions/${name}`, { data: input })
  expect(response.ok(), `${name}: ${await response.text()}`).toBe(true)
  return ((await response.json()) as { result: T }).result
}

/** A date this many days before today (negative for after), as the server takes it. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * What was added, by the action that deletes it, in the order to delete:
 * rules and goals before the categories and accounts they point at.
 */
const DELETED_BY = {
  rules: 'delete_rule',
  tokens: 'delete_token',
  goals: 'delete_goal',
  bills: 'delete_bill',
  // Deleting an account deletes its transactions.
  accounts: 'delete_account',
  categories: 'delete_category',
} as const

export type Seeded = Record<keyof typeof DELETED_BY, string[]>

/** Nothing added yet. Each id goes in as soon as it exists, so a seed that fails halfway still cleans up. */
export const emptySeed = (): Seeded => ({
  rules: [],
  tokens: [],
  goals: [],
  bills: [],
  accounts: [],
  categories: [],
})

/**
 * Names as long as Leeway takes them, and longer than a phone has room for:
 * an 80-character account name, a 60-character category in a long group, and
 * a merchant name that runs on.
 */
export const LONG = {
  account: 'Joint everyday checking account at the credit union down the street from work',
  category: 'Streaming, music, news and every other monthly subscription',
  group: 'Entertainment and hobbies for weekends',
  merchant: 'AMAZON MARKETPLACE PAYMENTS SEATTLE WA household supplies and a birthday present',
  bill: 'Renters insurance with the extra coverage for bikes and cameras',
  goal: 'Emergency fund for unexpected car repairs, vet bills and travel',
  token: 'Claude on the laptop in the home office upstairs, by window',
  pension: 'Public Employees Retirement Association of Colorado, the defined benefit plan',
} as const

/**
 * Adds four accounts (checking, savings, a credit card and a loan, in that
 * order in `seeded.accounts`), a category, spending, bills, goals, a rule, an
 * assistant key, and a pension with the birth year a projection needs.
 */
export async function seedEveryScreen(request: APIRequestContext, seeded: Seeded): Promise<void> {
  /**
   * Runs a create action and files the new id under what deletes it. Most
   * actions answer with what they made; some wrap it (create_rule's { rule }).
   */
  const create = async (
    kind: keyof Seeded,
    name: string,
    input: object,
    made: (result: never) => { id: string } = (result) => result,
  ) => {
    const { id } = made(await action<never>(request, name, input))
    seeded[kind].push(id)
    return id
  }

  const category = await create('categories', 'create_category', {
    name: LONG.category,
    group: LONG.group,
    budgetCents: 12_000,
    color: '#b678e5',
  })
  const categories = await action<{ id: string; name: string }[]>(request, 'list_categories')
  const categoryId = (name: string) => categories.find((c) => c.name === name)?.id ?? null

  const checking = await create('accounts', 'create_account', {
    name: LONG.account,
    type: 'depository',
    balanceCents: 248_215,
  })
  const savings = await create('accounts', 'create_account', {
    name: 'Savings',
    type: 'depository',
    balanceCents: 1_240_000,
  })
  const card = await create('accounts', 'create_account', {
    name: 'Rewards card',
    type: 'credit',
    balanceCents: 62_830,
    creditLimitCents: 500_000,
  })
  const loan = await create('accounts', 'create_account', {
    name: 'Car loan',
    type: 'loan',
    balanceCents: 1_412_000,
  })
  // Debt terms, so the payoff plan has something to plan.
  await action(request, 'update_account', {
    id: card,
    aprPercent: 24.99,
    minimumPaymentCents: 3500,
  })
  await action(request, 'update_account', {
    id: loan,
    aprPercent: 6.4,
    minimumPaymentCents: 41_000,
  })

  const spending: [name: string, category: string | null, cents: number, account: string][] = [
    [LONG.merchant, 'Shopping', 8_412, checking],
    ['King Soopers', 'Groceries', 11_240, card],
    ['Chipotle', 'Dining out', 1_485, card],
    ['Spotify', LONG.category, 1_199, checking],
    ['Xcel Energy', null, 9_400, checking],
    ['ACME PAYROLL', null, -248_500, checking],
    ['Shell', null, 4_820, card],
    ['Corner market', 'Groceries', 4_250, checking],
  ]
  // Spending falls in the current budget period, so "This period" lists it at
  // any hour: a paycheck period that began today takes it all on today.
  const { period } = await action<{ period: { start: string } }>(request, 'get_budget', {
    offset: 0,
  })
  const inPeriod = (days: number) => [daysAgo(days), period.start].sort().at(-1)!
  for (const [index, [name, category, amountCents, accountId]] of spending.entries()) {
    await action(request, 'create_transaction', {
      accountId,
      date: inPeriod(index + 1),
      name,
      amountCents,
      categoryId: category ? categoryId(category) : null,
    })
  }

  await create('bills', 'create_bill', {
    name: LONG.bill,
    amountCents: 2_400,
    cadence: 'month',
    anchorDate: daysAgo(-6),
    matchPattern: 'renters',
  })
  await create('bills', 'create_bill', {
    name: 'Spotify',
    kind: 'subscription',
    amountCents: 1_199,
    cadence: 'month',
    anchorDate: daysAgo(-12),
    matchPattern: 'spotify',
  })

  await create('goals', 'create_goal', {
    name: LONG.goal,
    targetCents: 2_000_000,
    accountId: savings,
  })
  await create('goals', 'create_goal', {
    name: 'Road bike',
    kind: 'purchase',
    targetCents: 180_000,
    savedCents: 60_000,
    targetDate: daysAgo(-160),
    setAside: true,
  })
  // A second goal set aside for lists them one under the other on Overview.
  await create('goals', 'create_goal', {
    name: 'New laptop',
    kind: 'purchase',
    targetCents: 240_000,
    targetDate: daysAgo(-300),
    setAside: true,
  })

  await create(
    'rules',
    'create_rule',
    { pattern: 'spotify', categoryId: category },
    (result: { rule: { id: string } }) => result.rule,
  )
  await create('tokens', 'create_token', { name: LONG.token, scope: 'read' })

  // A pension with every figure a statement and a paystub give, and the birth
  // year and income wanted, so the Retirement section draws its projection.
  await create(
    'accounts',
    'create_pension',
    {
      name: LONG.pension,
      balanceCents: 6_500_000,
      contribution: { kind: 'percent', percent: 11 },
      grossPayCents: 250_000,
      payCadence: 'biweek',
      employerContributionPercent: 21.4,
      serviceYears: 8,
      salaryBasisMonthlyCents: 600_000,
      multiplierPercent: 2.5,
    },
    (result: { accountId: string }) => ({ id: result.accountId }),
  )
  await action(request, 'update_settings', {
    retirement: { birthYear: 1986, targetMonthlyIncomeCents: 400_000 },
  })
}

/** Removes everything seedEveryScreen added, however far it got. */
export async function removeSeed(request: APIRequestContext, seeded: Seeded): Promise<void> {
  await action(request, 'update_settings', {
    retirement: { birthYear: null, targetMonthlyIncomeCents: null },
  })
  for (const [kind, deleteAction] of Object.entries(DELETED_BY)) {
    for (const id of seeded[kind as keyof Seeded]) await action(request, deleteAction, { id })
  }
}
