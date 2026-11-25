// Ask Leeway's button and box: the round logo button in the corner of every
// screen, placed per frame; the box it opens, naming the screen; and every
// way the box shrinks back into the button (a press outside it, Escape, its
// close button, a link in an answer), focus returning to the button each
// time and its logo spinning back into place. Without an AI key none of it
// is there.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { message, renderAsk } from '../../test/ask'
import { COMPUTER, PHONE, PHONE_SIDEWAYS } from '../../test/frames'
import { useScreenName } from './AskProvider'

afterEach(() => {
  vi.unstubAllGlobals()
})

const address = () => screen.getByLabelText('Address')
const button = () => screen.findByRole('button', { name: 'Ask Leeway' })
const box = () => screen.findByRole('dialog', { name: 'Ask Leeway' })
const field = async () => within(await box()).findByRole('textbox', { name: 'Your question' })
/** Waits until the box has shrunk away and left the page. */
const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

/** Opens the box from its button, returning the box. */
async function openBox(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await button())
  return box()
}

describe('the Ask Leeway button', () => {
  it.each([
    ['a phone', PHONE, 'tabbar'],
    ['a phone turned sideways', PHONE_SIDEWAYS, 'short'],
    ['a computer', COMPUTER, 'sidebar'],
  ])('sits in the corner of %s, the page leaving room for it', async (_, size, frame) => {
    renderAsk('/payday', { size })
    const corner = (await button()).closest('.ask-fab')
    expect(corner).toHaveAttribute('data-frame', frame)
    expect(document.querySelector('.shell')).toHaveClass(`shell-${frame}`, 'shell-ask')
    // It wears the logo, and says it opens a box.
    expect(
      within(corner as HTMLElement)
        .getByRole('button')
        .querySelector('svg'),
    ).not.toBeNull()
    expect(await button()).toHaveAttribute('aria-haspopup', 'dialog')
  })

  it('follows the window as it narrows from a computer to a phone', async () => {
    const { resize } = renderAsk('/payday', { size: COMPUTER })
    expect((await button()).closest('.ask-fab')).toHaveAttribute('data-frame', 'sidebar')
    resize(PHONE)
    await waitFor(async () =>
      expect((await button()).closest('.ask-fab')).toHaveAttribute('data-frame', 'tabbar'),
    )
  })

  it('steps aside on the full Chat page, which is the conversation itself', async () => {
    renderAsk('/chat')
    expect(await screen.findByRole('heading', { name: 'Ask Leeway' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Ask Leeway' })).not.toBeInTheDocument()
  })
})

describe('without an AI key', () => {
  it.each([
    ['a phone', PHONE],
    ['a phone turned sideways', PHONE_SIDEWAYS],
    ['a computer', COMPUTER],
  ])('has no button, box or "/" on %s, and the page no extra room', async (_, size) => {
    const { server } = renderAsk('/payday', { chat: false, size })
    await waitFor(() => expect(server.actions('get_chat_status')).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /Ask Leeway/ })).not.toBeInTheDocument()
    expect(document.querySelector('.ask-fab')).toBeNull()
    expect(document.querySelector('.shell')).not.toHaveClass('shell-ask')
    fireEvent.keyDown(document.body, { key: '/' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.actions('get_chat')).toHaveLength(0)
  })
})

describe('opening the box', () => {
  it.each([
    ['/payday', 'Payday'],
    ['/', 'Home'],
    ['/spending/activity', 'All activity'],
    ['/payday/bills', 'Bills and subscriptions'],
    ['/settings/banks', 'Settings'],
  ])('on %s focuses the field, which asks about %s', async (route, name) => {
    const user = userEvent.setup()
    renderAsk(route)
    await openBox(user)
    const input = await field()
    expect(input).toHaveAttribute('placeholder', `Ask about ${name}`)
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('takes a page name more exact than the address, like a category', async () => {
    function Groceries() {
      useScreenName('Category: Groceries')
      return null
    }
    const user = userEvent.setup()
    renderAsk('/spending/c1', { children: <Groceries /> })
    await openBox(user)
    expect(await field()).toHaveAttribute('placeholder', 'Ask about Category: Groceries')
  })

  it('covers the button, shows the conversation, and leaves the page as it was', async () => {
    const user = userEvent.setup()
    renderAsk('/payday', { size: COMPUTER })
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'half typed')
    const page = document.querySelector('.page')
    const opened = await openBox(user)
    expect(within(opened).getByRole('heading', { name: 'Ask anything about your money' }))
    expect(document.querySelector('.ask-fab-button')).toHaveAttribute('aria-expanded', 'true')
    // Not a page of its own: no dimmed layer, the same page under it, the address unchanged.
    expect(document.querySelector('.sheet-scrim')).toBeNull()
    expect(document.querySelector('.page')).toBe(page)
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('half typed')
    expect(address()).toHaveTextContent('/payday')
  })
})

describe('closing the box', () => {
  it('a press outside it shrinks it back, focus returning to the button', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    await openBox(user)
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'A screen' }))
    await closed()
    expect(await button()).toHaveFocus()
  })

  it('a press outside on a field leaves focus in that field, and the press goes through', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    await openBox(user)
    await user.click(screen.getByRole('textbox', { name: 'Note' }))
    await closed()
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus()
  })

  it('a press outside on a tab closes it and still follows the tab', async () => {
    const user = userEvent.setup()
    renderAsk('/payday', { size: COMPUTER })
    await openBox(user)
    await user.click(screen.getByRole('link', { name: 'Goals' }))
    await closed()
    expect(address()).toHaveTextContent('/goals')
  })

  it('a press inside it, anywhere, keeps it open', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    const opened = await openBox(user)
    await user.click(within(opened).getByRole('heading', { name: 'Ask Leeway' }))
    await user.click(await field())
    expect(await box()).toBeVisible()
  })

  it('Escape shrinks it back, focus returning to the button', async () => {
    const user = userEvent.setup()
    renderAsk('/goals')
    await openBox(user)
    await waitFor(async () => expect(await field()).toHaveFocus())
    await user.keyboard('{Escape}')
    await closed()
    expect(await button()).toHaveFocus()
    expect(address()).toHaveTextContent('/goals')
  })

  it('its close button shrinks it back, focus returning to the button', async () => {
    const user = userEvent.setup()
    renderAsk('/goals', { size: COMPUTER })
    const opened = await openBox(user)
    await user.click(within(opened).getByRole('button', { name: 'Close Ask Leeway' }))
    await closed()
    expect(await button()).toHaveFocus()
  })

  it("a link in an answer goes to its screen, shrinking the box into that screen's button", async () => {
    const user = userEvent.setup()
    const messages = [
      message('q', 'user', 'Where are my bills?'),
      message('a', 'assistant', 'They are on [Bills](/payday/bills).'),
    ]
    renderAsk('/', { messages, shellPerPage: true })
    const opened = await openBox(user)
    await user.click(await within(opened).findByRole('link', { name: 'Bills' }))
    expect(address()).toHaveTextContent('/payday/bills')
    await closed()
    // The new screen draws its own button, and focus lands on it.
    await waitFor(async () => expect(await button()).toHaveFocus())
  })

  it('a link to the screen it is on shrinks it back too, focus on the button', async () => {
    const user = userEvent.setup()
    const messages = [message('a', 'assistant', 'See [Payday](/payday).')]
    renderAsk('/payday', { messages })
    const opened = await openBox(user)
    await user.click(await within(opened).findByRole('link', { name: 'Payday' }))
    await closed()
    expect(await button()).toHaveFocus()
  })

  it('stays closed after moving away and coming Back to its screen', async () => {
    const user = userEvent.setup()
    const messages = [message('a', 'assistant', 'See [Goals](/goals).')]
    const { back } = renderAsk('/payday', { messages })
    const opened = await openBox(user)
    await user.click(await within(opened).findByRole('link', { name: 'Goals' }))
    await closed()
    back()
    await waitFor(() => expect(address()).toHaveTextContent('/payday'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens again from the button after closing', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    await openBox(user)
    await user.keyboard('{Escape}')
    await closed()
    expect(await openBox(user)).toBeVisible()
  })

  it('spins the logo back into place each time it closes, never on first showing', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    const logo = async () => (await button()).querySelector('.ask-fab-logo')
    expect(await logo()).toHaveAttribute('data-spin', 'false')
    await openBox(user)
    await user.keyboard('{Escape}')
    await closed()
    const firstSpin = await logo()
    expect(firstSpin).toHaveAttribute('data-spin', 'true')
    await openBox(user)
    await user.keyboard('{Escape}')
    await closed()
    // A fresh element, so the spin plays again rather than staying finished.
    expect(await logo()).not.toBe(firstSpin)
    expect(await logo()).toHaveAttribute('data-spin', 'true')
  })
})
