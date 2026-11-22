// Choosing what the emergency fund counts: every savings account, only the
// accounts the owner picks, or (for a goal that was counted by hand) what is
// added by hand. Each account says why it is left out when it is: hidden, or
// followed by another goal, which keeps it out so no dollar counts twice.

import { useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { Money } from '../../../components/design/Money'
import { ErrorNote } from '../../../components/ui'
import type { EmergencyView, FundChoice } from '../../../lib/emergencyText'

/** What the fund counts: every savings account, the picked accounts, or a count kept by hand. */
type Mode = 'savings' | 'picked' | 'hand'

/** The mode the form opens on, from what the fund counts now. */
function modeOf(view: EmergencyView): Mode {
  if (view.counts === 'hand') return 'hand'
  return view.counts === 'savings' ? 'savings' : 'picked'
}

/** The accounts the owner marked (or the one the goal links), which picking starts from. */
function markedOf(view: EmergencyView): string[] {
  return view.accounts.filter((a) => a.marked).map((a) => a.id)
}

/** Whether two lists hold the same ids, in any order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

/** Why a marked account counts nothing, in a word or two. */
const LEFT_OUT_NOTES = {
  hidden: 'Hidden',
  not_shared: 'No longer shared',
  unavailable: 'No balance yet',
} as const

/** A few words on an account that cannot be picked, or that counts nothing though picked. */
function noteOf(account: FundChoice): string | null {
  if (account.leftOut === null) return null
  if (account.leftOut === 'other_goal') return `${account.otherGoal} follows it`
  return LEFT_OUT_NOTES[account.leftOut]
}

/** One choice of what the fund counts, as a radio line. */
function ModeChoice({
  mode,
  value,
  label,
  onPick,
}: {
  mode: Mode
  value: Mode
  label: string
  onPick: (mode: Mode) => void
}) {
  return (
    <label className="check-row">
      <input
        type="radio"
        name="fund-counts"
        checked={mode === value}
        onChange={() => onPick(value)}
      />
      <span className="check-words">{label}</span>
    </label>
  )
}

export function FundAccountsForm({ view, onDone }: { view: EmergencyView; onDone: () => void }) {
  const change = useActionMutation('change_emergency_fund')
  // Starts from what is counted now, so an untouched save changes nothing.
  const [mode, setMode] = useState<Mode>(() => modeOf(view))
  const [ticked, setTicked] = useState<string[]>(() => markedOf(view))

  function toggle(id: string) {
    setTicked((now) => (now.includes(id) ? now.filter((one) => one !== id) : [...now, id]))
    // Ticking an account is picking accounts.
    setMode('picked')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const untouched =
      mode === modeOf(view) && (mode !== 'picked' || sameIds(ticked, markedOf(view)))
    // Nothing changed, or still counted by hand: nothing to save, so it only closes.
    if (untouched || mode === 'hand') return onDone()
    // No accounts given counts every savings account again.
    change.mutate({ accountIds: mode === 'picked' ? ticked : [] }, { onSuccess: onDone })
  }

  if (view.accounts.length === 0 && view.counts !== 'hand') {
    return <p className="small muted">Link or add a savings account to hold the fund.</p>
  }
  const pickedNone = mode === 'picked' && ticked.length === 0
  return (
    <form className="stack-sm" onSubmit={submit} aria-label="Accounts for the emergency fund">
      <div role="radiogroup" aria-label="What the fund counts">
        <ModeChoice mode={mode} value="savings" label="Every savings account" onPick={setMode} />
        <ModeChoice mode={mode} value="picked" label="Only the accounts I pick" onPick={setMode} />
        {view.counts === 'hand' && (
          <ModeChoice mode={mode} value="hand" label="What I add by hand" onPick={setMode} />
        )}
      </div>
      {view.accounts.map((account) => {
        const note = noteOf(account)
        // An account another goal follows can't be picked: a dollar counts toward one goal.
        const followed = account.leftOut === 'other_goal'
        return (
          <label key={account.id} className="check-row">
            <input
              type="checkbox"
              checked={mode === 'picked' && ticked.includes(account.id)}
              disabled={followed}
              onChange={() => toggle(account.id)}
            />
            <span className="row-between wrap check-words">
              <span>
                {account.name}
                {note && <span className="small muted"> ({note})</span>}
              </span>
              {account.balanceCents !== null && (
                <Money cents={account.balanceCents} className="small muted" />
              )}
            </span>
          </label>
        )
      })}
      {pickedNone && <span className="small muted">Tick at least one account to save.</span>}
      <ErrorNote error={change.error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={change.isPending || pickedNone}>
          Save
        </button>
      </div>
    </form>
  )
}
