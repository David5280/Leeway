// Ask Leeway on every screen: the bar above the phone's tabs naming the
// screen, the conversation in a sheet over the screen that closes back to
// it, the computer's panel and its rail, the screen sent with each
// question, and the "/" key. Without an AI key none of it is there.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { message, renderAsk } from '../../test/ask'
import { COMPUTER, PHONE, PHONE_SIDEWAYS } from '../../test/frames'
import { useScreenName } from './AskProvider'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

const address = () => screen.getByLabelText('Address')
const bar = () => screen.findByRole('button', { name: /^Ask Leeway: / })
const sheet = () => screen.findByRole('dialog', { name: 'Ask Leeway' })

describe('the Ask Leeway bar', () => {
  it.each([
    ['/payday', 'Payday'],
    ['/', 'Home'],
    ['/spending/activity', 'All activity'],
    ['/spending/groceries', 'Category'],
    ['/payday/bills', 'Bills and subscriptions'],
    ['/settings/banks', 'Settings'],
  ])('on %s names the screen: "Ask about %s"', async (route, name) => {
    renderAsk(route)
    expect(await bar()).toHaveTextContent(`Ask about ${name}`)
  })

  it('sits above the phone tab bar, and the page leaves room for both', async () => {
    renderAsk('/payday', { size: PHONE })
    const dock = (await bar()).parentElement!
    expect(dock).toHaveClass('ask-dock')
    // Drawn before the tab bar, so it reads first and sits just above it.
    const tabbar = screen.getByRole('navigation', { name: 'Main' })
    expect(dock.compareDocumentPosition(tabbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('.shell')).toHaveClass('shell-tabbar', 'shell-ask')
  })

  it('sits at the foot of a phone turned sideways, with room left for it', async () => {
    renderAsk('/payday', { size: PHONE_SIDEWAYS })
    expect((await bar()).parentElement).toHaveClass('ask-dock')
    expect(document.querySelector('.shell')).toHaveClass('shell-short', 'shell-ask')
  })

  it('takes a page name more exact than the address, like a category', async () => {
    function Groceries() {
      useScreenName('Category: Groceries')
      return null
    }
    renderAsk('/spending/c1', { children: <Groceries /> })
    await waitFor(async () =>
      expect(await bar()).toHaveTextContent('Ask about Category: Groceries'),
    )
  })

  it('steps aside on the full Chat page, which is the conversation itself', async () => {
    renderAsk('/chat')
    expect(await screen.findByRole('heading', { name: 'Ask Leeway' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Ask Leeway: / })).not.toBeInTheDocument()
  })
})

describe('without an AI key', () => {
  it.each([
    ['a phone', PHONE],
    ['a phone turned sideways', PHONE_SIDEWAYS],
    ['a computer', COMPUTER],
  ])('has no bar, panel or "/" on %s, and the page no extra room', async (_, size) => {
    const { server } = renderAsk('/payday', { chat: false, size })
    await waitFor(() => expect(server.actions('get_chat_status')).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /Ask Leeway/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Ask Leeway' })).not.toBeInTheDocument()
    expect(document.querySelector('.shell')).not.toHaveClass('shell-ask')
    fireEvent.keyDown(document.body, { key: '/' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.actions('get_chat')).toHaveLength(0)
  })
})

describe('the conversation over the screen, on a phone', () => {
  it('opens over the screen and closes back to it, the page untouched', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'half typed')
    const page = document.querySelector('.page')
    await user.click(await bar())
    const dialog = await sheet()
    expect(within(dialog).getByRole('heading', { name: 'Ask anything about your money' }))
    expect(within(dialog).getByRole('textbox', { name: 'Your question' })).toHaveAttribute(
      'placeholder',
      'Ask about Payday',
    )
    expect(address()).toHaveTextContent('/payday')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // The same page, never drawn again: what was typed, and so where it was scrolled, is kept.
    expect(document.querySelector('.page')).toBe(page)
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('half typed')
    expect(address()).toHaveTextContent('/payday')
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup()
    renderAsk('/goals')
    await user.click(await bar())
    await sheet()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(address()).toHaveTextContent('/goals')
  })

  it('closes with Back, staying on the screen', async () => {
    const user = userEvent.setup()
    const { back } = renderAsk('/goals')
    await user.click(await bar())
    await sheet()
    back()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(address()).toHaveTextContent('/goals')
  })

  it('follows a link in an answer, closing the sheet; Back returns to the screen', async () => {
    const user = userEvent.setup()
    const messages = [
      message('q', 'user', 'Where are my bills?'),
      message('a', 'assistant', 'They are on [Bills](/payday/bills).'),
    ]
    const { back } = renderAsk('/', { messages })
    await user.click(await bar())
    await user.click(await within(await sheet()).findByRole('link', { name: 'Bills' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(address()).toHaveTextContent('/payday/bills')
    back()
    await waitFor(() => expect(address()).toHaveTextContent('/'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the panel, on a computer', () => {
  it('starts as a slim rail, opens beside the page, and collapses back', async () => {
    const user = userEvent.setup()
    renderAsk('/payday', { size: COMPUTER })
    const open = await screen.findByRole('button', { name: 'Open Ask Leeway: Ask about Payday' })
    expect(screen.queryByRole('button', { name: /^Ask Leeway: / })).not.toBeInTheDocument()
    await user.click(open)
    const panel = await screen.findByRole('complementary', { name: 'Ask Leeway' })
    expect(await within(panel).findByRole('textbox', { name: 'Your question' })).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('.shell')).toHaveClass('shell-ask-open')
    await user.click(within(panel).getByRole('button', { name: 'Collapse Ask Leeway' }))
    expect(await screen.findByRole('button', { name: /^Open Ask Leeway/ })).toBeVisible()
    expect(localStorage.getItem('leeway.askPanel')).toBe('closed')
  })

  it('stays open moving between tabs, and is remembered for next time', async () => {
    const user = userEvent.setup()
    const first = renderAsk('/payday', { size: COMPUTER })
    await user.click(await screen.findByRole('button', { name: /^Open Ask Leeway/ }))
    await user.click(screen.getByRole('link', { name: 'Goals' }))
    expect(address()).toHaveTextContent('/goals')
    const panel = await screen.findByRole('complementary', { name: 'Ask Leeway' })
    expect(await within(panel).findByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Ask about Goals',
    )
    first.unmount()
    renderAsk('/wealth', { size: COMPUTER })
    expect(await screen.findByRole('complementary', { name: 'Ask Leeway' })).toBeVisible()
  })

  it('still opens and collapses when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    renderAsk('/payday', { size: COMPUTER })
    await user.click(await screen.findByRole('button', { name: /^Open Ask Leeway/ }))
    const panel = await screen.findByRole('complementary', { name: 'Ask Leeway' })
    await user.click(within(panel).getByRole('button', { name: 'Collapse Ask Leeway' }))
    expect(await screen.findByRole('button', { name: /^Open Ask Leeway/ })).toBeVisible()
  })

  it('turns into the bar and sheet when the window narrows', async () => {
    const { resize } = renderAsk('/payday', { size: COMPUTER })
    await screen.findByRole('button', { name: /^Open Ask Leeway/ })
    resize(PHONE)
    expect(await bar()).toBeVisible()
  })
})

describe('the screen sent with each question', () => {
  it('names the screen it was asked on', async () => {
    const user = userEvent.setup()
    const { asked } = renderAsk('/payday')
    await user.click(await bar())
    await user.type(within(await sheet()).getByRole('textbox'), 'Why so low?{Enter}')
    await waitFor(() => expect(asked).toHaveLength(1))
    expect(asked[0]).toEqual({ message: 'Why so low?', context: { screen: 'Payday' } })
  })

  it('names none from the full Chat page', async () => {
    const user = userEvent.setup()
    const { asked } = renderAsk('/chat')
    await user.type(await screen.findByRole('textbox', { name: 'Your question' }), 'Hi{Enter}')
    await waitFor(() => expect(asked).toEqual([{ message: 'Hi' }]))
  })
})

describe('the "/" key', () => {
  it('opens the conversation on a phone with its box ready to type in', async () => {
    renderAsk('/payday')
    await bar()
    fireEvent.keyDown(document.body, { key: '/' })
    const box = await within(await sheet()).findByRole('textbox', { name: 'Your question' })
    await waitFor(() => expect(box).toHaveFocus())
  })

  it('opens the panel on a computer, and focuses the full page box on Chat', async () => {
    const first = renderAsk('/payday', { size: COMPUTER })
    await screen.findByRole('button', { name: /^Open Ask Leeway/ })
    fireEvent.keyDown(document.body, { key: '/' })
    const panel = await screen.findByRole('complementary', { name: 'Ask Leeway' })
    await waitFor(() => expect(within(panel).getByRole('textbox')).toHaveFocus())
    first.unmount()
    renderAsk('/chat', { size: COMPUTER })
    const box = await screen.findByRole('textbox', { name: 'Your question' })
    fireEvent.keyDown(document.body, { key: '/' })
    await waitFor(() => expect(box).toHaveFocus())
  })

  it('types a slash in a field instead, and leaves a slash with a modifier alone', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    await bar()
    const note = screen.getByRole('textbox', { name: 'Note' })
    await user.type(note, 'a/b')
    expect(note).toHaveValue('a/b')
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
