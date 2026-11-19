import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { category } from '../../test/fake'
import { CategoryIcon, categoryLook, TRANSFER_COLOR } from './CategoryIcon'
import { CATEGORY_GLYPHS } from './categoryIcons'

describe('categoryLook', () => {
  it("draws a category's own icon in its color", () => {
    const coffee = category('Coffee', { icon: 'coffee', color: '#B5651D' })
    expect(categoryLook(coffee)).toEqual({
      color: '#B5651D',
      glyph: 'coffee',
      initial: 'C',
      unsorted: false,
    })
  })

  it('falls back to the first letter for an icon it does not know, or none', () => {
    expect(categoryLook(category(' pets', { icon: 'unicorn' })).glyph).toBeNull()
    expect(categoryLook(category(' pets', { icon: 'unicorn' })).initial).toBe('P')
    expect(categoryLook(category('Gym')).glyph).toBeNull()
  })

  it('draws every transfer the same quiet way, whatever its category says', () => {
    const moves = category('Transfers', { kind: 'transfer', icon: 'cash', color: '#FF0000' })
    expect(categoryLook(moves)).toMatchObject({ color: TRANSFER_COLOR, glyph: 'swap' })
    expect(categoryLook(category('Coffee'), { transfer: true }).glyph).toBe('swap')
    expect(categoryLook(null, { transfer: true }).unsorted).toBe(false)
  })

  it('asks for a category with a dashed question mark when there is none', () => {
    expect(categoryLook(undefined)).toMatchObject({ glyph: 'question', unsorted: true })
  })

  it('has a glyph for every starter icon name', () => {
    const starters =
      'bag bolt book burger car card cart cash coffee dumbbell fuel gift glass hammer heart inbox key landmark paw plane receipt repeat send shield shirt sparkle swap ticket tool utensils wallet wrench'
    for (const name of starters.split(' ')) expect(CATEGORY_GLYPHS).toHaveProperty(name)
  })
})

describe('CategoryIcon', () => {
  it('is decoration, tinted by the category color, at the size asked for', () => {
    const { container } = render(
      <CategoryIcon
        category={category('Coffee', { icon: 'coffee', color: '#B5651D' })}
        size="lg"
      />,
    )
    const badge = container.firstElementChild!
    expect(badge).toHaveAttribute('aria-hidden', 'true')
    expect(badge).toHaveClass('icon-badge', 'icon-badge-lg')
    expect(badge).toHaveStyle({ '--c': '#B5651D' })
    expect(badge.querySelector('svg')).not.toBeNull()
  })

  it('shows the initial without a glyph, and a dashed ring without a category', () => {
    const { container } = render(
      <>
        <CategoryIcon category={category('Gym')} />
        <CategoryIcon category={null} />
      </>,
    )
    const [gym, none] = [...container.children]
    expect(gym).toHaveTextContent('G')
    expect(gym).toHaveClass('icon-badge-md')
    expect(none).toHaveClass('unsorted')
  })
})
