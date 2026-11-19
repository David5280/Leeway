// The amounts Settings > AI models shows: spending, the limit and model
// prices, always in US dollars to the cent, since that is how Anthropic bills.

import { Money } from '../../../components/design/Money'
import { MAX_MONTHLY_CAP_CENTS } from '../../../../../server/src/domain/ai/settings'
import { AI_CURRENCY, modelPrices, spentCents, type CapProblem, type ModelChoice } from './aiText'

/** An amount in US dollars and cents: "$5.00". */
export function Dollars({ cents }: { cents: number }) {
  return <Money cents={cents} currency={AI_CURRENCY} precision="cents" />
}

/** A spend in millionths of a dollar, rounded up to the cent, or "Under $0.01" for a sliver. */
export function Spent({ micros }: { micros: number }) {
  const { cents, under } = spentCents(micros)
  return (
    <>
      {under && 'Under '}
      <Dollars cents={cents} />
    </>
  )
}

/** "$2.00 in, $10.00 out per million tokens", with any dearer long-prompt prices. */
export function Price({ model, locale }: { model: ModelChoice; locale: string }) {
  const { base, long } = modelPrices(model)
  return (
    <>
      <Dollars cents={base.input} /> in, <Dollars cents={base.output} /> out per million tokens
      {long && (
        <>
          ; <Dollars cents={long.input} /> in, <Dollars cents={long.output} /> out past{' '}
          {long.overTokens.toLocaleString(locale)} tokens
        </>
      )}
    </>
  )
}

/** Why a typed limit was turned away. */
export function CapProblemText({ problem }: { problem: CapProblem }) {
  if (problem === 'not_an_amount') return <>Enter an amount, like $5.</>
  return (
    <>
      Use <Dollars cents={MAX_MONTHLY_CAP_CENTS} /> or less.
    </>
  )
}
