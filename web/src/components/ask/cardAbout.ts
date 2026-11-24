// What a card pressed and held is about: its name and the figure it shows,
// read from the card as drawn, so every card works without telling Ask
// Leeway anything. Trimmed with the server's own rules (chat/screen.ts).

import { CARD_LABEL_MAX, FIGURE_MAX, plainLine } from '../../../../server/src/chat/screen'
import type { CardAbout } from './AskProvider'

/** Where a card shows its name, most specific first, when it has no label of its own. */
const NAME_SELECTOR =
  '.hero-figure-label, .key-figure-label, .eyebrow, .section-head, .sheet-section-title, h2, h3'

/** Where a card shows its figure: the first amount drawn by <Money>. */
const FIGURE_SELECTOR = '.money'

/** An element's words as one plain line, leaving out words only screen readers hear. */
function shownText(element: Element | null, max: number): string {
  if (!element) return ''
  const copy = element.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('.visually-hidden')) hidden.remove()
  return plainLine(copy.textContent ?? '', max)
}

/**
 * The card's name (its label, or the name it shows) and its first figure.
 * Null when it shows no name at all: the question then carries only the screen.
 */
export function cardAbout(card: HTMLElement, label?: string): CardAbout | null {
  const name =
    plainLine(label ?? '', CARD_LABEL_MAX) ||
    shownText(card.querySelector(NAME_SELECTOR), CARD_LABEL_MAX)
  if (!name) return null
  const figure = shownText(card.querySelector(FIGURE_SELECTOR), FIGURE_MAX)
  return figure ? { label: name, figure } : { label: name }
}
