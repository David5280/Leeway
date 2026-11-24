// The salt payer ids are keyed with (pay/salt.ts): saved for this install
// before the first id is made, so ids never change, and never shown by any
// action or in the backup file, nor are the payer ids the owner's word keeps.
// Every name and amount is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import { insertBiweeklyPay } from './fixtures/pay.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** The owner's word on their pay as stored, salt and all. */
const storedPay = async () => (await getSettings(ctx.db)).pay

const OWN = { amountCents: 220_000, cadence: 'biweek', nextPayday: '2026-11-27' } as const

describe('the payer salt', () => {
  it('is saved the first time get_pay makes an id, so the id is the same on every read', async () => {
    await insertBiweeklyPay(ctx.db)
    expect((await storedPay()).payerSalt).toBeNull()
    const first = await call('get_pay')
    const { payerSalt } = await storedPay()
    expect(payerSalt).toMatch(/^[0-9a-f]{32}$/)
    expect((await call('get_pay')).found!.employers[0]!.id).toBe(first.found!.employers[0]!.id)
    expect((await storedPay()).payerSalt).toBe(payerSalt)
  })

  it('is kept from then on, and so are the ids the owner word names', async () => {
    await insertBiweeklyPay(ctx.db)
    const view = await call('set_pay', { pay: OWN })
    const pay = await storedPay()
    expect(pay.override!.payerId).toBe(view.found!.employers[0]!.id)
    // Going back to the paychecks and confirming keeps the salt, and so the ids.
    await call('set_pay', { pay: null })
    await call('confirm_pay')
    const after = await storedPay()
    expect(after.payerSalt).toBe(pay.payerSalt)
    expect(after.confirmed!.payerId).toBe(pay.override!.payerId)
  })

  it('never leaves through get_settings, update_settings, set_ai_summary or the backup file', async () => {
    await insertBiweeklyPay(ctx.db)
    await call('set_pay', { pay: OWN })
    await call('confirm_pay')
    await call('set_pay', { pay: OWN })
    const { payerSalt, confirmed, override } = await storedPay()
    const secrets = [payerSalt!, confirmed?.payerId, override!.payerId].filter(Boolean)
    expect(secrets.length).toBeGreaterThan(1)
    const shown = [
      await call('get_settings'),
      await call('update_settings', { includePending: false }),
      await call('set_ai_summary', { on: false }),
      await call('export_config'),
    ]
    for (const result of shown) {
      const text = JSON.stringify(result)
      expect(text).not.toContain('payerSalt')
      expect(text).not.toContain('payerId')
      for (const secret of secrets) expect(text).not.toContain(secret)
    }
    // Saving other settings keeps the owner's word on their pay as it was.
    expect((await storedPay()).payerSalt).toBe(payerSalt)
  })
})
