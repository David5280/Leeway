// The assumptions a projection rests on, each one the owner's to change:
// their birth year (which only they can give), when they want to stop
// working, returns, inflation, how fast savings are drawn, what they add each
// month and the income they want. Saved to settings.

import { useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { Card, ErrorNote, Setting } from '../../../components/ui'
import { assumptionsText, readAssumptions, type Assumptions, type AssumptionsText } from './fields'

/** Each field: its label, a hint, and the input's width. */
const FIELDS: { key: keyof AssumptionsText; label: string; hint: string }[] = [
  { key: 'birthYear', label: 'Birth year', hint: 'Projections start from your age' },
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
    <Card label="Your assumptions" className="stack">
      <h2>Your assumptions</h2>
      <form className="stack" onSubmit={submit} aria-label="Retirement assumptions">
        {FIELDS.map(({ key, label, hint }) => (
          <Setting key={key} label={label} hint={hint}>
            <input
              className="input num"
              style={{ width: 130 }}
              inputMode="decimal"
              aria-label={label}
              value={text[key]}
              onChange={(e) => {
                setSaved(false)
                setText((current) => ({ ...current, [key]: e.target.value }))
              }}
            />
          </Setting>
        ))}
        {problem && <p className="notice error">{problem}</p>}
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
