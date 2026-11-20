// Push on this device: turn it on or off, send a test, or read in one line
// why it can't be turned on here (an iPhone not yet on the Home Screen, a
// browser without push, or notifications blocked).

import { useState } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote, Setting } from '../../../components/ui'
import { subscribe, unsubscribe, type PushSupport } from '../../../lib/push'
import { devicesLine, refusedLine, supportLine, type NotificationsView } from './notificationText'

export function PushDevice({
  view,
  support,
  endpoint,
  onEndpoint,
}: {
  view: NotificationsView
  support: PushSupport
  /** This browser's push address, when push is on here. */
  endpoint: string | null
  onEndpoint: (endpoint: string | null) => void
}) {
  const on = useActionMutation('subscribe_push')
  const off = useActionMutation('unsubscribe_push')
  const [declined, setDeclined] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const busy = on.isPending || off.isPending
  const line = supportLine(declined ? 'denied' : support)

  async function turnOn() {
    setFailure(null)
    try {
      const subscription = await subscribe(view.push.publicKey)
      if (!subscription) return setDeclined(true)
      try {
        await on.mutateAsync(subscription)
      } catch (error) {
        // Refused: leave the browser no subscription the server doesn't hold.
        await unsubscribe().catch(() => null)
        return setFailure(refusedLine(error))
      }
      onEndpoint(subscription.endpoint)
    } catch (error) {
      setFailure(error)
    }
  }

  async function turnOff() {
    setFailure(null)
    try {
      const gone = await unsubscribe()
      if (gone) await off.mutateAsync({ endpoint: gone })
      onEndpoint(null)
    } catch (error) {
      setFailure(error)
    }
  }

  return (
    <div className="stack-sm">
      <Setting
        label="Push on this device"
        hint={devicesLine(view.push.devices, view.push.thisDevice)}
      >
        {view.push.thisDevice ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void turnOff()}>
            Turn off
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy || line !== null}
            onClick={() => void turnOn()}
          >
            Turn on
          </button>
        )}
      </Setting>
      {line && <p className="small muted">{line}</p>}
      {view.push.thisDevice && endpoint && <TestPush endpoint={endpoint} />}
      <ErrorNote error={failure} />
    </div>
  )
}

function TestPush({ endpoint }: { endpoint: string }) {
  const test = useActionMutation('send_test_push')
  return (
    <div className="stack-sm">
      <div>
        <button
          type="button"
          className="btn ghost"
          disabled={test.isPending}
          onClick={() => test.mutate({ endpoint })}
        >
          {test.isPending ? 'Sending' : 'Send a test notification'}
        </button>
      </div>
      {test.isSuccess && <p className="small good">Sent. It should show on this device shortly.</p>}
      <ErrorNote error={test.error} />
    </div>
  )
}
