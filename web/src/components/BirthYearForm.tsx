// The birth year, asked once and only as a year (never a full date of birth).
// Retirement projections start from the age it gives. The same small form
// asks for it on the Retirement section, and changes or removes it in Settings.

import { useState, type FormEvent } from 'react'
import { birthYearProblem } from '../../../server/src/domain/retirement/birthYear'
import { useUpdateSettings } from '../api/settings'
import { useApp } from '../lib/app'
import { todayIn, type IsoDate } from '../lib/dates'
import { ErrorNote } from './ui'

/** A typed birth year: the year, or the sentence that says what to fix. */
export type BirthYearRead = { ok: true; year: number } | { ok: false; error: string }

const NOT_FOUR_DIGITS = 'Enter the year as four digits, like 1986.'

/**
 * Reads a typed birth year on `today`: four digits, in the range the server
 * takes (none still to come, none more than 110 years back).
 */
export function readBirthYear(text: string, today: IsoDate): BirthYearRead {
  const trimmed = text.trim()
  if (!/^\d{4}$/.test(trimmed)) return { ok: false, error: NOT_FOUR_DIGITS }
  const year = Number(trimmed)
  const problem = birthYearProblem(year, today)
  return problem === null ? { ok: true, year } : { ok: false, error: problem }
}

const textOf = (year: number | null) => (year === null ? '' : String(year))

/**
 * The saved year in a small form, with a way to remove it once given.
 * `showSaveError` is off where the screen already shows every settings
 * save's error, as Settings does at its top.
 */
export function BirthYearForm({ showSaveError = true }: { showSaveError?: boolean }) {
  const { settings } = useApp()
  const year = settings.retirement.birthYear
  const save = useUpdateSettings()
  const [text, setText] = useState(textOf(year))
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<'Saved.' | 'Removed.' | null>(null)

  // The year the field stands for. When the saved year moves away from it
  // (changed in another tab or by an assistant, or put back after a failed
  // save), the field follows, adjusted while rendering rather than in an effect.
  const [shownYear, setShownYear] = useState(year)
  if (shownYear !== year) {
    setShownYear(year)
    setText(textOf(year))
    setProblem(null)
  }

  /** Saves the year given, or null to remove it, and says so once kept. */
  function keep(birthYear: number | null) {
    // Set first, so this form's own save, previewed at once, is not taken
    // for a change made elsewhere.
    setShownYear(birthYear)
    setText(textOf(birthYear))
    setProblem(null)
    const note = birthYear === null ? 'Removed.' : 'Saved.'
    save.mutate({ retirement: { birthYear } }, { onSuccess: () => setDone(note) })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // A year still to come is refused, counted in the owner's own time zone.
    const read = readBirthYear(text, todayIn(settings.timeZone, new Date()))
    if (!read.ok) return setProblem(read.error)
    keep(read.year)
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
            setDone(null)
          }}
        />
        <button type="submit" className="btn primary" disabled={save.isPending}>
          Save
        </button>
        {year !== null && (
          <button
            type="button"
            className="btn"
            disabled={save.isPending}
            onClick={() => keep(null)}
          >
            Remove
          </button>
        )}
      </span>
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      {done && !problem && (
        <span className="small muted" role="status">
          {done}
        </span>
      )}
      {showSaveError && <ErrorNote error={save.error} />}
    </form>
  )
}
