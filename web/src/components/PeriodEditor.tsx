// Picking how budgets are counted: monthly, per paycheck or weekly. With
// paychecks found, Every paycheck starts on their schedule (PaycheckFields).

import type { Settings } from '../api/client'
import { PaycheckSchedule, type PaycheckPeriod } from './PaycheckFields'
import { Segmented, Setting } from './ui'

export type PeriodSetting = Settings['period']

const KINDS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'paycheck', label: 'Every paycheck' },
  { value: 'weekly', label: 'Weekly' },
] as const

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A sensible starting point for each kind, so switching never leaves a half-filled period. */
export function defaultPeriod(kind: PeriodSetting['kind'], today: string): PeriodSetting {
  if (kind === 'monthly') return { kind, startDay: 1 }
  if (kind === 'weekly') return { kind, weekStartsOn: 1 }
  return { kind, frequency: 'biweekly', anchorDate: today, semimonthlyDays: [1, 15] }
}

function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Picks how budgets are counted: by calendar month, by paycheck, or by week.
 * `found` is the paycheck period the paychecks show (get_pay), when they show one.
 */
export function PeriodEditor({
  value,
  onChange,
  found = null,
}: {
  value: PeriodSetting
  onChange: (period: PeriodSetting) => void
  found?: PaycheckPeriod | null
}) {
  // Switching to Every paycheck starts on the found schedule, so there is nothing to ask.
  const startOf = (kind: PeriodSetting['kind']) =>
    kind === 'paycheck' && found ? found : defaultPeriod(kind, localToday())
  return (
    <div className="stack-sm">
      <Segmented
        label="Budget period"
        value={value.kind}
        options={KINDS}
        onChange={(kind) => kind !== value.kind && onChange(startOf(kind))}
      />
      {value.kind === 'monthly' && (
        <Setting label="Month starts on day" hint="Handy if rent or pay lands mid-month">
          <select
            className="input"
            aria-label="Month starts on day"
            value={value.startDay}
            onChange={(e) => onChange({ ...value, startDay: Number(e.target.value) })}
          >
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </Setting>
      )}
      {value.kind === 'weekly' && (
        <Setting label="Week starts on">
          <select
            className="input"
            aria-label="Week starts on"
            value={value.weekStartsOn}
            onChange={(e) => onChange({ ...value, weekStartsOn: Number(e.target.value) })}
          >
            {WEEKDAYS.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </select>
        </Setting>
      )}
      {value.kind === 'paycheck' && (
        <PaycheckSchedule value={value} found={found} onChange={onChange} />
      )}
    </div>
  )
}

/** Every time zone the browser knows, with the browser's own first. */
export function timeZones(): { current: string; all: string[] } {
  const current = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  const all = supported ? supported('timeZone') : [current, 'UTC']
  return { current, all: all.includes(current) ? all : [current, ...all] }
}
