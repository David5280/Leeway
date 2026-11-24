// Press and hold a card to ask about it (useCardHold.ts): a held press, a
// right click or the context menu key opens Ask Leeway carrying the card's
// name and figure, while a tap still drills, a link card still goes, and a
// press that moves or scrolls is left alone. However a hold is let go, it
// neither closes the sheet it opened nor swallows a later press.

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrillDown } from '../../lib/drill'
import { renderAsk } from '../../test/ask'
import { COMPUTER } from '../../test/frames'
import { Card } from '../design/Card'
import { Money } from '../design/Money'
import { SCRIM_SETTLE_MS } from '../design/Sheet'
import { HELD_CLICK_MS, HOLD_MS, HOLD_SLOP_PX } from './useCardHold'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const untilPayday: DrillDown = {
  title: 'Until payday',
  figure: { cents: 118000 },
  math: { terms: [], result: { label: 'Until payday', value: { cents: 118000 } } },
}

/** Three cards: one that drills, one that is a link, one with a field. */
const CARDS = (
  <>
    <Card drill={untilPayday} label="Until payday">
      <span className="key-figure-label">Until payday</span>
      <Money cents={118000} />
    </Card>
    <Card to="/goals">
      <h2>Top goal</h2>
      <Money cents={50000} />
    </Card>
    <Card static="form" label="Pay">
      <input aria-label="Pay amount" />
    </Card>
  </>
)

const drillButton = () => screen.getByRole('button', { name: /show how it adds up/ })

/** The note over the question box naming the card asked about. */
const aboutNote = (within: { findByText: typeof screen.findByText }, text: RegExp) =>
  within.findByText(text, { selector: '.ask-about-text' })

/** Presses and holds `element` for `ms`, moving `drift` pixels partway, then lets go. */
function hold(element: Element, { ms = HOLD_MS, drift = 0 } = {}) {
  vi.useFakeTimers()
  fireEvent.pointerDown(element, { isPrimary: true, button: 0, clientX: 50, clientY: 50 })
  if (drift) fireEvent.pointerMove(element, { clientX: 50, clientY: 50 + drift })
  act(() => vi.advanceTimersByTime(ms))
  fireEvent.pointerUp(element)
  vi.useRealTimers()
}

/** Holds `element` until Ask Leeway opens, leaving the press down and fake timers on. */
function holdDown(element: Element) {
  vi.useFakeTimers()
  fireEvent.pointerDown(element, { isPrimary: true, button: 0, clientX: 50, clientY: 50 })
  act(() => vi.advanceTimersByTime(HOLD_MS))
}

/** Ask Leeway's screen, ready: the bar shows once the server says Chat is on. */
async function ready(options: Parameters<typeof renderAsk>[1] = {}) {
  const rendered = renderAsk('/payday', { children: CARDS, ...options })
  await screen.findByRole('button', { name: /Ask Leeway/ })
  return rendered
}

describe('pressing and holding a card', () => {
  it('opens Ask Leeway about the card, carrying its name and figure', async () => {
    const user = userEvent.setup()
    const { asked } = await ready()
    hold(drillButton())
    const sheet = await screen.findByRole('dialog', { name: 'Ask Leeway' })
    expect(await aboutNote(within(sheet), /About Until payday/)).toHaveTextContent('$1,180')
    // The click a held press ends with is swallowed: the card's own sheet stays shut.
    fireEvent.click(drillButton())
    expect(screen.queryByRole('dialog', { name: 'Until payday' })).not.toBeInTheDocument()

    await user.type(await within(sheet).findByRole('textbox'), 'Why so low?{Enter}')
    await waitFor(() => expect(asked).toHaveLength(1))
    expect(asked[0]!.context).toEqual({
      screen: 'Payday',
      card: { label: 'Until payday', figure: '$1,180' },
    })
  })

  it('reads the name a card shows when it has no label of its own', async () => {
    await ready()
    hold(screen.getByRole('link', { name: /Top goal/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Ask Leeway' })
    expect(await aboutNote(within(sheet), /About Top goal/)).toHaveTextContent('$500')
  })

  it('asks about the screen alone once the card is let go', async () => {
    const user = userEvent.setup()
    const { asked } = await ready()
    hold(drillButton())
    const sheet = await screen.findByRole('dialog', { name: 'Ask Leeway' })
    await user.click(await within(sheet).findByRole('button', { name: 'Not about Until payday' }))
    await user.type(await within(sheet).findByRole('textbox'), 'Hi{Enter}')
    await waitFor(() => expect(asked[0]?.context).toEqual({ screen: 'Payday' }))
  })
})

describe('what a hold leaves alone', () => {
  it('a tap still opens the drill-down', async () => {
    const user = userEvent.setup()
    await ready()
    await user.click(drillButton())
    expect(await screen.findByRole('dialog', { name: 'Until payday' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Ask Leeway' })).not.toBeInTheDocument()
  })

  it('a tap on a link card still goes to its page', async () => {
    const user = userEvent.setup()
    await ready()
    await user.click(screen.getByRole('link', { name: /Top goal/ }))
    expect(screen.getByLabelText('Address')).toHaveTextContent('/goals')
  })

  it('a press that moves is a scroll or a selection, not a hold', async () => {
    await ready()
    hold(drillButton(), { drift: HOLD_SLOP_PX + 5 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a press let go early is a tap, not a hold', async () => {
    await ready()
    hold(drillButton(), { ms: HOLD_MS - 100 })
    expect(screen.queryByRole('dialog', { name: 'Ask Leeway' })).not.toBeInTheDocument()
  })

  it('a scroll during the press cancels it', async () => {
    await ready()
    vi.useFakeTimers()
    fireEvent.pointerDown(drillButton(), { isPrimary: true, button: 0 })
    fireEvent.scroll(document)
    act(() => vi.advanceTimersByTime(HOLD_MS))
    vi.useRealTimers()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a press in a field inside a card', async () => {
    await ready()
    hold(screen.getByRole('textbox', { name: 'Pay amount' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a right click on selected text, which keeps the browser menu for copying', async () => {
    await ready({ size: COMPUTER })
    const figure = screen.getByText('$1,180')
    window.getSelection()!.selectAllChildren(figure)
    expect(fireEvent.contextMenu(figure)).toBe(true)
    window.getSelection()!.removeAllRanges()
    expect(screen.queryByRole('complementary', { name: 'Ask Leeway' })).not.toBeInTheDocument()
  })
})

describe('letting go of a hold', () => {
  it('off the card, with no click to swallow, leaves a later Enter on the card working', async () => {
    await ready({ size: COMPUTER })
    holdDown(drillButton())
    // Let go elsewhere: the card never sees the click that would end the hold.
    fireEvent.pointerUp(document.body)
    act(() => vi.advanceTimersByTime(HELD_CLICK_MS))
    vi.useRealTimers()
    const panel = await screen.findByRole('complementary', { name: 'Ask Leeway' })
    // The panel takes focus into its box first; the owner then comes back to the card.
    await waitFor(() => expect(within(panel).getByRole('textbox')).toHaveFocus())
    drillButton().focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Until payday' })).toBeVisible()
  })

  it("on a phone, over the sheet's dimmed page, leaves the sheet open", async () => {
    await ready()
    holdDown(drillButton())
    const askSheet = () => screen.queryByRole('dialog', { name: 'Ask Leeway' })
    const scrim = document.querySelector('.sheet-scrim')!
    // The release lands on the scrim now over the card, as a click (iOS).
    fireEvent.pointerUp(scrim)
    fireEvent.click(scrim)
    expect(askSheet()).toBeInTheDocument()
    // A press there a moment later is the owner's own, and closes it.
    act(() => vi.advanceTimersByTime(SCRIM_SETTLE_MS))
    fireEvent.click(scrim)
    vi.useRealTimers()
    await waitFor(() => expect(askSheet()).not.toBeInTheDocument())
  })
})

describe('on a computer and from the keyboard', () => {
  it('a right click opens the panel about the card', async () => {
    await ready({ size: COMPUTER })
    // The browser's own menu is replaced (the event's default is prevented).
    expect(fireEvent.contextMenu(drillButton())).toBe(false)
    const panel = await screen.findByRole('complementary', { name: 'Ask Leeway' })
    expect(await aboutNote(within(panel), /About Until payday/)).toBeVisible()
  })

  it.each([
    ['the context menu key', { key: 'ContextMenu' }],
    ['Shift+F10', { key: 'F10', shiftKey: true }],
  ])('%s on a focused card opens it too', async (_, press) => {
    await ready({ size: COMPUTER })
    drillButton().focus()
    fireEvent.keyDown(drillButton(), press)
    const panel = await screen.findByRole('complementary', { name: 'Ask Leeway' })
    expect(await aboutNote(within(panel), /About Until payday/)).toBeVisible()
  })
})

describe('without an AI key', () => {
  it('cards keep the browser menu and a hold does nothing', async () => {
    const { server } = renderAsk('/payday', { chat: false, children: CARDS })
    await waitFor(() => expect(server.actions('get_chat_status')).toHaveLength(1))
    expect(document.querySelector('[data-ask-hold]')).toBeNull()
    expect(fireEvent.contextMenu(drillButton())).toBe(true)
    hold(drillButton())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
