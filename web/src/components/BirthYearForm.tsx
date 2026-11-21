// The birth year, asked once and only as a year (never a full date of birth).
// Retirement projections start from the age it gives. The same small form
// asks for it on the Retirement section and changes it in Settings.

import { useState, type FormEvent } from 'react'
import { todayIn } from '../../../server/src/lib/dates'
import { useActionMutation } from '../api/hooks'
import { useApp } from '../lib/app'
import { ErrorNote } from './ui'

/** A four-digit year from 1900 to this year, or null for anything else. */
export function readBirthYear(text: string, thisYear: number): number | null {
  const trimmed = text.trim()
  if (!/^\d{4}$/.test(trimmed)) return null
  const year = Number(trimmed)
  return year >= 1900 && year <= thisYear ? year : null
}

/** The saved year in a small form; `onSaved` runs once a year is kept. */
export function BirthYearForm({ onSaved }: { onSaved?: () => void }) {
  const { settings } = useApp()
  const year = settings.retirement.birthYear
  // A year still to come is refused, counted in the owner's own time zone.
  const thisYear = Number(todayIn(settings.timeZone, new Date()).slice(0, 4))
  const save = useActionMutation('update_settings')
  const [text, setText] = useState(year === null ? '' : String(year))
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    const birthYear = readBirthYear(text, thisYear)
    if (birthYear === null) return setProblem('Enter the year as four digits, like 1986.')
    setProblem(null)
    save.mutate(
      { retirement: { birthYear } },
      {
        onSuccess: () => {
          setSaved(true)
          onSaved?.()
        },
      },
    )
  }

  return (
    <form className="stack-sm" onSubmit={submit} aria-label="Birth year" noValidate>
      <span className="row wrap">
        <input
          className="input num"
          style={{ width: 110 }}
          inputMode="numeric"
          autoComplete="bday-year"
          maxLength={4}
          placeholder="1986"
          aria-label="Year you were born"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSaved(false)
          }}
        />
        <button type="submit" className="btn primary" disabled={save.isPending}>
          Save
        </button>
      </span>
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      {saved && !problem && (
        <span className="small muted" role="status">
          Saved.
        </span>
      )}
      <ErrorNote error={save.error} />
    </form>
  )
}
