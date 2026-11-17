// Step 2: how budgets reset, the time zone, and when to warn.

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
    <Frame step={2}>
      <form className="stack" onSubmit={submit}>
        <h1>How do you budget?</h1>
        <PeriodEditor value={period} onChange={setPeriod} />
        <Setting label="Time zone">
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
        <Setting label="Warn me at" hint="Share of a budget used">
          <div className="row">
            <PercentInput
              label="Warn me at percent"
              value={warnAt}
              onChange={(percent) => percent !== null && setWarnAt(percent)}
            />
            %
          </div>
        </Setting>
        <p className="small muted">You can change all of this later in Customize.</p>
        <ErrorNote error={update.error} />
        <Nav next="Continue" busy={update.isPending} />
      </form>
    </Frame>
  )
}
