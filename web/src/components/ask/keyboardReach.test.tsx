// The keyboard's way to ask about a card with nothing to focus
// (useKeyboardReach.ts): such a card, and only such a card, becomes a tab
// stop while Ask Leeway is on, so the context menu key reaches it too.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrillDown } from '../../lib/drill'
import { renderAsk } from '../../test/ask'
import { COMPUTER } from '../../test/frames'
import { Card } from '../design/Card'
import { Money } from '../design/Money'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const spent: DrillDown = {
  title: 'Spent',
  figure: { cents: 4200 },
  math: { terms: [], result: { label: 'Spent', value: { cents: 4200 } } },
}

/** A card that fills in later: words alone, until a button is added to it. */
function Growing() {
  const [grown, setGrown] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setGrown(true)}>
        Grow
      </button>
      <Card static="words" label="Growing">
        <p>Some words</p>
        {grown && <button type="button">Inside</button>}
      </Card>
    </>
  )
}

/** A card of words and a figure, one that drills, one with a field, and one that grows. */
const CARDS = (
  <>
    <Card static="pending" label="Net worth">
      <Money cents={1250000} />
    </Card>
    <Card drill={spent} label="Spent">
      <Money cents={4200} />
    </Card>
    <Card static="form" label="Pay">
      <input aria-label="Pay amount" />
    </Card>
    <Growing />
  </>
)

const card = (name: string) => screen.getByRole('region', { name })

describe('a card with nothing to focus, with Ask Leeway on', () => {
  it('is one tab stop, and the context menu key on it asks about it', async () => {
    renderAsk('/payday', { size: COMPUTER, children: CARDS })
    await waitFor(() => expect(card('Net worth')).toHaveAttribute('tabindex', '0'))
    card('Net worth').focus()
    fireEvent.keyDown(card('Net worth'), { key: 'F10', shiftKey: true })
    const panel = await screen.findByRole('complementary', { name: 'Ask Leeway' })
    expect(await within(panel).findByText(/About Net worth/)).toHaveTextContent('$12,500')
  })

  it('adds no stop to cards the keyboard already reaches through their own controls', async () => {
    renderAsk('/payday', { size: COMPUTER, children: CARDS })
    await waitFor(() => expect(card('Net worth')).toHaveAttribute('tabindex', '0'))
    expect(card('Spent')).not.toHaveAttribute('tabindex')
    expect(card('Pay')).not.toHaveAttribute('tabindex')
  })

  it('drops its stop once something inside it can take focus', async () => {
    const user = userEvent.setup()
    renderAsk('/payday', { size: COMPUTER, children: CARDS })
    await waitFor(() => expect(card('Growing')).toHaveAttribute('tabindex', '0'))
    await user.click(screen.getByRole('button', { name: 'Grow' }))
    await waitFor(() => expect(card('Growing')).not.toHaveAttribute('tabindex'))
  })
})

describe('without an AI key', () => {
  it('adds no tab stop to any card', async () => {
    const { server } = renderAsk('/payday', { chat: false, size: COMPUTER, children: CARDS })
    await waitFor(() => expect(server.actions('get_chat_status')).toHaveLength(1))
    expect(document.querySelector('.card[tabindex]')).toBeNull()
  })
})
