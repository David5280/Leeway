// The conversation in Ask Leeway's box outlasts the box: an answer keeps
// streaming while it is closed, and it opens on another tab with the same
// conversation, scrolled where it was left, without reading it again. Each
// question carries the screen it was asked from, and "/" opens the box.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerStream, message, renderAsk } from '../../test/ask'
import { COMPUTER } from '../../test/frames'

afterEach(() => {
  vi.unstubAllGlobals()
})

const button = () => screen.findByRole('button', { name: 'Ask Leeway' })
const box = () => screen.findByRole('dialog', { name: 'Ask Leeway' })
const field = async () => within(await box()).findByRole('textbox', { name: 'Your question' })
const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

describe('an answer on its way', () => {
  it('keeps streaming while the box is closed, and shows when it opens again', async () => {
    const user = userEvent.setup()
    const stream = answerStream()
    const { asked } = renderAsk('/payday', { answer: () => stream.response })
    await user.click(await button())
    await user.type(await field(), 'Why so low?{Enter}')
    await waitFor(() => expect(asked).toHaveLength(1))
    stream.text('Rent came out ')
    expect(await within(await box()).findByText(/Rent came out/)).toBeVisible()

    await user.keyboard('{Escape}')
    await closed()
    // More arrives, and the answer finishes, with no box on screen.
    stream.text('on the 1st.')
    stream.done('Why so low?', 'Rent came out on the 1st.')

    await user.click(await button())
    expect(await within(await box()).findByText('Rent came out on the 1st.')).toBeVisible()
    expect(asked).toHaveLength(1)
  })

  it('shows the part streamed so far when opened again mid-answer', async () => {
    const user = userEvent.setup()
    const stream = answerStream()
    renderAsk('/payday', { answer: () => stream.response })
    await user.click(await button())
    await user.type(await field(), 'Am I on track?{Enter}')
    stream.text('Mostly, ')
    await within(await box()).findByText(/Mostly/)
    await user.click(within(await box()).getByRole('button', { name: 'Close Ask Leeway' }))
    await closed()
    stream.text('yes.')

    await user.click(await button())
    expect(await within(await box()).findByText(/Mostly, yes\./)).toBeVisible()
  })
})

describe('moving between tabs', () => {
  it('keeps the conversation and its scroll, without reading it again', async () => {
    const user = userEvent.setup()
    const { server } = renderAsk('/payday', {
      size: COMPUTER,
      shellPerPage: true,
      messages: [message('m1', 'user', 'How am I doing?'), message('m2', 'assistant', 'Fine.')],
    })
    await user.click(await button())
    await within(await box()).findByText('How am I doing?')
    const before = document.querySelector<HTMLElement>('.chat-scroll')!
    before.scrollTop = 120
    fireEvent.scroll(before)

    // A tab pressed outside the box closes it and goes; the new tab draws its own frame.
    await user.click(screen.getByRole('link', { name: 'Goals' }))
    await closed()
    await user.click(await button())
    const opened = await box()
    expect(within(opened).getByText('How am I doing?')).toBeVisible()
    const after = document.querySelector<HTMLElement>('.chat-scroll')!
    expect(after).not.toBe(before)
    expect(after.scrollTop).toBe(120)
    expect(await field()).toHaveAttribute('placeholder', 'Ask about Goals')
    expect(server.actions('get_chat')).toHaveLength(1)
  })
})

describe('the screen sent with each question', () => {
  it('names the screen it was asked on', async () => {
    const user = userEvent.setup()
    const { asked } = renderAsk('/payday')
    await user.click(await button())
    await user.type(await field(), 'Why so low?{Enter}')
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
  it.each([
    ['a phone', undefined],
    ['a computer', COMPUTER],
  ])('opens the box on %s with its field ready to type in', async (_, size) => {
    renderAsk('/payday', { size })
    await button()
    fireEvent.keyDown(document.body, { key: '/' })
    const input = await field()
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('focuses the full page field on Chat, with no box', async () => {
    renderAsk('/chat', { size: COMPUTER })
    const input = await screen.findByRole('textbox', { name: 'Your question' })
    fireEvent.keyDown(document.body, { key: '/' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('types a slash in a field instead, and leaves a slash with a modifier alone', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    await button()
    const note = screen.getByRole('textbox', { name: 'Note' })
    await user.type(note, 'a/b')
    expect(note).toHaveValue('a/b')
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('closing from the page beside it', () => {
  it('closes on Escape even after focus has left the box', async () => {
    const user = userEvent.setup()
    renderAsk('/payday')
    await user.click(await button())
    await field()
    // Focus moves to the page while the box stays open (it holds no focus trap).
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(await box()).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await closed()
  })
})
