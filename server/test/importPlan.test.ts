// Which rows of an import get added: duplicates, repeats and the date cutoff.

import { describe, expect, it } from 'vitest'
import {
  dateSpan,
  normalizeDescription,
  planImport,
  transactionKey,
  type ImportOptions,
  type ImportRow,
} from '../src/domain/importPlan.js'

const row = (date: string, name: string, amountCents: number, category: string | null = null) =>
  ({ date, name, amountCents, category }) satisfies ImportRow

const defaults: ImportOptions = { keepRepeats: false, skipFrom: null }

describe('normalizing descriptions', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalizeDescription('AMAZON.COM*Mktp  US')).toBe('amazon com mktp us')
    expect(normalizeDescription('  amazon com mktp us ')).toBe('amazon com mktp us')
  })

  it('folds accents and keeps letters of any script and digits', () => {
    expect(normalizeDescription('Café Olé #12')).toBe('cafe ole 12')
    expect(normalizeDescription('東京 Store')).toBe('東京 store')
  })

  it('leaves nothing of a description that is only punctuation', () => {
    expect(normalizeDescription('*** --- ***')).toBe('')
  })
})

describe('transaction keys', () => {
  it('match when only the description formatting differs', () => {
    expect(transactionKey(row('2026-01-02', 'Shell OIL #123', 4000))).toBe(
      transactionKey(row('2026-01-02', 'shell oil 123', 4000)),
    )
  })

  it('differ by day, amount, sign or words', () => {
    const base = transactionKey(row('2026-01-02', 'Shell', 4000))
    expect(transactionKey(row('2026-01-03', 'Shell', 4000))).not.toBe(base)
    expect(transactionKey(row('2026-01-02', 'Shell', 4001))).not.toBe(base)
    expect(transactionKey(row('2026-01-02', 'Shell', -4000))).not.toBe(base)
    expect(transactionKey(row('2026-01-02', 'Shell gas', 4000))).not.toBe(base)
  })
})

describe('planning an import', () => {
  it('adds every row of a fresh file, in order', () => {
    const rows = [row('2026-01-02', 'A', 100), row('2026-01-01', 'B', 200)]
    expect(planImport(rows, [], defaults)).toEqual({
      add: rows,
      alreadyThere: 0,
      repeatsInFile: 0,
      skippedByDate: 0,
    })
  })

  it('skips rows the account already has', () => {
    const rows = [row('2026-01-02', 'Coffee shop', 500), row('2026-01-02', 'Lunch', 1200)]
    const plan = planImport(
      rows,
      [{ date: '2026-01-02', name: 'COFFEE-SHOP', amountCents: 500 }],
      defaults,
    )
    expect(plan.add).toEqual([rows[1]])
    expect(plan.alreadyThere).toBe(1)
  })

  it('adds nothing when the same file is imported again', () => {
    const rows = [row('2026-01-02', 'A', 100), row('2026-01-03', 'B', 200)]
    const first = planImport(rows, [], defaults)
    const again = planImport(rows, first.add, defaults)
    expect(again.add).toEqual([])
    expect(again.alreadyThere).toBe(2)
  })

  it('skips exact repeats within the file by default', () => {
    const rows = [row('2026-01-02', 'Coffee', 500), row('2026-01-02', 'coffee', 500)]
    const plan = planImport(rows, [], defaults)
    expect(plan.add).toEqual([rows[0]])
    expect(plan.repeatsInFile).toBe(1)
  })

  it('keeps repeats when asked, matching saved ones one to one', () => {
    const coffee = row('2026-01-02', 'Coffee', 500)
    const options = { ...defaults, keepRepeats: true }
    expect(planImport([coffee, coffee], [], options).add).toEqual([coffee, coffee])
    // Two in the file and one already saved: one more is added.
    const plan = planImport([coffee, coffee], [coffee], options)
    expect(plan).toMatchObject({ add: [coffee], alreadyThere: 1, repeatsInFile: 0 })
    // Re-importing after both were saved adds nothing.
    expect(planImport([coffee, coffee], [coffee, coffee], options).add).toEqual([])
  })

  it('treats a repeat of a row already saved as already there, not new', () => {
    const coffee = row('2026-01-02', 'Coffee', 500)
    const plan = planImport([coffee, coffee], [coffee], defaults)
    expect(plan).toMatchObject({ add: [], alreadyThere: 1, repeatsInFile: 1 })
  })

  it('skips rows on or after the cutoff day before checking duplicates', () => {
    const rows = [
      row('2026-01-01', 'Old', 100),
      row('2026-02-01', 'On the day', 200),
      row('2026-03-01', 'After', 300),
    ]
    const plan = planImport(rows, [], { ...defaults, skipFrom: '2026-02-01' })
    expect(plan.add).toEqual([rows[0]])
    expect(plan.skippedByDate).toBe(2)
  })
})

describe('date spans', () => {
  it('finds the first and last day in any order', () => {
    expect(
      dateSpan([{ date: '2026-03-01' }, { date: '2025-12-31' }, { date: '2026-01-15' }]),
    ).toEqual({ first: '2025-12-31', last: '2026-03-01' })
  })

  it('is null for no rows', () => {
    expect(dateSpan([])).toBeNull()
  })
})
