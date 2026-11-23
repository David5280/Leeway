// The line under a money field whose amount can't be saved.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { NEGATIVE_AMOUNT, UNREADABLE_AMOUNT, type AmountRules } from '../lib/amountNote'
import { AmountNote, useAmountField } from './AmountNote'

/** A field with its line and a Save that waits on it, as the forms have. */
function Field({ rules, fit }: { rules?: AmountRules; fit?: boolean }) {
  const [text, setText] = useState('')
  const field = useAmountField(text, rules)
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <input
        aria-label="Amount"
        {...field.inputProps}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <AmountNote id={field.id} text={field.shown} fit={fit} />
      <button type="submit" disabled={field.note !== null}>
        Save
      </button>
    </form>
  )
}

function renderField(props: Parameters<typeof Field>[0] = {}) {
  render(<Field {...props} />)
  return { user: userEvent.setup(), input: screen.getByLabelText('Amount') }
}

describe('AmountNote', () => {
  it.each(['$', '-', '(45', '1.234'])(
    'keeps Save off for %j while typing, but says nothing until the field is left',
    async (text) => {
      const { user, input } = renderField()
      await user.type(input, text)
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(input).toHaveAttribute('aria-invalid', 'false')
      await user.tab()
      expect(screen.getByRole('alert')).toHaveTextContent(UNREADABLE_AMOUNT)
      expect(input).toHaveAttribute('aria-invalid', 'true')
    },
  )

  it('names the line as what describes the field, and shows it on Enter too', async () => {
    const { user, input } = renderField()
    await user.type(input, '5k{Enter}')
    const line = document.getElementById(input.getAttribute('aria-describedby')!)
    expect(line).toHaveTextContent(UNREADABLE_AMOUNT)
    expect(input).toHaveAccessibleDescription(UNREADABLE_AMOUNT)
  })

  it('goes as soon as the amount can be saved', async () => {
    const { user, input } = renderField()
    await user.type(input, '5k')
    await user.tab()
    await user.clear(input)
    await user.type(input, '5')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('names a negative amount where the field takes none, and keeps Save off', async () => {
    const { user, input } = renderField({ rules: { min: 0 } })
    await user.type(input, '-5')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.tab()
    expect(screen.getByRole('alert')).toHaveTextContent(NEGATIVE_AMOUNT)
  })

  it.each(['', '60', '$1,200.50', '-42.10', '(45.00)'])(
    'says nothing for %j, blank or an amount, even once left',
    async (text) => {
      const { user, input } = renderField()
      if (text) await user.type(input, text)
      await user.tab()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    },
  )

  it('keeps its line while empty, so nothing moves when it shows, unless it fits a list', () => {
    const { unmount } = render(<AmountNote id="note" text={null} />)
    expect(document.getElementById('note')).toHaveClass('amount-note')
    expect(document.getElementById('note')).not.toHaveClass('fit')
    expect(document.getElementById('note')).toBeEmptyDOMElement()
    unmount()
    render(<AmountNote id="note" text={null} fit />)
    expect(document.getElementById('note')).toHaveClass('amount-note', 'fit')
  })
})
