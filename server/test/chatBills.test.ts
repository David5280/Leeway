// What Chat sends a model about repeating payments that are labelled and the
// bills tracking them, read from real rows through the tools: one series or
// total per label, never one per person, and a bill that never shows its
// pattern, nor a name that could be a person's, in any tool. Every name is made up.

import { describe, expect, it } from 'vitest'
import { createBill } from '../src/domain/bills.js'
import { untrackedRecurring } from '../src/domain/recurring.js'
import { trackRecurring } from '../src/domain/trackRecurring.js'
import { ACCOUNT_TRANSFER, useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { pay } = probe
const TODAY = '2026-11-17'
const MONTHS = ['08', '09', '10', '11']

/** Pays each of these people every month, the 5th, through Zelle. */
async function payMonthly(...people: string[]) {
  for (const month of MONTHS) {
    for (const person of people) {
      await pay(`Zelle payment to ${person} JPM99A1B2C3`, 20_000, { date: `2026-${month}-05` })
    }
  }
}

describe('repeating payments to people', () => {
  it('reach the model as one series and one total per label', async () => {
    await payMonthly('CLARA QUILLON', 'JANE DOUGHTY')
    for (const month of MONTHS) {
      const date = `2026-${month}-06`
      await pay('Online Transfer to Pellworth Oda', 90_000, {
        date,
        ...{ detailed: ACCOUNT_TRANSFER },
      })
    }

    const recurring = JSON.parse(await probe.sent('find_recurring')) as Record<string, unknown>[]
    expect(
      recurring.map(({ name, key, typicalAmountCents }) => [name, key, typicalAmountCents]),
    ).toEqual([
      ['Zelle payment (sent)', 'Zelle payment (sent)', 40_000],
      ['Transfer to another account', 'Transfer to another account', 90_000],
    ])
    expect(await probe.merchants()).toEqual(['Transfer to another account', 'Zelle payment (sent)'])
    const sent = [await probe.sent('find_recurring'), await probe.sent('top_merchants')].join()
    expect(sent).not.toMatch(/clara|quillon|jane|doughty|pellworth|oda\b/i)
  })
})

describe('a bill tracking labelled payments', () => {
  it('shows its label and no pattern wherever it is named, owner and assistant alike', async () => {
    await payMonthly('CLARA QUILLON')
    for (const month of MONTHS) {
      const date = `2026-${month}-05`
      await pay('Online Payment 18334 To Bertram Quillfeather', 150_000, {
        date,
        detailed: 'RENT_AND_UTILITIES_RENT',
      })
    }
    // The owner tracks one by its own key, an assistant the other by the key it was given.
    const [owners] = await untrackedRecurring(probe.ctx.db, TODAY)
    await trackRecurring(probe.ctx.db, owners!.key, TODAY)
    const [assistants] = await untrackedRecurring(probe.ctx.db, TODAY, { forAssistant: true })
    await trackRecurring(probe.ctx.db, assistants!.key, TODAY, { forAssistant: true })

    const { bills } = JSON.parse(await probe.sent('list_bills')) as {
      bills: Record<string, unknown>[]
    }
    expect(bills.map(({ name, matchPattern }) => [name, matchPattern]).sort()).toEqual([
      // Named after the series as the owner sees it, which names no one.
      ['Online Payment', undefined],
      ['Zelle payment (sent)', undefined],
    ])
    const tools = ['list_bills', 'get_cash_flow', 'get_checkin', 'get_summary', 'export_config']
    for (const tool of tools) {
      expect([tool, await probe.sent(tool)]).not.toEqual([
        tool,
        expect.stringMatching(/clara|quillon|bertram|quillfeather/i),
      ])
    }
  })

  it('keeps an everyday name for it, renames one that could name someone, and leaves the rest', async () => {
    await payMonthly('CLARA THORNBURY')
    await pay('Payment to Chase card ending in 4321', 5_000, {
      detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    })
    await pay('ALLY AUTO PAYMENT', 30_000, {
      merchantName: 'Ally Auto',
      detailed: 'LOAN_PAYMENTS_CAR_PAYMENT',
    })
    const bill = (name: string, matchPattern: string) => ({
      name,
      kind: 'bill' as const,
      amountCents: 1_000,
      cadence: 'month' as const,
      anchorDate: '2026-12-15',
      matchPattern,
      categoryId: null,
      autopay: false,
    })
    for (const [name, pattern] of [
      ['Rent', 'thornbury'],
      ['Chase card', 'chase'],
      ['Ally Auto', 'ally auto'],
      ['Purchases', 'rent'],
    ] as const) {
      await createBill(probe.ctx.db, bill(name, pattern), TODAY)
    }

    const { bills } = JSON.parse(await probe.sent('list_bills')) as {
      bills: Record<string, unknown>[]
    }
    expect(bills.map(({ name, matchPattern }) => [name, matchPattern ?? null]).sort()).toEqual([
      // Neither a loan's merchant nor "Chase" is surely no one's name.
      ['Card payment', null],
      ['Loan payment', null],
      ['Purchases', 'rent'],
      ['Rent', null],
    ])
  })
})
