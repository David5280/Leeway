// Picking the essential categories an emergency fund is sized by: which the
// picker starts ticked, how it lists them (what counts now first, then the
// rest under their group headings), and which ticked ones add nothing
// because they had no spending in the months averaged. Pure, so each rule is
// tested alone.

import type { Category } from '../api/client'
import type { EmergencyView } from './emergencyText'
import { groupBy } from './groups'

/** A heading in the picker and the categories under it. */
export interface EssentialSection {
  title: string
  categories: Category[]
}

/**
 * Whether the essentials can be picked from the card: when spending sizes the
 * fund, or whenever the owner has a pick, so it can always be changed or
 * handed back. Bills alone have no categories to pick.
 */
export function canPickEssentials(view: EmergencyView): boolean {
  return view.essentialsChoice.pickedIds !== null || view.essentials?.from === 'spending'
}

/**
 * The categories ticked when the picker opens: the owner's pick, else the
 * ones Leeway found, else every spending category (when all spending counts).
 */
export function startingTicks(view: EmergencyView, spending: Category[]): string[] {
  return (
    view.essentialsChoice.pickedIds ??
    view.essentials?.categoryIds ??
    spending.map((category) => category.id)
  )
}

/** The picker's sections: what counts now first, then the rest by group, ungrouped as "Other". */
export function essentialSections(spending: Category[], countedIds: string[]): EssentialSection[] {
  const counted = spending.filter((category) => countedIds.includes(category.id))
  const rest = spending.filter((category) => !countedIds.includes(category.id))
  const grouped = groupBy(rest, (category) => category.group).map(({ group, items }) => ({
    title: group ?? 'Other',
    categories: items,
  }))
  const first = counted.length > 0 ? [{ title: 'Counted now', categories: counted }] : []
  return [...first, ...grouped]
}

/** The ticked categories with no spending in the months averaged, by name, in list order. */
export function quietPicks(spending: Category[], ticked: string[], spentIds: string[]): string[] {
  return spending
    .filter((category) => ticked.includes(category.id) && !spentIds.includes(category.id))
    .map((category) => category.name)
}
