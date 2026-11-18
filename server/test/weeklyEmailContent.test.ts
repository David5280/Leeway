import { describe, expect, it } from 'vitest'
import type { BillDue } from '../src/domain/cashFlow.js'
import type { AttentionItem } from '../src/domain/coach.js'
import {
  MAX_LIST_ITEMS,
  weeklyEmailContent,
  type WeeklyEmailInput,
} from '../src/domain/weeklyEmail/content.js'
import { escapeHtml, weeklyEmailHtml } from '../src/domain/weeklyEmail/html.js'
import { weeklyEmailText } from '../src/domain/weeklyEmail/text.js'
import { formatCents } from '../src/lib/money.js'
import { accountAlert, checkin, goal } from './fixtures/checkin.js'

const monthly = { period: { kind: 'monthly' as const, startDay: 1 }, locale: 'en-US' }

function input(change: Partial<WeeklyEmailInput> = {}): WeeklyEmailInput {
  return {
    summary: { headline: "You're on track.", points: ['Payday is Dec 1.'], writtenBy: 'Leeway' },
    checkin: checkin(),
    billsDue: [],
    settings: monthly,
    money: (cents) => formatCents(cents),
    appUrl: 'https://leeway.example.com',
    ...change,
  }
}

const content = (change: Partial<WeeklyEmailInput> = {}) => weeklyEmailContent(input(change))
const section = (change: Partial<WeeklyEmailInput>, title: string) =>
  content(change).sections.find((s) => s.title.startsWith(title))!

function bill(name: string, dueDate: string, amountCents: number, overdue = false): BillDue {
  return { billId: name, name, dueDate, amountCents, overdue }
}

function attention(message: string, forOwner?: string): AttentionItem {
  return { priority: 'now', topic: 'bank', message, forOwner, tool: 'list_connections' }
}

describe('weeklyEmailContent', () => {
  it('opens with the dashboard summary and the period at a glance', () => {
    const email = content()
    expect(email).toMatchObject({
      subject: 'Your week in Leeway: $1,200 left this month',
      preview: "You're on track.",
      headline: "You're on track.",
      points: ['Payday is Dec 1.'],
      figuresTitle: 'This month',
      figures: [
        { text: 'Left to spend', detail: '$1,200' },
        { text: 'Per day', detail: '$85.71' },
        { text: 'Period ends', detail: 'Nov 30' },
      ],
      appUrl: 'https://leeway.example.com',
      locale: 'en-US',
    })
    expect(email.sections.map((s) => s.title)).toEqual([
      'Heads up',
      'Bills before payday on Dec 1',
      'Goals',
    ])
  })

  it('says how far over the period is, and what was spent when nothing is budgeted', () => {
    const over = content({
      checkin: checkin({ budget: { leewayCents: -4550, safePerDayCents: null } }),
    })
    expect(over.subject).toBe('Your week in Leeway: $45.50 over this month')
    expect(over.figures).toEqual([
      { text: 'Left to spend', detail: '-$45.50' },
      { text: 'Period ends', detail: 'Nov 30' },
    ])
    const unbudgeted = content({
      checkin: checkin({ budget: { budgetedCents: 0, spentCents: 9900 } }),
    })
    expect(unbudgeted.subject).toBe('Your week in Leeway: $99 spent')
    expect(unbudgeted.figures[0]).toEqual({ text: 'Spent so far', detail: '$99' })
  })

  it('names the period the owner budgets by', () => {
    const weekly = { period: { kind: 'weekly' as const, weekStartsOn: 1 }, locale: 'en-US' }
    expect(content({ settings: weekly }).figuresTitle).toBe('This week')
    expect(content({ settings: weekly }).subject).toMatch(/left this week$/)
  })

  it('words the heads-up list for the owner, not for an assistant', () => {
    const items = [
      attention('Bank needs the owner to log in again.', 'Bank needs you to log in again.'),
      attention('Phone ($60) is due 2026-11-20.'),
    ]
    expect(section({ checkin: checkin({ attention: items }) }, 'Heads up').items).toEqual([
      { text: 'Bank needs you to log in again.' },
      { text: 'Phone ($60) is due 2026-11-20.' },
    ])
    expect(section({}, 'Heads up')).toMatchObject({
      items: [],
      empty: 'Nothing needs you right now.',
    })
  })

  it('lists bills due before payday with their dates and amounts', () => {
    const bills = section(
      { billsDue: [bill('Water', '2026-11-10', 5000, true), bill('Phone', '2026-11-20', 6012)] },
      'Bills',
    )
    expect(bills.items).toEqual([
      { text: 'Water, overdue', detail: '$50' },
      { text: 'Phone, Nov 20', detail: '$60.12' },
    ])
    expect(section({}, 'Bills')).toMatchObject({ items: [], empty: 'No bills due before payday.' })
  })

  it('keeps a long list of bills short', () => {
    const many = Array.from({ length: MAX_LIST_ITEMS + 3 }, (_, i) =>
      bill(`Bill ${i}`, '2026-11-20', 1000),
    )
    const items = section({ billsDue: many }, 'Bills').items
    expect(items).toHaveLength(MAX_LIST_ITEMS + 1)
    expect(items.at(-1)).toEqual({ text: 'And 3 more in Leeway' })
  })

  it('shows each goal’s progress and whether it needs a look', () => {
    const goals = [
      goal('Fund', { percent: 40, remainingCents: 60000 }),
      goal('Trip', { onTrack: false, targetDate: '2027-03-01', remainingCents: 5000 }),
      goal('Laptop', { status: 'past_due', remainingCents: 20000 }),
      goal('Bike', { kind: 'purchase', status: 'reached', percent: 100 }),
      goal('Cushion', { status: 'reached', percent: 100 }),
    ]
    expect(section({ checkin: checkin({ goals }) }, 'Goals').items).toEqual([
      { text: 'Fund', detail: '40% saved, $600 to go' },
      { text: 'Trip, behind pace for Mar 1', detail: '25% saved, $50 to go' },
      { text: 'Laptop: past its date', detail: '$200 to go' },
      { text: 'Bike: saved, ready to buy', detail: '100% saved' },
      { text: 'Cushion: reached', detail: '100% saved' },
    ])
    expect(section({}, 'Goals').empty).toBe('No goals yet. Add one from the Plan tab.')
  })

  it('credits an AI that wrote the summary, and says how to stop the email', () => {
    expect(content().footer).toBe(
      'You get this because the weekly email is on in Leeway. To stop it or change its day, open Customize, then Email.',
    )
    const byClaude = content({ summary: { headline: 'Fine.', points: [], writtenBy: 'Claude' } })
    expect(byClaude.footer).toMatch(/Summary written by Claude\.$/)
  })

  it('formats amounts and dates in the owner’s currency and language', () => {
    const german = content({
      settings: { ...monthly, locale: 'de-DE' },
      money: (cents) => formatCents(cents, 'EUR', 'de-DE'),
    })
    expect(german.figures[0]!.detail).toBe('1.200\u00a0€')
    expect(german.figures.at(-1)!.detail).toBe('30. Nov.')
  })
})

describe('account alerts in the weekly email', () => {
  const overdrawn = accountAlert()
  const accountItem: AttentionItem = {
    priority: 'now',
    topic: 'account',
    message: overdrawn.message,
    tool: 'list_alerts',
  }

  it('opens with the alerts, naming the bank but not the account', () => {
    const email = content({
      checkin: checkin({ alerts: [overdrawn], attention: [accountItem] }),
      summary: {
        headline: "You're on track.",
        points: [
          `${overdrawn.summary} 1 more account alert is at the top of the dashboard.`,
          'Payday is Dec 1.',
        ],
        writtenBy: 'Leeway',
      },
    })
    expect(email.subject).toBe('Your week in Leeway: an account is overdrawn')
    expect(email.alerts).toEqual(['Your Chase checking account is overdrawn by $42.10.'])
    // Said once, at the top: not again in the points or the heads-up list.
    expect(email.points).toEqual(['Payday is Dec 1.'])
    expect(
      section({ checkin: checkin({ alerts: [overdrawn], attention: [accountItem] }) }, 'Heads up')
        .items,
    ).toEqual([])

    const page = weeklyEmailHtml(email)
    expect(page.indexOf(overdrawn.summary)).toBeLessThan(page.indexOf('<h1'))
    expect(page).not.toContain('Everyday')
    expect(weeklyEmailText(email)).toMatch(
      /^Alerts\n- Your Chase checking account is overdrawn by \$42\.10\.\n\nYou're on track\./,
    )
  })

  it('names a card over its limit in the subject, and keeps it plain for warnings', () => {
    const overLimit = accountAlert({
      kind: 'over_limit',
      summary: 'Your card is $5.00 over its limit.',
    })
    expect(content({ checkin: checkin({ alerts: [overLimit] }) }).subject).toBe(
      'Your week in Leeway: a card is over its limit',
    )
    const low = accountAlert({ kind: 'low_balance', severity: 'warning' })
    expect(content({ checkin: checkin({ alerts: [low] }) }).subject).toBe(
      'Your week in Leeway: $1,200 left this month',
    )
  })

  it('has no alert block when nothing is wrong', () => {
    const email = content()
    expect(email.alerts).toEqual([])
    expect(weeklyEmailHtml(email)).not.toContain('#fdecea')
    expect(weeklyEmailText(email)).not.toContain('Alerts')
  })
})

describe('weeklyEmailHtml', () => {
  const html = (change: Partial<WeeklyEmailInput> = {}) => weeklyEmailHtml(content(change))

  it('is a complete document that reads in light and dark mode', () => {
    const page = html()
    expect(page).toMatch(/^<!doctype html>\n<html lang="en-US">/)
    expect(page).toContain('<meta name="color-scheme" content="light dark">')
    expect(page).toContain('@media (prefers-color-scheme: dark)')
    expect(page).toContain('You&#39;re on track.')
    expect(page).toContain('<li style="margin:0 0 6px;">Payday is Dec 1.</li>')
    expect(page).toContain('$85.71')
    expect(page).toContain('Nothing needs you right now.')
  })

  it('lays out each list as rows, leaving the amount cell empty for a line without one', () => {
    const items = [attention('Bank needs the owner.', 'Bank needs you.')]
    const page = html({ checkin: checkin({ attention: items }) })
    expect(page).toMatch(/>Bank needs you\.<\/td><td [^>]*><\/td><\/tr>/)
    expect(page).not.toContain('Nothing needs you right now.')
  })

  it('loads nothing from elsewhere: no images, fonts, styles or scripts', () => {
    const page = html()
    expect(page).not.toMatch(/<img|<link|<script|@import|url\(|src=/i)
  })

  it('escapes every name, so a merchant or goal can never become markup', () => {
    const goals = [goal('<script>alert("x")</script> & "Fun"')]
    const page = html({ checkin: checkin({ goals }) })
    expect(page).not.toContain('<script>')
    expect(page).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Fun&quot;',
    )
    expect(escapeHtml(`'`)).toBe('&#39;')
  })

  it('links to Leeway only at a plain web address', () => {
    expect(html()).toContain('<a href="https://leeway.example.com"')
    expect(html({ appUrl: null })).not.toContain('Open Leeway')
    expect(html({ appUrl: 'javascript:alert(1)' })).not.toContain('Open Leeway')
  })

  it('leaves out the list of points when the summary has none', () => {
    const page = html({ summary: { headline: 'Fine.', points: [], writtenBy: 'Leeway' } })
    expect(page).not.toContain('<ul')
  })
})

describe('weeklyEmailText', () => {
  it('says the same as the HTML, in plain text', () => {
    const items = [attention('Bank needs the owner.', 'Bank needs you.')]
    const text = weeklyEmailText(
      content({
        checkin: checkin({ attention: items, goals: [goal('Fund')] }),
        billsDue: [bill('Phone', '2026-11-20', 6000)],
      }),
    )
    expect(text).toBe(`You're on track.

- Payday is Dec 1.

This month
- Left to spend: $1,200
- Per day: $85.71
- Period ends: Nov 30

Heads up
- Bank needs you.

Bills before payday on Dec 1
- Phone, Nov 20: $60

Goals
- Fund: 25% saved, $100 to go

Open Leeway: https://leeway.example.com

You get this because the weekly email is on in Leeway. To stop it or change its day, open Customize, then Email.
`)
  })

  it('leaves no gaps where there are no points or address, and says when lists are empty', () => {
    const text = weeklyEmailText(
      content({ summary: { headline: 'Fine.', points: [], writtenBy: 'Leeway' }, appUrl: null }),
    )
    expect(text).toMatch(/^Fine\.\n\nThis month\n/)
    expect(text).toContain('Heads up\nNothing needs you right now.')
    expect(text).not.toContain('Open Leeway')
    expect(text).not.toMatch(/\n\n\n/)
  })
})

describe('the whole email', () => {
  it('never uses a dash as punctuation', () => {
    const email = content({ billsDue: [bill('Phone', '2026-11-20', 6000)] })
    // The en and em dash, built from their code points so this file holds neither.
    const dashes = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`)
    for (const part of [weeklyEmailHtml(email), weeklyEmailText(email)]) {
      expect(part).not.toMatch(dashes)
    }
  })
})
