// Adding a bank, guarded against linking one that is already connected.
//
// Plaid's free Trial plan counts every login it links toward a fixed limit,
// for good: a removed login does not give its place back, and the same bank
// linked twice takes two. So adding a bank goes:
//
//   1. With banks connected, list them first, each a tap from Reconnect
//      (Plaid's update mode, which uses no new place). Only "Add a different
//      bank" opens Plaid's window for a new one.
//   2. When the window closes, the server checks the bank it names before the
//      public token is exchanged, which is when Plaid counts a new login. A
//      bank already connected comes back as duplicate_bank, and nothing has
//      been counted: keeping the login Leeway has is the first choice.
//   3. A second, separate login at the same bank (a partner's, a business
//      account) is allowed, after a deliberate yes.

import { useState, type ReactNode } from 'react'
import { call, type Connection } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../ui'
import { AlreadyConnected } from './AlreadyConnected'
import { duplicateOf, pickedLink, type DuplicateBankDetails, type PickedLink } from './linking'
import { PlaidWindow } from './PlaidWindow'
import { SameBankFound, SecondLogin } from './SameBankFound'

/** Where adding a bank is up to. */
type Step =
  /** Nothing open; `note` says how the last try ended, when that needs saying. */
  | { at: 'idle'; note?: string }
  /** The banks already connected, shown before Plaid's window opens. */
  | { at: 'checking' }
  /** Plaid's window is open for a new bank. */
  | { at: 'window'; token: string }
  /** The bank picked is already connected; nothing was counted. */
  | { at: 'found'; link: PickedLink; duplicate: DuplicateBankDetails }
  /** Asking for a deliberate yes to a second login at that bank. */
  | { at: 'confirming'; link: PickedLink; duplicate: DuplicateBankDetails }

export function AddBank({
  connections,
  className,
  beside,
  onDone,
}: {
  /** The banks already connected. */
  connections: Connection[]
  /** The look of the button that starts it; the first bank's is primary by default. */
  className?: string
  /** Other buttons to show beside it while nothing is open, like Sync now. */
  beside?: ReactNode
  onDone?: () => void
}) {
  const [step, setStep] = useState<Step>({ at: 'idle' })
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const link = useActionMutation('link_bank')
  const hasBanks = connections.length > 0

  /** Asks the server for a new-bank token, which opens Plaid's window. */
  async function openWindow() {
    setError(null)
    setStarting(true)
    try {
      const { linkToken } = await call('create_link_token', {})
      setStep({ at: 'window', token: linkToken })
    } catch (caught) {
      setError(caught)
      setStep({ at: 'idle' })
    } finally {
      setStarting(false)
    }
  }

  /** Saves the bank picked, unless the server finds it is already connected. */
  async function save(picked: PickedLink, allowSecondLogin = false) {
    setError(null)
    try {
      const result = await link.mutateAsync({ ...picked, allowSecondLogin })
      setStep({ at: 'idle', note: flaggedNote(result) })
      onDone?.()
    } catch (caught) {
      const duplicate = duplicateOf(caught)
      if (duplicate) setStep({ at: 'found', link: picked, duplicate })
      else {
        setError(caught)
        // A failed second login stays on its question, so the owner can try again or back out.
        if (!allowSecondLogin) setStep({ at: 'idle' })
      }
    }
  }

  /** The owner kept the login Leeway has: the bank's public token is simply never used. */
  function keep(duplicate: DuplicateBankDetails) {
    setStep({
      at: 'idle',
      note: `Kept your ${duplicate.institutionName} login. Nothing new was added.`,
    })
  }

  function reconnected() {
    setStep({ at: 'idle' })
    onDone?.()
  }

  const busy = starting || link.isPending || step.at === 'window'
  const startLabel = hasBanks ? 'Connect another bank' : 'Connect a bank'
  return (
    <div className="stack-sm">
      {(step.at === 'idle' || step.at === 'window') && (
        <div className="row wrap">
          <button
            type="button"
            className={className ?? (hasBanks ? 'btn' : 'btn primary')}
            disabled={busy}
            onClick={() => (hasBanks ? setStep({ at: 'checking' }) : void openWindow())}
          >
            {link.isPending ? 'Pulling in your accounts' : startLabel}
          </button>
          {beside}
        </div>
      )}
      {step.at === 'idle' && step.note && (
        <p className="small muted" role="status">
          {step.note}
        </p>
      )}
      {step.at === 'checking' && (
        <AlreadyConnected
          connections={connections}
          starting={starting}
          onAddAnother={() => void openWindow()}
          onReconnected={reconnected}
          onCancel={() => setStep({ at: 'idle' })}
        />
      )}
      {step.at === 'window' && (
        <PlaidWindow
          token={step.token}
          onSuccess={(publicToken, metadata) => {
            setStep({ at: 'idle' })
            void save(pickedLink(publicToken, metadata))
          }}
          onExit={() => setStep({ at: 'idle' })}
        />
      )}
      {step.at === 'found' && (
        <SameBankFound
          duplicate={step.duplicate}
          onKeep={() => keep(step.duplicate)}
          onReconnected={reconnected}
          onDifferentLogin={() => setStep({ ...step, at: 'confirming' })}
        />
      )}
      {step.at === 'confirming' && (
        <SecondLogin
          institutionName={step.duplicate.institutionName}
          saving={link.isPending}
          onConfirm={() => void save(step.link, true)}
          onBack={() => setStep({ ...step, at: 'found' })}
        />
      )}
      <ErrorNote error={error} />
    </div>
  )
}

/**
 * When the window did not say which bank it was, a duplicate shows only after
 * Plaid has counted the new login. The server keeps it (removing it would not
 * give its place back), and the owner hears so, to remove one if they wish.
 */
function flaggedNote(result: {
  possibleDuplicateOf: string | null
  institutionName: string | null
}): string | undefined {
  if (!result.possibleDuplicateOf) return undefined
  const logins = result.institutionName
    ? `two ${result.institutionName} logins`
    : 'two logins at the same bank'
  return `Added. You now have ${logins}. If they are the same login, you can remove one.`
}
