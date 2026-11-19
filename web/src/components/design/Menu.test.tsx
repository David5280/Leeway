import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Menu, placeMenu, type MenuItem } from './Menu'

const button = (left: number, bottom: number) => ({ left, bottom }) as DOMRect

describe('placeMenu', () => {
  it('sits just under its button, using the room below', () => {
    expect(placeMenu(button(20, 100), 200, { width: 390, height: 844 })).toEqual({
      top: 106,
      left: 20,
      maxHeight: 730,
    })
  })

  it('moves left rather than running off the right edge, but never off the left', () => {
    expect(placeMenu(button(300, 100), 200, { width: 390, height: 844 }).left).toBe(182)
    expect(placeMenu(button(300, 100), 500, { width: 390, height: 844 }).left).toBe(8)
  })
})

function renderMenu(items: MenuItem[]) {
  render(
    <>
      <Menu label="Add or import" button="+" buttonClassName="act-add" items={items} />
      <p>Elsewhere</p>
    </>,
  )
  return screen.getByRole('button', { name: 'Add or import' })
}

const actions = () => [
  {
    key: 'add',
    label: 'Add by hand',
    icon: <span aria-hidden="true">pen</span>,
    onSelect: vi.fn(),
  },
  { key: 'import', label: 'Import a file', onSelect: vi.fn() },
]

describe('Menu', () => {
  it('opens a menu of actions under its button, focusing the first', async () => {
    const trigger = renderMenu(actions())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Add or import' })
    expect(menu.style.top).toMatch(/px$/)
    expect(screen.getByRole('menuitem', { name: 'Add by hand' })).toHaveFocus()
  })

  it('runs an item, closes, and gives focus back to the button', async () => {
    const items = actions()
    const trigger = renderMenu(items)
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Import a file' }))
    expect(items[1]!.onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('moves with the arrow keys, wrapping at both ends, and closes on Escape', async () => {
    const trigger = renderMenu(actions())
    await userEvent.click(trigger)
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Import a file' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Add by hand' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Import a file' })).toHaveFocus()
    await userEvent.keyboard('x')
    expect(screen.getByRole('menuitem', { name: 'Import a file' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on a press outside or a scroll, but not on a press inside', async () => {
    const trigger = renderMenu(actions())
    await userEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await userEvent.click(trigger)
    fireEvent.scroll(document)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('toggles closed from its own button', async () => {
    const trigger = renderMenu(actions())
    await userEvent.click(trigger)
    await userEvent.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('lists choices as radio items and starts on the current one', async () => {
    const trigger = renderMenu([
      { key: 'period', label: 'This period', checked: false, onSelect: () => {} },
      { key: 'all', label: 'All', checked: true, onSelect: () => {} },
    ])
    await userEvent.click(trigger)
    expect(screen.getByRole('menuitemradio', { name: 'This period' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('menuitemradio', { name: 'All' })).toHaveFocus()
  })
})
