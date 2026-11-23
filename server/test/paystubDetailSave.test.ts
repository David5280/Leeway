// Saving a paystub reviewed in full: every line kept, linked to the paystub
// record the pension and retirement import reads, and nothing applied
// anywhere else yet.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { paystubFromDetail } from '../src/domain/paystubs/confirmed.js'
import { detailOf, latestDetail } from '../src/domain/paystubs/detailStore.js'
import { actionCaller } from './actionCaller.js'
import { confirmedDetail, confirmedPaystub, line } from './fixtures/paystub.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

describe('paystubFromDetail', () => {
  it("works out the import's figures from the lines, a plan taking in its Roth side", () => {
    // The same paystub the import has always kept, now with the 457 split into its two sides.
    expect(paystubFromDetail(confirmedDetail())).toEqual(confirmedPaystub())
  })

  it('keeps unknown figures unknown, never 0', () => {
    const paystub = paystubFromDetail(confirmedDetail())
    expect(paystub.current.plan401k).toBeNull()
    expect(paystub.current.hsa).toBeNull()
    expect(paystub.yearToDate.netPay).toBeNull()
  })
})

describe('save_paystub_detail', () => {
  it('saves every line beside the paystub record, linked to it', async () => {
    const detail = confirmedDetail()
    const saved = await call('save_paystub_detail', { detail })
    expect(saved.paystub).toMatchObject({ ...confirmedPaystub(), pensionAccountId: null })
    expect(saved.detail).toEqual({
      ...detail,
      paystubId: saved.paystub.id,
      savedAt: expect.any(String),
    })
    // The import still reads it as the newest paystub, and the lines read back whole.
    expect((await call('get_paystub')).latest?.id).toBe(saved.paystub.id)
    expect(await latestDetail(ctx.db)).toEqual(saved.detail)
    expect(await detailOf(ctx.db, saved.paystub.id)).toEqual(saved.detail)
  })

  it('keeps hours and an hourly rate for hourly pay', async () => {
    const hourly = confirmedDetail({
      pay: { ...confirmedDetail().pay, hours: 86.67, hourlyRate: 4_806, annualSalary: null },
    })
    const { detail } = await call('save_paystub_detail', { detail: hourly })
    expect(detail.pay).toMatchObject({ hours: 86.67, hourlyRate: 4_806, annualSalary: null })
  })

  it('applies nothing elsewhere: no pension, no contribution', async () => {
    await call('save_paystub_detail', { detail: confirmedDetail() })
    const { plan } = await call('project_retirement')
    expect(plan.pensions).toEqual([])
    expect(plan.assumptions.monthlyContributionCents).toBeNull()
  })

  it('goes with its paystub record when that is deleted', async () => {
    const { paystub } = await call('save_paystub_detail', { detail: confirmedDetail() })
    await call('delete_paystub', { id: paystub.id })
    expect(await latestDetail(ctx.db)).toBeNull()
    expect(await detailOf(ctx.db, paystub.id)).toBeNull()
    const { rows } = await ctx.db.query('SELECT 1 FROM paystub_details')
    expect(rows).toEqual([])
  })

  it('reads the newest paystub reviewed in full, skipping one saved without its lines', async () => {
    const older = await call('save_paystub_detail', {
      detail: confirmedDetail({ payDate: '2026-10-30' }),
    })
    await call('save_paystub', { paystub: confirmedPaystub({ payDate: '2026-11-27' }) })
    expect((await latestDetail(ctx.db))?.paystubId).toBe(older.paystub.id)
  })

  it('refuses figures no paystub has, saving nothing', async () => {
    const refuse = async (detail: unknown) =>
      (await callError('save_paystub_detail', { detail })).message
    const base = confirmedDetail()
    expect(await refuse({ ...base, pay: { ...base.pay, net: line(400_000) } })).toContain(
      'Take-home pay cannot be more than gross pay',
    )
    expect(await refuse({ ...base, taxes: { ...base.taxes, medicare: line(-1) } })).toContain(
      'A figure cannot be negative',
    )
    expect(
      await refuse({ ...base, taxes: { ...base.taxes, medicare: line(null, 100_000_001) } }),
    ).toContain('Use $1,000,000 or less')
    expect(await refuse({ ...base, pay: { ...base.pay, hours: 80.125 } })).toContain(
      'Use hours to the hundredth',
    )
    expect(await refuse({ ...base, pay: { ...base.pay, hourlyRate: 12.5 } })).toContain(
      'Use whole cents',
    )
    // A line left out is refused too, so nothing is dropped by mistake.
    const { other: _left, ...missing } = base.taxes
    expect(await refuse({ ...base, taxes: missing })).toContain('taxes.other')
    expect((await call('get_paystub')).latest).toBeNull()
  })
})
