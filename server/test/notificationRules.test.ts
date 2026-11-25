// The notification rules and quiet hours, as pure functions: what each kind
// of news says in the app and on a lock screen, and when pushes wait.

import { describe, expect, it } from 'vitest'
import type { AccountAlert } from '../src/domain/accountAlerts.js'
import type { CategoryBudget } from '../src/domain/budgetCategory.js'
import { isQuiet, localHour } from '../src/domain/notifications/quietHours.js'
import {
  accountCandidates,
  aiLimitCandidate,
  bankLoginCandidates,
  billCandidates,
  budgetCandidates,
  largeChargeCandidates,
  type DueBill,
} from '../src/domain/notifications/words.js'

const FORMAT = {
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  date: (date: string) => `on ${date}`,
}

function alert(kind: AccountAlert['kind'], more: Partial<AccountAlert> = {}): AccountAlert {
  return {
    kind,
    severity: 'urgent',
    accountId: 'acct-1',
    accountName: 'Everyday',
    amountCents: 4210,
    count: 1,
    date: null,
    message: `Everyday: ${kind} by $42.10.`,
    summary: '',
    ...more,
  }
}

describe('account alerts', () => {
  it('keeps conditions once per account, and fees once per latest fee date', () => {
    const found = accountCandidates([
      alert('overdrawn'),
      alert('over_limit', { accountId: 'card', accountName: 'Travel card' }),
      alert('low_balance'),
      alert('overdraft_fee', { date: '2026-11-15' }),
    ])
    expect(
      found.map(({ kind, subject, title, pushBody, link }) => ({
        kind,
        subject,
        title,
        pushBody,
        link,
      })),
    ).toEqual([
      {
        kind: 'overdrawn',
        subject: 'acct-1',
        title: 'Overdrawn',
        pushBody: 'Everyday is below zero.',
        link: '/inbox',
      },
      {
        kind: 'over_limit',
        subject: 'card',
        title: 'Over credit limit',
        pushBody: 'Travel card is past its limit.',
        link: '/inbox',
      },
      {
        kind: 'low_balance',
        subject: 'acct-1',
        title: 'Low balance',
        pushBody: 'Everyday is below your warning amount.',
        link: '/inbox',
      },
      {
        kind: 'overdraft_fee',
        subject: 'acct-1:2026-11-15',
        title: 'Overdraft fee',
        pushBody: 'Everyday was charged a fee.',
        link: '/inbox',
      },
    ])
    // The app keeps the full sentence, amount and all.
    expect(found[0]!.message).toBe('Everyday: overdrawn by $42.10.')
  })
})

function category(more: Partial<CategoryBudget>): CategoryBudget {
  return {
    categoryId: 'cat-1',
    name: 'Groceries',
    color: '#000000',
    icon: null,
    kind: 'expense',
    group: null,
    budgetCents: 40_000,
    rollover: false,
    carriedCents: null,
    spentCents: 0,
    leftCents: null,
    percentUsed: null,
    warnAtPercent: 80,
    status: 'ok',
    expectedByNowCents: null,
    pace: null,
    projectedCents: 0,
    ...more,
  }
}

describe('budgets', () => {
  it('flags a spending category once it reaches the threshold, once per period', () => {
    const rows = [
      category({ spentCents: 39_999, percentUsed: 100 }),
      category({ categoryId: 'cat-2', name: 'Dining', spentCents: 40_000, percentUsed: 100 }),
      category({ categoryId: 'cat-3', name: 'Fun', spentCents: 45_000, percentUsed: 113 }),
    ]
    const found = budgetCandidates(rows, '2026-11-01', 100, FORMAT)
    expect(found).toEqual([
      {
        kind: 'over_budget',
        subject: 'cat-2:2026-11-01',
        title: 'Budget warning',
        message: 'Dining has used 100% of its $400.00 budget.',
        pushBody: 'Dining has used 100% of its budget.',
        link: '/spending/cat-2',
      },
      {
        kind: 'over_budget',
        subject: 'cat-3:2026-11-01',
        title: 'Over budget',
        message: 'Fun is $50.00 over its $400.00 budget.',
        pushBody: 'Fun is over its budget.',
        link: '/spending/cat-3',
      },
    ])
  })

  it('uses a lower threshold when set, and skips income and categories without a budget', () => {
    const rows = [
      category({ spentCents: 32_000, percentUsed: 80 }),
      category({ categoryId: 'pay', kind: 'income', spentCents: 99_000 }),
      category({ categoryId: 'none', budgetCents: null, spentCents: 99_000 }),
      category({ categoryId: 'zero', budgetCents: 0, spentCents: 99_000 }),
    ]
    const found = budgetCandidates(rows, '2026-11-01', 80, FORMAT)
    expect(found.map((one) => one.subject)).toEqual(['cat-1:2026-11-01'])
    expect(found[0]!.pushBody).toBe('Groceries has used 80% of its budget.')
  })
})

function bill(more: Partial<DueBill>): DueBill {
  return {
    id: 'bill-1',
    name: 'Rent',
    amountCents: 180_000,
    autopay: false,
    nextDueDate: '2026-11-19',
    daysUntilDue: 2,
    status: 'due_soon',
    ...more,
  }
}

describe('bills', () => {
  it('flags bills due within the days chosen, once per due date', () => {
    const found = billCandidates(
      [
        bill({ daysUntilDue: 0, nextDueDate: '2026-11-17' }),
        bill({ id: 'b2', name: 'Power', daysUntilDue: 1, nextDueDate: '2026-11-18' }),
        bill({ id: 'b3', name: 'Phone', daysUntilDue: 2 }),
        bill({ id: 'b4', name: 'Later', daysUntilDue: 3 }),
      ],
      2,
      FORMAT,
    )
    expect(found.map((one) => [one.subject, one.pushBody])).toEqual([
      ['bill-1:2026-11-17', 'Rent is due today.'],
      ['b2:2026-11-18', 'Power is due tomorrow.'],
      ['b3:2026-11-19', 'Phone is due in 2 days.'],
    ])
    expect(found[0]).toMatchObject({
      title: 'Bill due soon',
      message: 'Rent is due today (on 2026-11-17), usually $1800.00.',
      link: '/payday/bills',
    })
  })

  it('leaves out bills on autopay, paid, or past a due date with no payment to look for', () => {
    const found = billCandidates(
      [
        bill({ autopay: true }),
        bill({ status: 'paid' }),
        bill({ daysUntilDue: -1, status: 'upcoming' }),
      ],
      7,
      FORMAT,
    )
    expect(found).toEqual([])
  })

  it('keeps an overdue bill, by the same due date, until it is paid', () => {
    const found = billCandidates(
      [
        bill({ daysUntilDue: -1, nextDueDate: '2026-11-16', status: 'overdue' }),
        bill({ id: 'b2', name: 'Power', daysUntilDue: -3, status: 'overdue' }),
      ],
      0,
      FORMAT,
    )
    expect(found.map((one) => [one.subject, one.title, one.pushBody])).toEqual([
      ['bill-1:2026-11-16', 'Bill overdue', 'Rent was due yesterday.'],
      ['b2:2026-11-19', 'Bill overdue', 'Power was due 3 days ago.'],
    ])
    expect(found[0]!.message).toBe('Rent was due yesterday (on 2026-11-16), usually $1800.00.')
  })
})

describe('large charges', () => {
  it("names the account as shown in the app, and keeps the merchant to the app's message", () => {
    const names = new Map([['acct-1', 'Everyday']])
    const charge = {
      subject: 'tx-1',
      accountId: 'acct-1',
      label: 'BEST BUY #1234 DENVER CO',
      amountCents: 129_999,
      date: '2026-11-16',
    }
    const [found] = largeChargeCandidates([charge], names, FORMAT)
    expect(found).toEqual({
      kind: 'large_transaction',
      subject: 'tx-1',
      title: 'Large charge',
      message: 'BEST BUY #1234 DENVER CO charged $1299.99 to Everyday on on 2026-11-16.',
      pushBody: 'A large charge was made on Everyday.',
      link: '/spending/activity',
    })
    // An account deleted a moment ago is not named.
    const [orphan] = largeChargeCandidates([{ ...charge, accountId: 'gone' }], names, FORMAT)
    expect(orphan!.pushBody).toBe('A large charge was made on an account.')
  })
})

describe('bank sign-ins', () => {
  it('flags a bank that needs the owner to sign in again, and nothing else', () => {
    const found = bankLoginCandidates([
      { id: 'c1', institutionName: 'First Bank', status: 'needs_reauth' },
      { id: 'c2', institutionName: null, status: 'needs_reauth' },
      { id: 'c3', institutionName: 'Fine Bank', status: 'active' },
      { id: 'c4', institutionName: 'Hiccup Bank', status: 'error' },
    ])
    expect(found.map((one) => [one.subject, one.pushBody])).toEqual([
      ['c1', 'First Bank needs you to sign in again.'],
      ['c2', 'A bank needs you to sign in again.'],
    ])
    expect(found[0]).toMatchObject({ title: 'Bank needs you', link: '/settings/banks' })
  })
})

describe('AI spending', () => {
  const news = { month: '2026-11-01', capCents: 500 }

  it('words the warning and the limit, keeping the amounts to the app', () => {
    const warning = aiLimitCandidate({ ...news, level: 'warning', message: 'AI has spent $4.10.' })
    expect(warning).toEqual({
      kind: 'ai_limit',
      subject: '2026-11-01:warning:500',
      title: 'AI limit near',
      message: 'AI has spent $4.10.',
      pushBody: "AI has spent most of this month's limit.",
      link: '/settings/ai',
    })
    const limit = aiLimitCandidate({ ...news, level: 'limit', message: 'Limit of $5.00 reached.' })
    expect(limit).toMatchObject({
      subject: '2026-11-01:limit:500',
      title: 'AI limit reached',
      pushBody: "AI is paused until this month's limit resets.",
    })
    // The push may show on a locked screen: no amount, and no digit at all.
    for (const one of [warning, limit]) expect(one.pushBody).not.toMatch(/[\d$]/)
  })

  it('keeps each alert once per month, level and limit', () => {
    const subject = (month: string, capCents: number) =>
      aiLimitCandidate({ month, capCents, level: 'warning', message: '' }).subject
    expect(
      new Set([subject('2026-11-01', 500), subject('2026-12-01', 500), subject('2026-11-01', 900)])
        .size,
    ).toBe(3)
  })
})

describe('quiet hours', () => {
  const QUIET = { on: true, start: 22, end: 7 }
  const DENVER = 'America/Denver'

  it("reads the hour on the owner's clock", () => {
    expect(localHour(new Date('2026-11-17T05:30:00Z'), DENVER)).toBe(22)
    expect(localHour(new Date('2026-11-17T05:30:00Z'), 'UTC')).toBe(5)
    expect(localHour(new Date('2026-11-17T00:30:00Z'), 'Asia/Kolkata')).toBe(6)
  })

  it('runs past midnight: from the start hour until the end hour begins', () => {
    const at = (iso: string) => isQuiet(new Date(iso), DENVER, QUIET)
    // Denver is UTC-7 in November.
    expect(at('2026-11-17T04:59:00Z')).toBe(false) // 9:59 PM
    expect(at('2026-11-17T05:00:00Z')).toBe(true) // 10 PM
    expect(at('2026-11-17T09:00:00Z')).toBe(true) // 2 AM
    expect(at('2026-11-17T13:59:00Z')).toBe(true) // 6:59 AM
    expect(at('2026-11-17T14:00:00Z')).toBe(false) // 7 AM
  })

  it('works within a day too, and is off when turned off or when start and end match', () => {
    const lunch = { on: true, start: 12, end: 14 }
    expect(isQuiet(new Date('2026-11-17T12:30:00Z'), 'UTC', lunch)).toBe(true)
    expect(isQuiet(new Date('2026-11-17T14:00:00Z'), 'UTC', lunch)).toBe(false)
    expect(isQuiet(new Date('2026-11-17T11:59:00Z'), 'UTC', lunch)).toBe(false)
    expect(isQuiet(new Date('2026-11-17T09:00:00Z'), DENVER, { ...QUIET, on: false })).toBe(false)
    expect(isQuiet(new Date('2026-11-17T09:00:00Z'), DENVER, { on: true, start: 7, end: 7 })).toBe(
      false,
    )
  })

  it('keeps to the wall clock across the spring change: 7 AM ends it on either side', () => {
    // Sat Mar 7, 2026, 13:30 UTC is 6:30 AM MST: still quiet.
    expect(isQuiet(new Date('2026-03-07T13:30:00Z'), DENVER, QUIET)).toBe(true)
    // Sun Mar 8, clocks go forward at 2 AM: 13:30 UTC is now 7:30 AM MDT, quiet is over.
    expect(isQuiet(new Date('2026-03-08T13:30:00Z'), DENVER, QUIET)).toBe(false)
    // 1:59 AM MST, then the clock jumps to 3 AM MDT: quiet throughout the night.
    expect(isQuiet(new Date('2026-03-08T08:59:00Z'), DENVER, QUIET)).toBe(true)
    expect(isQuiet(new Date('2026-03-08T09:00:00Z'), DENVER, QUIET)).toBe(true)
    expect(localHour(new Date('2026-03-08T09:00:00Z'), DENVER)).toBe(3)
  })

  it('keeps to the wall clock across the fall change: the repeated hour stays quiet', () => {
    // Sun Nov 1, 2026: 1 AM happens twice, at 07:00 and 08:00 UTC.
    expect(localHour(new Date('2026-11-01T07:30:00Z'), DENVER)).toBe(1)
    expect(localHour(new Date('2026-11-01T08:30:00Z'), DENVER)).toBe(1)
    expect(isQuiet(new Date('2026-11-01T08:30:00Z'), DENVER, QUIET)).toBe(true)
    // 7 AM MST is 14:00 UTC after the change, an hour later than the day before.
    expect(isQuiet(new Date('2026-10-31T13:30:00Z'), DENVER, QUIET)).toBe(false) // 7:30 AM MDT
    expect(isQuiet(new Date('2026-11-01T13:30:00Z'), DENVER, QUIET)).toBe(true) // 6:30 AM MST
    expect(isQuiet(new Date('2026-11-01T14:00:00Z'), DENVER, QUIET)).toBe(false) // 7 AM MST
  })
})
