// A pension's plan details, folded under "More details (optional)" so adding
// a pension asks only for its name first. Each figure says in one line what
// it is for. Leeway fills in nothing: a blank figure stays not known.

import { switchContribution, type ContributionKind, type PlanText } from './fields'
import { Choice, Figure } from './PensionFields'

const CADENCES = [
  { value: '', label: 'My pay schedule' },
  { value: 'week', label: 'Every week' },
  { value: 'biweek', label: 'Every 2 weeks' },
  { value: 'semimonth', label: 'Twice a month' },
  { value: 'month', label: 'Monthly' },
] as const

const CONTRIBUTION_KINDS: { value: ContributionKind; label: string }[] = [
  { value: 'none', label: 'Not known yet' },
  { value: 'amount', label: 'An amount each paycheck' },
  { value: 'percent', label: 'A percent of gross pay' },
]

/** Changes the plan's text, from what it is now. */
type SetText = (change: (current: PlanText) => PlanText) => void

/** Sets one field of the plan's text to what was typed. */
type SetField = (field: keyof PlanText) => (value: string) => void

/** What goes in from each paycheck: the owner's share, their pay, and the employer's share. */
function WhatGoesIn({ text, set, setText }: { text: PlanText; set: SetField; setText: SetText }) {
  return (
    <>
      <h3>What goes in</h3>
      <Choice
        label="Your contribution"
        name="Contribution type"
        hint="What each paycheck pays in"
        value={text.contributionKind}
        options={CONTRIBUTION_KINDS}
        onChange={(kind) => setText((current) => switchContribution(current, kind))}
      />
      {text.contributionKind !== 'none' && (
        <Figure
          label={text.contributionKind === 'amount' ? 'Amount each paycheck' : 'Percent of pay'}
          value={text.contribution}
          onChange={set('contribution')}
        />
      )}
      <Figure
        label="Gross pay each paycheck"
        hint="Turns a percent into an amount"
        value={text.grossPay}
        onChange={set('grossPay')}
      />
      <Choice
        label="Paid"
        name="Pay schedule"
        hint="How often a paycheck comes"
        value={text.payCadence}
        options={CADENCES}
        onChange={set('payCadence')}
      />
      <Figure
        label="Employer adds, percent of pay"
        hint="What your employer pays in on top"
        value={text.employerPercent}
        onChange={set('employerPercent')}
      />
    </>
  )
}

/** What the pension pays: the statement's benefit, or the plan's formula and its figures. */
function WhatItPays({ text, set }: { text: PlanText; set: SetField }) {
  return (
    <>
      <h3>What it pays</h3>
      <Figure
        label="Monthly benefit from your statement"
        hint="What your plan says it will pay, used ahead of the formula"
        value={text.statementBenefit}
        onChange={set('statementBenefit')}
      />
      <Figure
        label="Years of service"
        hint="Your service so far, from your plan's statement"
        value={text.serviceYears}
        onChange={set('serviceYears')}
      />
      <Figure
        label="Monthly salary the formula uses"
        hint="Such as your highest average salary"
        value={text.salaryBasis}
        onChange={set('salaryBasis')}
      />
      <Figure
        label="Multiplier, percent per year"
        hint="From your plan, such as 2.5"
        value={text.multiplier}
        onChange={set('multiplier')}
      />
      <Figure
        label="Benefit starts at age"
        hint="Blank uses your retirement age"
        value={text.benefitAge}
        onChange={set('benefitAge')}
      />
      <Figure
        label="Checked on"
        hint="When you last checked these"
        value={text.checkedOn}
        onChange={set('checkedOn')}
        type="date"
      />
    </>
  )
}

/** Every plan figure under one disclosure, folded away until asked for unless told to start open. */
export function PensionDetails({
  text,
  setText,
  startOpen,
}: {
  text: PlanText
  setText: SetText
  /** Open from the start, as when changing a pension's figures kept already. */
  startOpen: boolean
}) {
  const set: SetField = (field) => (value) => setText((current) => ({ ...current, [field]: value }))
  return (
    // Uncontrolled after the first render, so the owner's own open or close stays.
    <details className="more" open={startOpen}>
      <summary>More details (optional)</summary>
      <div className="stack">
        <p className="small muted">
          From your plan&apos;s statement or website. Leave any you do not know blank; Leeway never
          fills them in.
        </p>
        <WhatGoesIn text={text} set={set} setText={setText} />
        <WhatItPays text={text} set={set} />
      </div>
    </details>
  )
}
