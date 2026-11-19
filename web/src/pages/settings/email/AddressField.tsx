// Where the weekly email goes: the sign-in email unless the owner names another.

import { useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote } from '../../../components/ui'
import { addressHint } from './emailText'

export function AddressField({
  sendTo,
  ownerEmail,
}: {
  sendTo: string | null
  ownerEmail: string | null
}) {
  const save = useActionMutation('set_weekly_email')
  // Null shows what is saved; typing starts a draft until it is saved.
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? sendTo ?? ''
  const changed = value.trim().toLowerCase() !== (sendTo ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ sendTo: value }, { onSuccess: () => setDraft(null) })
  }

  return (
    <div className="stack-sm">
      {/* The server checks the address and says what is wrong, in the same words everywhere. */}
      <form className="row wrap" onSubmit={submit} noValidate aria-label="Email address">
        <input
          className="input"
          style={{ width: 280 }}
          type="email"
          autoComplete="email"
          aria-label="Send to"
          placeholder={ownerEmail ?? 'you@example.com'}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!changed || save.isPending}>
          Save address
        </button>
      </form>
      <span className="small muted">{addressHint(sendTo, ownerEmail)}</span>
      <ErrorNote error={save.error} />
    </div>
  )
}
