// A category's icon in a circle tinted with its color: the same mark for a
// category on every list, picker and sheet. categoryLook is the one map from
// a category (or its absence) to that mark; screens never pick icons or
// colors for categories themselves.

import type { CSSProperties } from 'react'
import type { Category } from '../../api/client'
import { CATEGORY_GLYPHS } from './categoryIcons'

/** What drawing a category needs. */
export type IconCategory = Pick<Category, 'name' | 'color' | 'icon' | 'kind'>

export interface CategoryLook {
  /** The circle's tint and the glyph's color: a hex color or a theme variable. */
  color: string
  /** A glyph from CATEGORY_GLYPHS, or null to show `initial`. */
  glyph: string | null
  initial: string
  /** Drawn with a dashed ring: the transaction still needs a category. */
  unsorted: boolean
}

/** The quiet slate every transfer between the owner's accounts is drawn in. */
export const TRANSFER_COLOR = '#8390A2'

/**
 * How a category is drawn. A transfer always shows the same neutral swap
 * mark, whatever its category says, since it is neither spending nor income.
 * No category shows a question mark in a dashed ring.
 */
export function categoryLook(
  category: IconCategory | null | undefined,
  { transfer = false }: { transfer?: boolean } = {},
): CategoryLook {
  if (transfer || category?.kind === 'transfer') {
    return { color: TRANSFER_COLOR, glyph: 'swap', initial: '', unsorted: false }
  }
  if (!category) return { color: 'var(--muted)', glyph: 'question', initial: '', unsorted: true }
  const glyph = category.icon && category.icon in CATEGORY_GLYPHS ? category.icon : null
  const initial = category.name.trim().charAt(0).toUpperCase()
  return { color: category.color, glyph, initial, unsorted: false }
}

export function CategoryIcon({
  category,
  transfer,
  size = 'md',
}: {
  category: IconCategory | null | undefined
  transfer?: boolean
  /** sm is 32px (pickers), md 40px (list rows), lg 48px (a sheet's header). */
  size?: 'sm' | 'md' | 'lg'
}) {
  const look = categoryLook(category, { transfer })
  const classes = ['icon-badge', `icon-badge-${size}`, look.unsorted ? 'unsorted' : '']
  return (
    <span
      className={classes.filter(Boolean).join(' ')}
      style={{ '--c': look.color } as CSSProperties}
      aria-hidden="true"
    >
      {look.glyph ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {CATEGORY_GLYPHS[look.glyph]}
        </svg>
      ) : (
        look.initial
      )}
    </span>
  )
}
