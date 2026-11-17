import type { Settings } from '../api/client'
import { Segmented, Setting } from './ui'

export type PeriodSetting = Settings['period']

const KINDS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'paycheck', label: 'Every paycheck' },
  { value: 'weekly', label: 'Weekly' },
] as const

const FREQUENCIES = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Once a month' },
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

function dayNumber(text: string, max: number): number {
  const value = Math.round(Number(text))
  return Number.isFinite(value) ? Math.min(max, Math.max(1, value)) : 1
}

/** Picks how budgets are counted: by calendar month, by paycheck, or by week. */
export function PeriodEditor({
  value,
  onChange,
}: {
  value: PeriodSetting
  onChange: (period: PeriodSetting) => void
}) {
  return (
    <div className="stack-sm">
      <Segmented
        label="Budget period"
        value={value.kind}
        options={KINDS}
        onChange={(kind) => kind !== value.kind && onChange(defaultPeriod(kind, localToday()))}
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
        <>
          <Setting label="Paid">
            <select
              className="input"
              aria-label="How often you are paid"
              value={value.frequency}
              onChange={(e) =>
                onChange({ ...value, frequency: e.target.value as typeof value.frequency })
              }
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Setting>
          {value.frequency === 'semimonthly' ? (
            <Setting label="Paydays" hint="Days of the month">
              <div className="row">
                {[0, 1].map((i) => (
                  <input
                    key={i}
                    className="input num"
                    style={{ width: 72 }}
                    type="number"
                    min={1}
                    max={31}
                    aria-label={i === 0 ? 'First payday' : 'Second payday'}
                    value={value.semimonthlyDays?.[i] ?? (i === 0 ? 1 : 15)}
                    onChange={(e) => {
                      const days = [...(value.semimonthlyDays ?? [1, 15])] as [number, number]
                      days[i] = dayNumber(e.target.value, 31)
                      onChange({ ...value, semimonthlyDays: days })
                    }}
                  />
                ))}
              </div>
            </Setting>
          ) : (
            <Setting label="A recent payday" hint="Any one works; Leeway counts from it">
              <input
                className="input num"
                type="date"
                aria-label="A recent payday"
                value={value.anchorDate}
                onChange={(e) =>
                  e.target.value && onChange({ ...value, anchorDate: e.target.value })
                }
              />
            </Setting>
          )}
        </>
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
