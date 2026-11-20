// Notifications: which alerts reach the inbox and the owner's devices, their
// thresholds, quiet hours, and push on this device. All of it is the
// owner's alone; an assistant can neither see nor change it.

import { useEffect, useState } from 'react'
import { useAction, useActionMutation } from '../../api/hooks'
import { ErrorNote, Loading, Setting, Switch } from '../../components/ui'
import type { NotificationKind } from '../../../../server/src/domain/notifications/settings'
import { useApp } from '../../lib/app'
import { browserEnvironment, currentEndpoint, pushSupport, type PushSupport } from '../../lib/push'
import { hourLabel } from './email/emailText'
import { LargeChargeField } from './notifications/LargeChargeField'
import {
  BILL_DAYS,
  billDaysLabel,
  BUDGET_PERCENTS,
  KIND_TEXT,
  withPatch,
  type NotificationChoices,
  type NotificationsView,
} from './notifications/notificationText'
import { PushDevice } from './notifications/PushDevice'
import { Section } from './Section'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/** Whether push can work here, and this browser's push address once known. */
function useThisDevice() {
  const [support] = useState<PushSupport>(() => pushSupport(browserEnvironment()))
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [checked, setChecked] = useState(support !== 'ready')
  useEffect(() => {
    if (support !== 'ready') return
    currentEndpoint()
      .then(setEndpoint, () => setEndpoint(null))
      .finally(() => setChecked(true))
  }, [support])
  return { support, endpoint, setEndpoint, checked }
}

export function NotificationsSection() {
  const device = useThisDevice()
  const view = useAction(
    'get_notification_settings',
    device.endpoint ? { endpoint: device.endpoint } : {},
    {
      enabled: device.checked,
    },
  )
  return (
    <Section id="notifications" title="Notifications">
      {view.data && (
        <>
          <PushDevice
            view={view.data}
            support={device.support}
            endpoint={device.endpoint}
            onEndpoint={device.setEndpoint}
          />
          <Choices view={view.data} />
        </>
      )}
      {!view.data && !view.error && <Loading label="Loading notification settings" />}
      <ErrorNote error={view.error} />
    </Section>
  )
}

function Choices({ view }: { view: NotificationsView }) {
  const update = useActionMutation('update_notification_settings')
  // While a change saves, show it already, as the other settings do.
  const shown = update.isPending ? withPatch(view.settings, update.variables) : view.settings
  return (
    <>
      <h4 className="setting-group-title">What to tell you about</h4>
      {view.available.map((kind) => (
        <div key={kind} className="stack-sm">
          <Setting label={KIND_TEXT[kind].label} hint={KIND_TEXT[kind].hint}>
            <Switch
              checked={shown.kinds[kind]}
              label={`Notify me: ${KIND_TEXT[kind].label}`}
              onChange={(on) => update.mutate({ kinds: { [kind]: on } })}
            />
          </Setting>
          {shown.kinds[kind] && (
            <Threshold kind={kind} shown={shown} save={(patch) => update.mutate(patch)} />
          )}
        </div>
      ))}
      <QuietHours shown={shown} save={(patch) => update.mutate(patch)} />
      <ErrorNote error={update.error} />
    </>
  )
}

type Save = (patch: Parameters<typeof withPatch>[1]) => void

/** The threshold under a kind that has one. */
function Threshold({
  kind,
  shown,
  save,
}: {
  kind: NotificationKind
  shown: NotificationChoices
  save: Save
}) {
  if (kind === 'over_budget') {
    return (
      <label className="threshold">
        At
        <select
          className="input"
          aria-label="Share of a budget"
          value={shown.overBudgetPercent}
          onChange={(e) => save({ overBudgetPercent: Number(e.target.value) })}
        >
          {BUDGET_PERCENTS.map((percent) => (
            <option key={percent} value={percent}>
              {percent}%
            </option>
          ))}
        </select>
        of the budget
      </label>
    )
  }
  if (kind === 'bill_due') {
    return (
      <label className="threshold">
        <select
          className="input"
          aria-label="When a bill is due"
          value={shown.billDueDays}
          onChange={(e) => save({ billDueDays: Number(e.target.value) })}
        >
          {BILL_DAYS.map((days) => (
            <option key={days} value={days}>
              {billDaysLabel(days)}
            </option>
          ))}
        </select>
        its due date
      </label>
    )
  }
  if (kind === 'large_transaction') {
    return (
      <LargeChargeField
        key={shown.largeTransactionCents}
        cents={shown.largeTransactionCents}
        save={(cents) => save({ largeTransactionCents: cents })}
      />
    )
  }
  return null
}

function QuietHours({ shown, save }: { shown: NotificationChoices; save: Save }) {
  const { settings } = useApp()
  const quiet = shown.quietHours
  return (
    <>
      <h4 className="setting-group-title">Quiet hours</h4>
      <Setting
        label="Hold pushes overnight"
        hint={`In your time zone, ${settings.timeZone}. The inbox still fills; pushes wait until the end.`}
      >
        <Switch
          checked={quiet.on}
          label="Quiet hours"
          onChange={(on) => save({ quietHours: { on } })}
        />
      </Setting>
      {quiet.on && (
        <div className="row setting-lists threshold">
          <select
            className="input"
            aria-label="Quiet from"
            value={quiet.start}
            onChange={(e) => save({ quietHours: { start: Number(e.target.value) } })}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                From {hourLabel(hour, settings.locale)}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Quiet until"
            value={quiet.end}
            onChange={(e) => save({ quietHours: { end: Number(e.target.value) } })}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                Until {hourLabel(hour, settings.locale)}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  )
}
