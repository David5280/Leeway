// Leeway writes a bill's new usual amount only over the amount it worked it
// out from (billChangeSource.ts, setUsual). An owner's update_bill that lands
// between the read and the write keeps their figure, and the write is
// skipped quietly, whether a refresh settles the bill or a dismissal takes
// a changed charge's amount.

import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { acceptBillChange, settleBillChanges } from '../src/domain/billChangeSource.js'
import { actionCaller } from './actionCaller.js'
import { addCharges, cityPowerCharged, SWUNG, TODAY, usualOf } from './fixtures/cityPower.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
const caller = actionCaller(() => ctx)
const { call } = caller

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
})

/** The start of the statement that writes a bill's usual amount. */
const USUAL_WRITE = 'UPDATE bills SET amount_cents'

/**
 * `db`, but running `meanwhile` once, just before Leeway's first write of a
 * bill's usual amount: an owner's edit landing between the read and the write.
 */
function interleaved(db: pg.Pool, meanwhile: () => Promise<unknown>): pg.Pool {
  let ran = false
  const query = async (text: string, values?: unknown[]) => {
    if (!ran && text.startsWith(USUAL_WRITE)) {
      ran = true
      await meanwhile()
    }
    return db.query(text, values)
  }
  return new Proxy(db, {
    get: (target, property, receiver) =>
      property === 'query' ? query : Reflect.get(target, property, receiver),
  })
}

/** City Power charged $90 on Nov 16 after its swings: following settles it at $103.33. */
const cityPowerInNovember = () => cityPowerCharged(ctx.db, caller, [...SWUNG, ['2026-11-16', 9000]])

const amountSetAt = async (billId: string) => {
  const { rows } = await ctx.db.query<{ at: Date | null }>(
    'SELECT amount_set_at AS at FROM bills WHERE id = $1',
    [billId],
  )
  return rows[0]!.at
}

describe('settling a bill while the owner changes it', () => {
  it("keeps the owner's $200 set between the read and the write, and writes nothing", async () => {
    const { billId } = await cityPowerInNovember()
    const racing = interleaved(ctx.db, () =>
      call('update_bill', { id: billId, amountCents: 20000 }),
    )
    expect(await settleBillChanges(racing, 'UTC', TODAY)).toBe(0)
    expect(await usualOf(caller, billId)).toBe(20000)
    expect(await amountSetAt(billId)).toEqual(new Date('2026-11-17T18:00:00Z'))
    // The next refresh reads the owner's figure, set after the cycle, and leaves it.
    expect(await settleBillChanges(ctx.db, 'UTC', TODAY)).toBe(0)
    expect(await usualOf(caller, billId)).toBe(20000)
  })

  it('skips the write when the owner set an amount and then put the old one back', async () => {
    const { billId } = await cityPowerInNovember()
    const racing = interleaved(ctx.db, async () => {
      await call('update_bill', { id: billId, amountCents: 20000 })
      await call('update_bill', { id: billId, amountCents: 11000 })
    })
    // The amount reads as it did, but it was set since, so it is the owner's now.
    expect(await settleBillChanges(racing, 'UTC', TODAY)).toBe(0)
    expect(await usualOf(caller, billId)).toBe(11000)
  })

  it('still writes when the owner only renamed the bill meanwhile', async () => {
    const { billId } = await cityPowerInNovember()
    const racing = interleaved(ctx.db, () => call('update_bill', { id: billId, name: 'Power' }))
    expect(await settleBillChanges(racing, 'UTC', TODAY)).toBe(1)
    // $90, $130 and $90 average $103.33.
    expect(await usualOf(caller, billId)).toBe(10333)
  })

  it('writes over an amount set to the microsecond, as SQL now() records it', async () => {
    const { billId, accountId } = await cityPowerInNovember()
    await ctx.db.query(
      `UPDATE bills SET amount_set_at = '2026-11-17 09:00:00.123456+00' WHERE id = $1`,
      [billId],
    )
    ctx.setNow(new Date('2026-12-17T18:00:00Z'))
    await addCharges(ctx.db, accountId, [['2026-12-16', 15000]])
    // A Date read back keeps only milliseconds; the write must still match the row.
    expect(await settleBillChanges(ctx.db, 'UTC', '2026-12-17')).toBe(1)
    expect(await usualOf(caller, billId)).toBe(15000)
  })
})

describe('dismissing a changed charge while the owner changes the bill', () => {
  /** Netflix at $15.49, charged $22.99 on Nov 16: a change, with an alert. */
  async function netflixRaised() {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    const bill = await call('create_bill', {
      name: 'Netflix',
      amountCents: 1549,
      cadence: 'month',
      anchorDate: '2026-12-16',
      matchPattern: 'netflix',
    })
    await ctx.db.query(`UPDATE bills SET created_at = '2026-06-25' WHERE id = $1`, [bill.id])
    for (const [date, amountCents] of [
      ['2026-09-16', 1549],
      ['2026-10-16', 1549],
      ['2026-11-16', 2299],
    ] as const) {
      await insertBankTransaction(ctx.db, accountId, { date, name: 'NETFLIX', amountCents })
    }
    return { billId: bill.id, target: { billId: bill.id, date: '2026-11-16' } }
  }

  it('takes the new amount when nothing came between', async () => {
    const { billId, target } = await netflixRaised()
    expect(await acceptBillChange(ctx.db, 'UTC', TODAY, target)).toBe(true)
    expect(await usualOf(caller, billId)).toBe(2299)
  })

  it("keeps the owner's $9.99 set between the read and the write, and learns nothing", async () => {
    const { billId, target } = await netflixRaised()
    const racing = interleaved(ctx.db, () => call('update_bill', { id: billId, amountCents: 999 }))
    expect(await acceptBillChange(racing, 'UTC', TODAY, target)).toBe(false)
    expect(await usualOf(caller, billId)).toBe(999)
  })
})
