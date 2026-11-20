// "When can I afford this?": if not today, how many budget periods of saving
// it takes and the date that lands on. Pure: the numbers come in, nothing is read here.

import { addDays, type IsoDate } from '../lib/dates.js'
import { periodContaining, shiftPeriod, type PeriodConfig } from '../lib/periods.js'
import type { Affordability } from './afford.js'

/** Where the amount saved each period came from. */
export type SavingBasis = 'given' | 'recent_surplus'

export interface PurchasePlan {
  amountCents: number
  /** Today's check, as can_i_afford gives it. */
  today: Affordability
  /** What would go toward it each budget period; null when there is nothing to spare. */
  perPeriodCents: number | null
  basis: SavingBasis | null
  /** A typical period's pay less spending (surplus.ts); null with no employer paying or too little history. */
  surplusPerPeriodCents: number | null
  /** What goals in progress need each period, which comes out of the surplus first. */
  goalsNeedPerPeriodCents: number
  /** Budget periods of saving it takes, counting the current one; 0 when it fits today. */
  periodsNeeded: number | null
  /** The day it is affordable: today, or the last day of the period it is saved by. */
  affordableBy: IsoDate | null
  /** The answer in a sentence, for an agent to pass on. */
  message: string
}

export interface PurchaseInputs {
  amountCents: number
  /** Already put aside toward it. */
  savedCents: number
  today: IsoDate
  check: Affordability
  /** An amount the owner says they can save each period, instead of the usual surplus. */
  perPeriodCents: number | null
  surplusPerPeriodCents: number | null
  goalsNeedPerPeriodCents: number
  config: PeriodConfig
  money: (cents: number) => string
}

/** The last day of the period `count` periods on from today's, counting today's as the first. */
function lastDayAfter(today: IsoDate, count: number, config: PeriodConfig): IsoDate {
  const last = shiftPeriod(periodContaining(today, config), count - 1, config)
  return addDays(last.end, -1)
}

/** What can go toward the purchase each period, and where that figure came from. */
function savingRate(inputs: PurchaseInputs): { cents: number | null; basis: SavingBasis | null } {
  if (inputs.perPeriodCents !== null) return { cents: inputs.perPeriodCents, basis: 'given' }
  if (inputs.surplusPerPeriodCents === null) return { cents: null, basis: null }
  const spare = inputs.surplusPerPeriodCents - inputs.goalsNeedPerPeriodCents
  return spare > 0 ? { cents: spare, basis: 'recent_surplus' } : { cents: null, basis: null }
}

/** When a purchase is affordable: today if it fits, otherwise after enough periods of saving. */
export function planPurchase(inputs: PurchaseInputs): PurchasePlan {
  const { amountCents, check, money } = inputs
  const base = {
    amountCents,
    today: check,
    surplusPerPeriodCents: inputs.surplusPerPeriodCents,
    goalsNeedPerPeriodCents: inputs.goalsNeedPerPeriodCents,
  }
  if (check.verdict === 'yes') {
    return {
      ...base,
      perPeriodCents: null,
      basis: null,
      periodsNeeded: 0,
      affordableBy: inputs.today,
      message: `It fits today. ${check.reasons[0]}`,
    }
  }
  const rate = savingRate(inputs)
  if (rate.cents === null) {
    return {
      ...base,
      perPeriodCents: null,
      basis: null,
      periodsNeeded: null,
      affordableBy: null,
      message:
        'Not today, and a typical period leaves nothing over after spending and goals, or no employer is paying yet. Ask how much the owner could put aside each period, or save for it with a purchase goal.',
    }
  }
  const toSave = Math.max(0, amountCents - inputs.savedCents)
  const periodsNeeded = Math.max(1, Math.ceil(toSave / rate.cents))
  const affordableBy = lastDayAfter(inputs.today, periodsNeeded, inputs.config)
  const from = rate.basis === 'given' ? 'Putting aside' : 'At your usual surplus of'
  return {
    ...base,
    perPeriodCents: rate.cents,
    basis: rate.basis,
    periodsNeeded,
    affordableBy,
    message: `Not today. ${from} ${money(rate.cents)} each budget period, it is affordable by ${affordableBy} (${periodsNeeded} ${periodsNeeded === 1 ? 'period' : 'periods'}).`,
  }
}
