// What a tool's output looks like on its way to the chat model, given what
// Chat hides (paymentPeople finds it from real rows; chatPeople.test.ts and
// the files beside it test that end to end). Every name is made up.

import { describe, expect, it } from 'vitest'
import { chatToolText } from '../src/chat/toolOutput.js'
import { NO_PEOPLE, type PaymentPeople } from '../src/domain/chat/people.js'
import type { RowLabel } from '../src/domain/modelLabels.js'

/** What Chat hides, with only what a case sets. */
const hiding = (fields: Partial<PaymentPeople>): PaymentPeople => ({ ...NO_PEOPLE, ...fields })

/** The output as the model reads it, parsed back. */
const sent = (result: unknown, people: PaymentPeople = NO_PEOPLE): unknown =>
  JSON.parse(chatToolText(result, people))

const ZELLE: RowLabel = { label: 'Zelle payment (sent)', kind: 'app' }
const TRANSFER: RowLabel = { label: 'Transfer to another account', kind: 'transfer' }

describe('a labelled transaction', () => {
  const rows = new Map([
    ['z', ZELLE],
    ['t', TRANSFER],
  ])

  it('reads as its label, with no bank text, person or account mask', () => {
    const result = {
      transactions: [
        {
          id: 'z',
          displayName: 'To Jane Doe',
          name: 'Zelle payment to JANE DOE 4417',
          merchantName: null,
          amountCents: 5_000,
          note: 'Jane for pizza',
          person: { app: 'Zelle', direction: 'out', counterparty: 'Jane Doe' },
        },
      ],
      accounts: [{ name: 'Checking', mask: '4417' }],
      at: new Date('2026-11-17T00:00:00Z'),
    }
    expect(sent(result, hiding({ rows }))).toEqual({
      transactions: [
        { id: 'z', displayName: ZELLE.label, amountCents: 5_000, note: null, person: null },
      ],
      accounts: [{ name: 'Checking' }],
      at: '2026-11-17T00:00:00.000Z',
    })
  })

  it("keeps a transfer's note with names hidden, and a paired transfer its own name", () => {
    const row = {
      id: 't',
      displayName: 'Transfer to Clara Thornbury',
      amountCents: 9,
      note: 'Rent, Clara',
    }
    const paired = {
      id: 't',
      displayName: 'Checking to Savings',
      amountCents: 9,
      transfer: { id: 'u' },
    }
    const people = hiding({ rows, loneAnyCase: ['Clara'] })
    expect(sent([row, paired], people)).toEqual([
      { ...row, displayName: TRANSFER.label, note: 'Rent, someone' },
      paired,
    ])
  })

  it("is a leak's charge too, its alert's words replaced by what it would have shown", () => {
    const alert = {
      message: 'Cash App Quillon charged $20 twice.',
      charge: { id: 'z', merchant: 'Cash App Quillon', previousCents: null },
    }
    const people = hiding({ rows, phrases: [['Cash App Quillon', ZELLE.label]] })
    expect(sent(alert, people)).toEqual({
      message: `${ZELLE.label} charged $20 twice.`,
      charge: { id: 'z', merchant: ZELLE.label, previousCents: null },
    })
  })
})

describe('a bill tracking labelled rows', () => {
  const bills = new Map([
    ['b1', { label: ZELLE.label, renamed: true }],
    ['b2', { label: TRANSFER.label, renamed: false }],
  ])

  it('never shows its pattern, and shows its label for a name that could be a person', () => {
    const result = {
      bills: [
        { id: 'b1', name: 'To Jane Doe', matchPattern: 'zelle payment to jane doe' },
        { id: 'b2', name: 'Rent', matchPattern: 'thornbury' },
        { id: 'b3', name: 'Netflix', matchPattern: 'netflix' },
      ],
      billsDue: [{ billId: 'b1', name: 'To Jane Doe', dueDate: '2026-11-20' }],
    }
    expect(sent(result, hiding({ bills }))).toEqual({
      bills: [
        { id: 'b1', name: ZELLE.label },
        { id: 'b2', name: 'Rent' },
        { id: 'b3', name: 'Netflix', matchPattern: 'netflix' },
      ],
      billsDue: [{ billId: 'b1', name: ZELLE.label, dueDate: '2026-11-20' }],
    })
  })
})

describe('merchant totals and series of labelled rows', () => {
  it('read as their label, one row for each, biggest spending first', () => {
    const total = (merchant: string, spentCents: number, modelLabel?: string) => ({
      merchant,
      spentCents,
      count: 1,
      ...(modelLabel ? { modelLabel } : {}),
    })
    const result = [
      total('Groceries Co', 5_000),
      total('To Jane Doe', 3_000, ZELLE.label),
      total('To Ilsabet Quorn', 4_000, ZELLE.label),
      total('Transfer to Clara', 1_000, TRANSFER.label),
    ]
    expect(sent(result)).toEqual([
      { merchant: ZELLE.label, spentCents: 7_000, count: 2 },
      { merchant: 'Groceries Co', spentCents: 5_000, count: 1 },
      { merchant: TRANSFER.label, spentCents: 1_000, count: 1 },
    ])
  })

  it('merge a series only with one of the same direction and cadence', () => {
    const series = (name: string, cadence: string, dates: [string, string], cents: number) => ({
      key: name.toLowerCase(),
      name,
      direction: 'out',
      cadence,
      typicalAmountCents: cents,
      amountVaries: false,
      count: 4,
      lastDate: dates[0],
      nextDate: dates[1],
      modelLabel: ZELLE.label,
    })
    const result = [
      series('To Jane Doe', 'month', ['2026-11-05', '2026-12-05'], 20_000),
      series('To Ilsabet Quorn', 'month', ['2026-11-09', '2026-12-01'], 5_000),
      series('To Clara', 'week', ['2026-11-15', '2026-11-22'], 1_000),
      { key: 'netflix', name: 'Netflix', direction: 'out', cadence: 'month' },
    ]
    const label = { key: ZELLE.label, name: ZELLE.label, direction: 'out' }
    expect(sent(result)).toEqual([
      {
        ...label,
        cadence: 'month',
        typicalAmountCents: 25_000,
        amountVaries: true,
        count: 8,
        lastDate: '2026-11-09',
        nextDate: '2026-12-01',
      },
      {
        ...label,
        cadence: 'week',
        typicalAmountCents: 1_000,
        amountVaries: false,
        count: 4,
        lastDate: '2026-11-15',
        nextDate: '2026-11-22',
      },
      { key: 'netflix', name: 'Netflix', direction: 'out', cadence: 'month' },
    ])
  })

  it('keep a lone labelled row as it is, and a list with none untouched', () => {
    const one = { merchant: 'To Jane Doe', spentCents: 1, count: 1, modelLabel: ZELLE.label }
    expect(sent({ one, list: [1, 'a', null] })).toEqual({
      one: { merchant: ZELLE.label, spentCents: 1, count: 1, modelLabel: ZELLE.label },
      list: [1, 'a', null],
    })
  })
})

describe('a hidden name anywhere else', () => {
  it('goes as a full name from every field, in compact JSON', () => {
    const people = hiding({ names: ['Jane Doe', ' '] })
    expect(chatToolText({ category: 'Gifts for JANE DOE', a: [1, 2] }, people)).toBe(
      JSON.stringify({ category: 'Gifts for someone', a: [1, 2] }),
    )
  })

  it('goes as a single word from labels too, but an account word stays outside notes', () => {
    const people = hiding({
      loneAnyCase: ['Kettering'],
      loneNames: ['Chase'],
      accountWords: ['chase', 'checking'],
    })
    const result = {
      categories: [{ name: 'Kettering loan' }, { name: 'kettering fund' }],
      accounts: [{ name: 'Chase Checking' }],
      note: 'Chase paid back; kettering too',
    }
    expect(sent(result, people)).toEqual({
      categories: [{ name: 'someone loan' }, { name: 'someone fund' }],
      accounts: [{ name: 'Chase Checking' }],
      note: 'someone paid back; someone too',
    })
  })

  it('goes as a common word an app named as the person paid only from notes', () => {
    const people = hiding({ noteNames: ['Rent'] })
    expect(sent({ category: 'Rent', note: 'Rent paid me back; rent is due' }, people)).toEqual({
      category: 'Rent',
      note: 'someone paid me back; rent is due',
    })
  })

  it('goes as a short word only as a name is written, with a capital or in capitals', () => {
    const people = hiding({ loneNames: ['Bo'] })
    expect(sent({ note: 'Bo, BO and bo' }, people)).toEqual({ note: 'someone, someone and bo' })
  })

  it('keeps every value when names in keys would land on the same key', () => {
    const result = { 'Jane Doe': 1, 'JANE DOE': 2, someone: 3 }
    expect(sent(result, hiding({ names: ['Jane Doe'] }))).toEqual({
      someone: 1,
      'someone 2': 2,
      'someone 3': 3,
    })
  })

  it('drops a counterparty wherever one is written', () => {
    expect(sent({ person: { counterparty: 'Quillon' } })).toEqual({
      person: { counterparty: null },
    })
  })
})
