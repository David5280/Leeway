import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { parsePercent, PercentInput } from './PercentInput'

describe('parsePercent', () => {
  it('reads whole percents and keeps them between 1 and 100', () => {
    expect(parsePercent('85')).toBe(85)
    expect(parsePercent(' 72.6 ')).toBe(73)
    expect(parsePercent('0')).toBe(1)
    expect(parsePercent('250')).toBe(100)
  })

  it('gives null for an empty box or text that is not a number', () => {
    expect(parsePercent('')).toBeNull()
    expect(parsePercent('   ')).toBeNull()
    expect(parsePercent('abc')).toBeNull()
  })
})

/** Holds the value the way a form would, and shows it for the test to read. */
function Harness({ initial, optional }: { initial: number | null; optional?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <PercentInput label="Warn at" value={value} onChange={setValue} optional={optional} />
      <output>{value === null ? 'none' : value}</output>
    </>
  )
}

describe('PercentInput', () => {
  it('lets a number be retyped from empty without snapping to 1', async () => {
    render(<Harness initial={80} />)
    const user = userEvent.setup()
    const box = screen.getByLabelText('Warn at')
    await user.clear(box)
    await user.type(box, '90')
    expect(box).toHaveValue(90)
    expect(screen.getByRole('status')).toHaveTextContent('90')
  })

  it('tidies an out-of-range number when the box loses focus', async () => {
    render(<Harness initial={80} />)
    const user = userEvent.setup()
    const box = screen.getByLabelText('Warn at')
    await user.clear(box)
    await user.type(box, '150')
    expect(screen.getByRole('status')).toHaveTextContent('100')
    await user.tab()
    expect(box).toHaveValue(100)
  })

  it('keeps the last value when a required box is left empty', async () => {
    render(<Harness initial={80} />)
    const user = userEvent.setup()
    const box = screen.getByLabelText('Warn at')
    await user.clear(box)
    await user.tab()
    expect(box).toHaveValue(80)
    expect(screen.getByRole('status')).toHaveTextContent('80')
  })

  it('means no value when an optional box is emptied', async () => {
    render(<Harness initial={80} optional />)
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('Warn at'))
    expect(screen.getByRole('status')).toHaveTextContent('none')
  })
})
