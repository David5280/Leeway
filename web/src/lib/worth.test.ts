// How net worth moved over a range, and the words and level the card and chart use.

import { describe, expect, it } from 'vitest'
import type { NetWorth } from '../api/client'
import { worthPoint } from '../test/worth'
import { changeWords, historyNote, rangesWithMore, startReference, worthChange } from './worth'

const worth = (netWorthCents: number, history: NetWorth['history']): NetWorth => ({
  assetsCents: Math.max(0, netWorthCents),
  liabilitiesCents: Math.max(0, -netWorthCents),
  netWorthCents,
  history,
  historyStart: history[0]?.date ?? null,
  estimatedBefore: null,
})

describe('worthChange', () => {
  it('measures today against the first day in the range', () => {
    const change = worthChange(
      worth(700000, [worthPoint('2026-01-01', 500000), worthPoint('2026-06-01', 900000)]),
    )
    expect(change).toEqual({ fromDate: '2026-01-01', fromCents: 500000, changeCents: 200000 })
    expect(changeWords(change!)).toEqual({ word: 'Up', falling: false })
    expect(startReference(change)).toEqual({
      cents: 500000,
      label: 'Where you started',
      at: 'end',
    })
  })

  it('has nothing to compare with no history or a single day', () => {
    expect(worthChange(worth(100, []))).toBeNull()
    expect(worthChange(worth(100, [worthPoint('2026-11-17', 100)]))).toBeNull()
    expect(startReference(null)).toBeUndefined()
  })

  it('reads a fall as down, even while owing more than is owned', () => {
    const change = worthChange(
      worth(-900000, [
        worthPoint('2026-01-01', -200000, 400000),
        worthPoint('2026-11-17', -900000),
      ]),
    )
    expect(change!.changeCents).toBe(-700000)
    expect(changeWords(change!)).toEqual({ word: 'Down', falling: true })
  })

  it('counts holding level as fine, and keeps huge amounts exact', () => {
    const level = worthChange(worth(5, [worthPoint('2026-01-01', 5), worthPoint('2026-11-17', 5)]))
    expect(changeWords(level!)).toEqual({ word: 'Up', falling: false })
    const huge = worthChange(
      worth(9e14, [worthPoint('2026-01-01', 1e14), worthPoint('2026-11-17', 9e14)]),
    )
    expect(huge!.changeCents).toBe(8e14)
  })
})

describe('rangesWithMore', () => {
  // Today is Nov 17, 2026: 90 days back is Aug 19, a year back is Nov 17, 2025.
  const startOf = (days: number) =>
    ({ 90: '2026-08-19', 365: '2025-11-17', 1825: '2021-11-18' })[days]!
  const ranges = [90, 365, 1825]

  it('offers a longer range only while history reaches past the shorter one', () => {
    expect(rangesWithMore(ranges, '2026-03-14', startOf)).toEqual([true, true, false])
    expect(rangesWithMore(ranges, '2020-01-01', startOf)).toEqual([true, true, true])
    // History from inside the shortest range: only that one shows anything new.
    expect(rangesWithMore(ranges, '2026-10-01', startOf)).toEqual([true, false, false])
    expect(rangesWithMore(ranges, null, startOf)).toEqual([true, false, false])
  })
})

describe('historyNote', () => {
  const date = (iso: string) => iso.slice(5)

  it('says where the estimate ends and where history starts, or nothing', () => {
    expect(
      historyNote(
        { estimatedBefore: '2026-11-17', historyStart: '2026-03-14' },
        '2025-11-17',
        date,
      ),
    ).toBe('Before 11-17, estimated from transactions. History starts 03-14.')
    expect(
      historyNote({ estimatedBefore: null, historyStart: '2026-03-14' }, '2026-08-19', date),
    ).toBeNull()
  })
})
