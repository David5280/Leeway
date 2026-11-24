// What Leeway uses from the newest paystub, as the Settings screen reads it
// through get_paystub_use: none saved, confirmed and applied to pay,
// confirmed with no deposit to back it, too old, and saved for a pension only.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ConfirmedDetail } from '../src/domain/paystubs/confirmed.js'
import { saveDetail } from '../src/domain/paystubs/detailStore.js'
import { insertPaystub } from '../src/domain/paystubs/paystubs.js'
import { actionCaller } from './actionCaller.js'
import { confirmedDetail, confirmedPaystub, line } from './fixtures/paystub.js'
import { insertBiweeklyPay } from './fixtures/pay.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  // Midday on 17 November in Denver, so "today" is the same wherever the tests run.
  ctx = await createTestContext({ now: new Date('2026-11-17T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** Acme's paystub for the biweekly fixture's last payday: 2,140.00 take-home, near the 2,100.00 deposit. */
function acmeDetail(fields: Partial<ConfirmedDetail> = {}): ConfirmedDetail {
  const detail = confirmedDetail({ employerName: 'Acme Corp', payCadence: 'biweek', ...fields })
  return { ...detail, pay: { ...detail.pay, net: line(214_000) }, ...fields }
}

describe('get_paystub_use', () => {
  it('says none before any paystub is saved', async () => {
    expect(await call('get_paystub_use')).toEqual({
      state: 'none',
      paidOn: null,
      takeHomeCents: null,
      appliedToPay: false,
      notForPay: null,
      retirementInUse: false,
      figures: null,
    })
  })

  it('gives the figures in use, and the take-home standing for the paycheck the bank shows', async () => {
    await insertBiweeklyPay(ctx.db)
    await saveDetail(ctx.db, acmeDetail())
    const use = await call('get_paystub_use')
    expect(use).toMatchObject({
      state: 'used',
      paidOn: '2026-11-13',
      takeHomeCents: 214_000,
      appliedToPay: true,
      notForPay: null,
    })
    expect(use.figures?.taxes.federalWithheldCents).toBe(735_000)
    expect(use.figures?.yearlyGross?.cents).toBeGreaterThan(0)
  })

  it('uses the figures but not the take-home when no deposit backs it', async () => {
    await saveDetail(ctx.db, acmeDetail())
    const use = await call('get_paystub_use')
    expect(use.state).toBe('used')
    expect(use.figures).not.toBeNull()
    expect(use).toMatchObject({ appliedToPay: false, notForPay: 'noMatch' })
  })

  it("says the owner's own pay stands instead of the take-home", async () => {
    await insertBiweeklyPay(ctx.db)
    await call('set_pay', {
      pay: { amountCents: 250_000, cadence: 'biweek', nextPayday: '2026-11-27' },
    })
    await saveDetail(ctx.db, acmeDetail())
    expect(await call('get_paystub_use')).toMatchObject({
      state: 'used',
      appliedToPay: false,
      notForPay: 'ownPay',
    })
  })

  it('says a paycheck with a bonus in it is no usual one', async () => {
    await insertBiweeklyPay(ctx.db)
    const detail = acmeDetail()
    await saveDetail(ctx.db, {
      ...detail,
      earnings: { ...detail.earnings, bonus: line(50_000) },
    })
    expect(await call('get_paystub_use')).toMatchObject({
      state: 'used',
      appliedToPay: false,
      notForPay: 'oneOff',
    })
  })

  it('says when the paystub shows no schedule to place its take-home', async () => {
    await insertBiweeklyPay(ctx.db)
    await saveDetail(ctx.db, acmeDetail({ payCadence: null }))
    expect(await call('get_paystub_use')).toMatchObject({
      state: 'used',
      appliedToPay: false,
      notForPay: 'noSchedule',
    })
  })

  it('calls a paystub over six months old stale, using none of it', async () => {
    await insertBiweeklyPay(ctx.db)
    await saveDetail(ctx.db, acmeDetail({ payDate: '2026-04-10' }))
    expect(await call('get_paystub_use')).toMatchObject({
      state: 'stale',
      paidOn: '2026-04-10',
      appliedToPay: false,
      figures: null,
    })
  })

  it('calls a recent paystub saved for a pension only partial, its plan in use', async () => {
    // The city paystub shows a 457, which the savings rate counts.
    await insertPaystub(ctx.db, confirmedPaystub({ payDate: '2026-11-14' }), null)
    expect(await call('get_paystub_use')).toMatchObject({
      state: 'partial',
      paidOn: '2026-11-14',
      retirementInUse: true,
      notForPay: null,
      figures: null,
    })
  })

  it('says a partial paystub with no pension or plan feeds no retirement figure', async () => {
    const paystub = confirmedPaystub({ payDate: '2026-11-14' })
    const current = { ...paystub.current, plan401k: null, plan457: null, plan403b: null }
    await insertPaystub(ctx.db, { ...paystub, current }, null)
    expect((await call('get_paystub_use')).retirementInUse).toBe(false)
  })

  it('never returns who paid or anything that names someone', async () => {
    await saveDetail(ctx.db, acmeDetail())
    expect(JSON.stringify(await call('get_paystub_use'))).not.toMatch(/Acme|City of Example/)
  })
})
