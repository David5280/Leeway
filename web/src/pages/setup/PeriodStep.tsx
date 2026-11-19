// Step 3: how budgets reset, the time zone, and when to warn.

import { useState, type FormEvent } from 'react'
import { useUpdateSettings } from '../../api/settings'
import { PeriodEditor, timeZones, type PeriodSetting } from '../../components/PeriodEditor'
import { PercentInput } from '../../components/PercentInput'
import { ErrorNote, Setting } from '../../components/ui'
import { useApp } from '../../lib/app'
import { Frame, Nav } from './Frame'

export function PeriodStep({ onNext }: { onNext: () => void }) {
  const { settings } = useApp()
  const zones = timeZones()
  const [period, setPeriod] = useState<PeriodSetting>(settings.period)
  const [timeZone, setTimeZone] = useState(
    settings.timeZone === 'UTC' ? zones.current : settings.timeZone,
  )
  const [warnAt, setWarnAt] = useState(settings.defaultWarnAtPercent)
  const update = useUpdateSettings()

  function submit(event: FormEvent) {
    event.preventDefault()
    update.mutate({ period, timeZone, defaultWarnAtPercent: warnAt }, { onSuccess: onNext })
  }

  return (
    <Frame step={3}>
      <form className="stack" onSubmit={submit}>
        <h1>How do you budget?</h1>
        <p className="muted">
          Budgets start fresh at the start of each period. Monthly suits most people; pick Every
          paycheck to plan from one payday to the next.
        </p>
        <PeriodEditor value={period} onChange={setPeriod} />
        <Setting label="Time zone" hint="So your days start and end at your midnight">
          <select
            className="input"
            aria-label="Time zone"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
          >
            {zones.all.map((zone) => (
              <option key={zone} value={zone}>
                {zone === zones.current ? `${zone} (from your browser)` : zone}
              </option>
            ))}
          </select>
        </Setting>
        <Setting label="Warn me at" hint="How much of a budget is used before Leeway warns you">
          <div className="row">
            <PercentInput
              label="Warn me at percent"
              value={warnAt}
              onChange={(percent) => percent !== null && setWarnAt(percent)}
            />
            %
          </div>
        </Setting>
        <p className="small muted">You can change all of this later in Settings.</p>
        <ErrorNote error={update.error} />
        <Nav next="Continue" busy={update.isPending} />
      </form>
    </Frame>
  )
}
