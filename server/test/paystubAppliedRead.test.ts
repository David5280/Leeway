// The newest confirmed paystub read from the database and applied: only
// while it is the newest paystub and recent, so an old one or a newer one
// saved without its lines never overrides better data; and once it is, it
// feeds current pay, the financial profile, its savings rate and the
// month-by-month rate.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { readPaystubPayroll } from '../src/domain/paystubs/applied.js'
import type { ConfirmedDetail } from '../src/domain/paystubs/confirmed.js'
import { saveDetail } from '../src/domain/paystubs/detailStore.js'
import { insertPaystub } from '../src/domain/paystubs/paystubs.js'
import { readCurrentPay } from '../src/domain/pay/source.js'
import { profileDigest } from '../src/domain/profile/digest.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { savingsRates } from '../src/domain/savingsRates.js'
import { getSettings } from '../src/domain/settings.js'
import { confirmedDetail, confirmedPaystub, line } from './fixtures/paystub.js'
import { insertBiweeklyPay } from './fixtures/pay.js'
import { createTestContext, resetData } from './helpers.js'

const TODAY = '2026-11-17'

let ctx: AppContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/**
 * Acme's paystub for the biweekly fixture's last payday (13 November):
 * 2,140.00 take-home, within 5% of the 2,100.00 the bank sees, and a 5% match.
 */
function acmeDetail(fields: Partial<ConfirmedDetail> = {}): ConfirmedDetail {
  const detail = confirmedDetail({ employerName: 'Acme Corp', payCadence: 'biweek', ...fields })
  return {
    ...detail,
    pay: { ...detail.pay, net: line(214_000) },
    employer: { ...detail.employer, match: line(19_225, 403_725) },
    ...fields,
  }
}

describe('readPaystubPayroll: staleness', () => {
  it('gives nothing with no paystub saved', async () => {
    expect(await readPaystubPayroll(ctx.db, TODAY)).toEqual({
      planMonthlyCents: null,
      stalePlan: null,
      matchMonthlyCents: null,
      figures: null,
    })
  })

  it('gives the figures and the match of a recent confirmed paystub', async () => {
    await saveDetail(ctx.db, acmeDetail())
    const payroll = await readPaystubPayroll(ctx.db, TODAY)
    expect(payroll.figures?.paidOn).toBe('2026-11-13')
    expect(payroll.matchMonthlyCents).toBeGreaterThan(0)
    expect(payroll.planMonthlyCents).not.toBeNull()
  })

  it('gives no figures from a paystub over six months old', async () => {
    await saveDetail(ctx.db, acmeDetail({ payDate: '2026-04-10' }))
    const payroll = await readPaystubPayroll(ctx.db, TODAY)
    expect(payroll.figures).toBeNull()
    expect(payroll.matchMonthlyCents).toBeNull()
    expect(payroll.stalePlan).not.toBeNull()
  })

  it('gives no figures once a newer paystub is saved without its lines', async () => {
    await saveDetail(ctx.db, acmeDetail())
    await insertPaystub(ctx.db, confirmedPaystub({ payDate: '2026-11-14' }), null)
    const payroll = await readPaystubPayroll(ctx.db, TODAY)
    expect(payroll.figures).toBeNull()
    expect(payroll.matchMonthlyCents).toBeNull()
  })
})

describe('a confirmed paystub applied', () => {
  it("sets current pay's paycheck from its take-home, the paydays still the bank's", async () => {
    await insertBiweeklyPay(ctx.db)
    const settings = await getSettings(ctx.db)
    const found = await readCurrentPay(ctx.db, settings, TODAY)
    expect(found.paycheckCents).toBe(210_000)

    await saveDetail(ctx.db, acmeDetail())
    const read = await readCurrentPay(ctx.db, settings, TODAY)
    expect(read.paycheckCents).toBe(214_000)
    expect(read.nextPayday).toBe(found.nextPayday)
  })

  it('leaves current pay to the deposits once the paystub is stale', async () => {
    await insertBiweeklyPay(ctx.db)
    await saveDetail(ctx.db, acmeDetail({ payDate: '2026-04-10' }))
    const read = await readCurrentPay(ctx.db, await getSettings(ctx.db), TODAY)
    expect(read.paycheckCents).toBe(210_000)
  })

  it('feeds the profile its figures, and the match to its savings rate', async () => {
    await insertBiweeklyPay(ctx.db)
    await saveDetail(ctx.db, acmeDetail())
    const profile = await getFinancialProfile(ctx.db, await getSettings(ctx.db), TODAY)
    expect(profile.paystub?.taxes.federalWithheldCents).toBe(735_000)
    expect(profile.pay.employers[0]?.fromPaystub).toBe(true)
    const labels = profile.savingsRate?.sources.map((source) => source.label)
    expect(labels).toContain('Employer match')
    const digest = profileDigest(profile, (cents) => `$${cents / 100}`)
    expect(digest).toContain('Confirmed paystub paid')
    expect(digest).toContain('(take-home from a confirmed paystub)')
  })

  it("counts the match in the month-by-month rate too, as the profile's rate does", async () => {
    await insertBiweeklyPay(ctx.db)
    await saveDetail(ctx.db, acmeDetail())
    const settings = await getSettings(ctx.db)
    const rates = await savingsRates(ctx.db, settings, new Date(`${TODAY}T12:00:00Z`), 3)
    expect(rates.note).toContain("Your employer's match counts too.")
  })
})
