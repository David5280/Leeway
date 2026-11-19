// Words and figures for Settings > AI models. Anthropic bills in US dollars,
// so money here is always USD, written by the app's own money helper in the
// owner's number style.

import { centsOfMicros, MICROS_PER_CENT } from '../../../../../server/src/ai/models'
import { MAX_MONTHLY_CAP_CENTS } from '../../../../../server/src/domain/ai/settings'
import type { Output } from '../../../api/client'
import { money, parseMoney, shortDate } from '../../../lib/format'

export type AiUsage = Output<'get_ai_usage'>
export type JobReport = AiUsage['jobs'][number]
export type ModelChoice = AiUsage['models'][number]

const usd = (locale: string) => ({ currency: 'USD', locale })

/** Dollars and cents: "$5.00". */
export function dollars(cents: number, locale: string): string {
  return money(cents, usd(locale), true)
}

/** A spend to the cent, rounded up as the limit counts it, or "Under $0.01" for a sliver. */
export function spentText(micros: number, locale: string): string {
  if (micros > 0 && micros < MICROS_PER_CENT) return `Under ${dollars(1, locale)}`
  return dollars(centsOfMicros(micros), locale)
}

/** How much of the limit is spent, from 0 to 100. A $0 limit is always full. */
export function percentUsed(spentMicros: number, capCents: number): number {
  if (capCents <= 0) return 100
  return Math.min(100, (spentMicros / (capCents * MICROS_PER_CENT)) * 100)
}

/** The ring's color: the accent, then amber from the warning, then red at the limit. */
export function usageTone(percent: number): string {
  if (percent >= 100) return 'var(--over-fill)'
  if (percent >= 80) return 'var(--warn-fill)'
  return 'var(--accent)'
}

/** "1 call" or "3 calls". */
export function callsText(calls: number): string {
  return calls === 1 ? '1 call' : `${calls.toLocaleString('en-US')} calls`
}

/** "Resets on Dec 1." */
export function resetText(resetsOn: string, locale: string): string {
  return `Resets on ${shortDate(resetsOn, locale)}.`
}

/**
 * A model's price per million tokens, the way Anthropic lists it:
 * "$2.00 in, $10.00 out per million tokens", with any dearer long-prompt price.
 */
export function priceText(model: ModelChoice, locale: string): string {
  const per = (price: number) => dollars(Math.round(price * 100), locale)
  const { input, output } = model.prices
  const base = `${per(input)} in, ${per(output)} out per million tokens`
  const long = 'longPrompt' in model.prices ? model.prices.longPrompt : undefined
  if (!long) return base
  const over = long.overTokens.toLocaleString(locale)
  return `${base}; ${per(long.prices.input)} in, ${per(long.prices.output)} out past ${over} tokens`
}

/** A typed limit in cents, or why it can't be one. */
export function readCap(
  text: string,
  locale: string,
): { ok: true; cents: number } | { ok: false; error: string } {
  const cents = parseMoney(text)
  if (cents === null || cents < 0) return { ok: false, error: 'Enter an amount, like $5.' }
  if (cents > MAX_MONTHLY_CAP_CENTS) {
    return { ok: false, error: `Use ${dollars(MAX_MONTHLY_CAP_CENTS, locale)} or less.` }
  }
  return { ok: true, cents }
}
