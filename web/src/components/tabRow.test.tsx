// A page's sections in one row that scrolls sideways, keeping the one shown in view.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabRow } from './TabRow'

const OPTIONS = [
  { value: 'bills', label: 'Bills' },
  { value: 'retirement', label: 'Retirement' },
] as const

function Sections() {
  const [value, setValue] = useState<'bills' | 'retirement'>('bills')
  return <TabRow label="Plan section" value={value} options={OPTIONS} onChange={setValue} />
}

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView
})

describe('TabRow', () => {
  it('scrolls the section shown into view, never jumping the page', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    render(<Sections />)
    expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' })
    await userEvent.click(screen.getByRole('button', { name: 'Retirement' }))
    expect(screen.getByRole('button', { name: 'Retirement' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByRole('button', { name: 'Retirement' }))
  })

  it('works where the browser cannot scroll an element into view', () => {
    render(<Sections />)
    expect(screen.getByRole('group', { name: 'Plan section' })).toHaveClass('seg-scroll')
  })
})
