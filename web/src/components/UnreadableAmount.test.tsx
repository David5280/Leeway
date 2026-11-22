// The line under a money field whose text cannot be read.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UNREADABLE_AMOUNT, UnreadableAmount } from './UnreadableAmount'

describe('UnreadableAmount', () => {
  it.each(['6O', '5k', '1,2OO', '2MM', '1.234'])(
    'names %j as an amount it could not read',
    (text) => {
      render(<UnreadableAmount text={text} />)
      expect(screen.getByRole('alert')).toHaveTextContent(UNREADABLE_AMOUNT)
    },
  )

  it.each(['', '  ', '60', '$1,200.50', '-42.10', '(45.00)'])(
    'says nothing for %j, blank or an amount',
    (text) => {
      const { container } = render(<UnreadableAmount text={text} />)
      expect(container).toBeEmptyDOMElement()
    },
  )

  it('says it plainly', () => {
    expect(UNREADABLE_AMOUNT).toBe("Couldn't read that amount.")
  })
})
