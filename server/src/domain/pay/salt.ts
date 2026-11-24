// The salt payer ids are keyed with (ownPay.ts), made once per install and
// saved before the first id is made, so an id names the same job after a
// restart and a saved confirmation or own pay keeps its job. It is never
// shown: get_settings and the backup file leave the owner's pay out.

import { randomBytes } from 'node:crypto'
import type { Db } from '../../db/pool.js'
import { saveSettings, type Settings } from '../settings.js'

/**
 * The settings with a payer salt saved, making and saving one the first time
 * any path that makes payer ids runs (get_pay, confirm_pay, set_pay).
 */
export async function withPayerSalt(db: Db, settings: Settings): Promise<Settings> {
  if (settings.pay.payerSalt !== null) return settings
  const payerSalt = randomBytes(16).toString('hex')
  return saveSettings(db, { ...settings, pay: { ...settings.pay, payerSalt } })
}
