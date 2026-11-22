// The assumptions a projection rests on, each one the owner's to change: when
// they want to stop working, returns, inflation, how fast savings are drawn,
// what they add each month and the income they want. Saved to settings. The
// birth year is asked on its own (BirthYearCard) and changed in Settings.

import { Card } from '../../../components/design/Card'
import { useId, useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote, Setting } from '../../../components/ui'
import { assumptionsText, readAssumptions, type Assumptions, type AssumptionsText } from './fields'

/** Each field: its label and a hint. */
const FIELDS: { key: keyof AssumptionsText; label: string; hint: string }[] = [
  { key: 'retirementAge', label: 'Retire at', hint: 'The age you want to stop working' },
  {
    key: 'returnPercent',
    label: 'Yearly return, %',
    hint: 'Before inflation. The range goes 2 points either side',
  },
  { key: 'inflationPercent', label: 'Inflation, %', hint: "Figures stay in today's dollars" },
  {
    key: 'withdrawalPercent',
    label: 'Drawn each year, %',
    hint: 'The share of savings spent each year in retirement',
  },
  {
    key: 'monthlyContribution',
    label: 'Added each month',
    hint: 'Blank uses what Leeway sees going to retirement and investment accounts',
  },
  {
    key: 'targetIncome',
    label: 'Income you want a month',
    hint: 'Blank uses your recent spending',
  },
]

/** One assumption: its input, with the hint read out beside the label. */
function AssumptionField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  const hintId = useId()
  return (
    <Setting label={label} hint={hint} hintId={hintId}>
      <input
        className="input num figure"
        inputMode="decimal"
        aria-label={label}
        aria-describedby={hintId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Setting>
  )
}

export function AssumptionsCard({ assumptions }: { assumptions: Assumptions }) {
  const save = useActionMutation('update_settings')
  const [text, setText] = useState<AssumptionsText>(() => assumptionsText(assumptions))
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    const read = readAssumptions(text)
    setProblem(read.ok ? null : read.error)
    setSaved(false)
    if (read.ok) save.mutate({ retirement: read.value }, { onSuccess: () => setSaved(true) })
  }

  return (
    <Card static="form" label="Your assumptions" className="stack">
      <h2>Your assumptions</h2>
      <form className="stack" onSubmit={submit} aria-label="Retirement assumptions">
        {FIELDS.map(({ key, label, hint }) => (
          <AssumptionField
            key={key}
            label={label}
            hint={hint}
            value={text[key]}
            onChange={(value) => {
              setSaved(false)
              setText((current) => ({ ...current, [key]: value }))
            }}
          />
        ))}
        {problem && (
          <p className="notice error" role="alert">
            {problem}
          </p>
        )}
        <ErrorNote error={save.error} />
        <div className="row wrap">
          <button type="submit" className="btn primary" disabled={save.isPending}>
            Save assumptions
          </button>
          {saved && (
            <span className="small muted" role="status">
              Saved. The projection above uses them.
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}
