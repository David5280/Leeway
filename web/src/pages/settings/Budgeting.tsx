// The budget period, pending transactions, and when warnings show.

import { PeriodEditor } from '../../components/PeriodEditor'
import { Segmented, Setting, Switch } from '../../components/ui'
import { useApp } from '../../lib/app'
import { Section, useSave } from './Section'

const PACE: { value: string; label: string }[] = [
  { value: '20', label: 'Relaxed' },
  { value: '10', label: 'Normal' },
  { value: '5', label: 'Strict' },
]

const WARN_AT = [50, 60, 70, 75, 80, 85, 90, 95, 100]

export function BudgetingSection() {
  const { settings } = useApp()
  const save = useSave()
  // An agent or an import can set any number, so a value that is not a preset
  // is offered as its own choice rather than shown as the wrong one.
  const pace = String(settings.paceTolerancePercent)
  const paceOptions = PACE.some((p) => p.value === pace)
    ? PACE
    : [...PACE, { value: pace, label: `Custom (${pace}%)` }]
  const warnAt = settings.defaultWarnAtPercent
  const warnAtOptions = WARN_AT.includes(warnAt)
    ? WARN_AT
    : [...WARN_AT, warnAt].sort((a, b) => a - b)
  return (
    <Section id="budgeting" title="Period and warnings">
      <PeriodEditor value={settings.period} onChange={(period) => save.settings({ period })} />
      <Setting label="Count pending transactions" hint="Money is spent even before it posts">
        <Switch
          label="Count pending transactions"
          checked={settings.includePending}
          onChange={(includePending) => save.settings({ includePending })}
        />
      </Setting>
      <Setting label="Warn at" hint="Each category can override this">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Warn at"
          value={settings.defaultWarnAtPercent}
          onChange={(e) => save.settings({ defaultWarnAtPercent: Number(e.target.value) })}
        >
          {warnAtOptions.map((p) => (
            <option key={p} value={p}>
              {p}% of a budget
            </option>
          ))}
        </select>
      </Setting>
      <Setting
        label="Pace sensitivity"
        hint={`How far ahead of steady spending counts as ahead: ${pace}% of the budget`}
      >
        <Segmented
          label="Pace sensitivity"
          value={pace}
          options={paceOptions}
          onChange={(value) => save.settings({ paceTolerancePercent: Number(value) })}
        />
      </Setting>
    </Section>
  )
}
