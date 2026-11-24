// The frame around every screen (Shell.tsx): the tab bar, rail or sidebar
// for the window's size, the header's links, which tab is lit, and the keys
// that switch tabs.

import { fireEvent, screen, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn } from '../../test/fake'
import { COMPUTER, PHONE, PHONE_SIDEWAYS, TABLET, windowOf } from '../../test/frames'
import { Shell } from '../Shell'

afterEach(() => vi.unstubAllGlobals())

/** Shows where the router is, as the address bar would. */
function Address() {
  const { pathname } = useLocation()
  return <output aria-label="Address">{pathname}</output>
}

/** A screen in the shell at `route`, with a field to type in and the address shown. */
function renderShell(route = '/', { chat = false, unread = 0 } = {}) {
  fakeServer({
    count_notifications: () => ({ unread }),
    get_chat_status: () => ({ available: chat }),
  })
  return renderSignedIn(
    <Routes>
      <Route
        path="*"
        element={
          <Shell>
            <h1>A screen</h1>
            <input aria-label="Note" />
            <Address />
          </Shell>
        }
      />
    </Routes>,
    { route },
  )
}

const address = () => screen.getByLabelText('Address').textContent
const mainMenu = () => within(screen.getByRole('navigation', { name: 'Main' }))
const tabNames = () =>
  mainMenu()
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('on a phone', () => {
  it('puts the five tabs in a bar along the bottom, and no sidebar', () => {
    windowOf(PHONE)
    renderShell()
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('tabbar')
    expect(tabNames()).toEqual(['Home', 'Spending', 'Payday', 'Goals', 'Wealth'])
    expect(document.querySelector('.sidebar')).toBeNull()
    expect(document.querySelector('.row-tabs')).toBeNull()
  })

  it('heads each screen with the logo, then the Inbox and Settings, and no theme switch', async () => {
    windowOf(PHONE)
    renderShell()
    const header = within(screen.getByRole('banner'))
    expect(header.getByRole('link', { name: 'Leeway home' })).toHaveAttribute('href', '/')
    const more = within(header.getByRole('navigation', { name: 'More' }))
    expect(await more.findByRole('link', { name: 'Inbox' })).toHaveAttribute('href', '/inbox')
    expect(more.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /theme/ })).not.toBeInTheDocument()
  })

  it('shows how much is unread on the bell, and no Chat link even when Chat is on', async () => {
    windowOf(PHONE)
    renderShell('/', { chat: true, unread: 3 })
    const more = within(screen.getByRole('navigation', { name: 'More' }))
    expect(await more.findByRole('link', { name: 'Inbox, 3 unread' })).toHaveTextContent('3')
    // Ask Leeway's button stands in for it.
    expect(await screen.findByRole('button', { name: /^Ask Leeway/ })).toBeVisible()
    expect(more.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument()
  })

  it('keeps the tab bar on a tablet held upright', () => {
    windowOf(TABLET)
    renderShell()
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('tabbar')
  })
})

describe('on a phone turned sideways', () => {
  it('puts the tabs in the slim top row, leaving the page its full width and height', () => {
    windowOf(PHONE_SIDEWAYS)
    renderShell()
    const tabs = screen.getByRole('navigation', { name: 'Main' })
    expect(tabs).toHaveClass('row-tabs')
    expect(tabNames()).toEqual(['Home', 'Spending', 'Payday', 'Goals', 'Wealth'])
    // The tabs sit inside the header, so nothing stands beside or under the page.
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('topbar')
    expect(header).toContainElement(tabs)
    expect(document.querySelector('.tabbar')).toBeNull()
    expect(document.querySelector('.sidebar')).toBeNull()
  })
})

describe('on a computer', () => {
  it('puts the logo, the five tabs, then Inbox and Settings in a sidebar, with no tab bar', async () => {
    windowOf(COMPUTER)
    renderShell()
    const sidebar = screen.getByRole('banner')
    expect(sidebar).toHaveClass('sidebar')
    expect(within(sidebar).getByRole('link', { name: 'Leeway home' })).toBeInTheDocument()
    expect(tabNames()).toEqual(['Home', 'Spending', 'Payday', 'Goals', 'Wealth'])
    const foot = within(within(sidebar).getByRole('navigation', { name: 'More' }))
    expect(await foot.findByRole('link', { name: 'Inbox' })).toHaveAttribute('href', '/inbox')
    expect(foot.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(document.querySelector('.tabbar')).toBeNull()
  })

  it('names the unread count on the Inbox in the sidebar too', async () => {
    windowOf(COMPUTER)
    renderShell('/', { unread: 12 })
    const inbox = await screen.findByRole('link', { name: 'Inbox, 12 unread' })
    expect(inbox).toHaveTextContent('9+')
  })

  it('shows a top row only for a screen with actions of its own', () => {
    windowOf(COMPUTER)
    fakeServer({ count_notifications: () => ({ unread: 0 }) })
    const plain = renderSignedIn(<Shell>Plain</Shell>)
    expect(document.querySelector('.topbar')).toBeNull()
    plain.unmount()
    renderSignedIn(<Shell actions={<button type="button">Edit layout</button>}>Home</Shell>)
    expect(screen.getByRole('button', { name: 'Edit layout' }).parentElement).toHaveClass(
      'topbar-actions',
    )
  })

  it('swaps the sidebar for the tab bar when the window narrows, and back', () => {
    const resize = windowOf(COMPUTER)
    renderShell()
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('side-tabs')
    resize(PHONE)
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('tabbar')
    resize(COMPUTER)
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('side-tabs')
  })
})

describe('the lit tab', () => {
  it.each([
    ['/', 'Home'],
    ['/spending/activity', 'Spending'],
    ['/spending/cat-1', 'Spending'],
    ['/payday/bills', 'Payday'],
    ['/goals/trips/2026-12-10/2026-12-14', 'Goals'],
    ['/wealth/accounts/acct-1', 'Wealth'],
  ])('on %s is %s, marked as the current page', (route, label) => {
    renderShell(route)
    const current = mainMenu()
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual([label])
    expect(current[0]).toHaveClass('active')
  })

  it.each(['/inbox', '/alerts', '/settings/banks', '/chat'])('on %s is none', (route) => {
    renderShell(route)
    for (const link of mainMenu().getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current')
    }
  })
})

/** The page under the shell's header, which carries the place of its tab. */
const page = () => document.querySelector('.page')!

describe('place colors', () => {
  it.each([PHONE, PHONE_SIDEWAYS, COMPUTER])(
    'mark each tab link with its place, so the lit one wears its color (%o)',
    (size) => {
      windowOf(size)
      renderShell('/goals')
      const places = mainMenu()
        .getAllByRole('link')
        .map((link) => link.getAttribute('data-place'))
      expect(places).toEqual(['home', 'spend', 'pay', 'goal', 'wealth'])
      expect(mainMenu().getByRole('link', { current: 'page' })).toHaveAttribute(
        'data-place',
        'goal',
      )
    },
  )

  it.each([
    ['/', 'home'],
    ['/spending', 'spend'],
    ['/spending/activity', 'spend'],
    ['/payday', 'pay'],
    ['/payday/bills', 'pay'],
    ['/goals', 'goal'],
    ['/wealth', 'wealth'],
    ['/wealth/debts', 'wealth'],
  ])('set the page on %s to the %s place, its deeper pages included', (route, place) => {
    renderShell(route)
    expect(page()).toHaveAttribute('data-place', place)
  })

  it.each(['/inbox', '/settings/banks', '/chat'])('leave %s, in no tab, without one', (route) => {
    renderShell(route)
    expect(page()).not.toHaveAttribute('data-place')
  })
})

describe('the tab keys', () => {
  it('switch tabs with 1 to 5', () => {
    renderShell('/inbox')
    fireEvent.keyDown(document.body, { key: '3' })
    expect(address()).toBe('/payday')
    fireEvent.keyDown(document.body, { key: '5' })
    expect(address()).toBe('/wealth')
    fireEvent.keyDown(document.body, { key: '1' })
    expect(address()).toBe('/')
  })

  it('switch tabs on a computer too', () => {
    windowOf(COMPUTER)
    renderShell()
    fireEvent.keyDown(document.body, { key: '2' })
    expect(address()).toBe('/spending')
  })

  it('type into a field instead of switching', () => {
    renderShell('/inbox')
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: '2' })
    expect(address()).toBe('/inbox')
  })

  it('leave a number pressed with a modifier to the browser', () => {
    renderShell('/inbox')
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: '2', metaKey: true })
    fireEvent.keyDown(document.body, { key: '2', altKey: true })
    expect(address()).toBe('/inbox')
  })

  it('stop listening once the shell is gone', () => {
    const { unmount } = renderShell('/inbox')
    const listen = vi.spyOn(document, 'removeEventListener')
    unmount()
    expect(listen).toHaveBeenCalledWith('keydown', expect.any(Function))
  })
})
