// The segmented control: a row of options, one picked, and how it lays out on a phone.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { phoneColumns, Segmented } from './ui'

const SIZES = [
  { value: 'half', label: 'Half' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
] as const

describe('Segmented', () => {
  it('marks the picked option and reports a new pick', async () => {
    const onChange = vi.fn()
    render(<Segmented label="Size" value="wide" options={SIZES} onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Size' })
    expect(screen.getByRole('button', { name: 'Wide' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Half' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Full' }))
    expect(onChange).toHaveBeenCalledWith('full')
    // The phone layout's column count rides along as a CSS variable.
    expect(group.style.getPropertyValue('--columns')).toBe('3')
  })
})

describe('phoneColumns', () => {
  it('puts short labels in one row', () => {
    expect(phoneColumns(['Half', 'Wide', 'Full'])).toBe(3)
    expect(phoneColumns(['Theme', 'Round', 'Soft', 'Square'])).toBe(4)
    expect(phoneColumns(['Bills', 'Goals', 'Debts', 'Net worth'])).toBe(4)
  })

  it('splits long labels into even rows of at most three', () => {
    expect(phoneColumns(['Theme default', 'Match my device', 'Light', 'Dark'])).toBe(2)
    expect(phoneColumns(['Monthly', 'Every paycheck', 'Weekly'])).toBe(3)
    expect(phoneColumns(['First option', 'Second option', 'Third option', 'Four', 'Five'])).toBe(3)
    expect(phoneColumns(Array.from({ length: 6 }, () => 'A long option'))).toBe(3)
  })

  it('gives a lone option its own column', () => {
    expect(phoneColumns(['Only one option with a very long label'])).toBe(1)
  })
})
