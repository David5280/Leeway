// Where a question in Chat was asked: the screen the owner had open and,
// when they pressed and held a card, that card's name and the figure it
// showed. The model gets it as one short line, so "why is this so high?"
// can be answered about the right thing.
//
// The line opens the question's own message, not the cached instructions
// or the context after them: everything before the newest message is the
// same whichever screen a question comes from, so the prompt cache keeps
// serving the earlier conversation. Only the question itself is kept, so
// the line never joins the history the owner sees or later questions send.
//
// It comes from the owner's own app, but over the network like any input,
// so it is checked at the door (http/chat.ts), kept to plain text and
// capped here, and the model is told it is data, never instructions
// (prompt.ts). Pure and free of dependencies, so the web app trims with
// the same rules before it sends.

/** The longest screen name kept, like "Category: Groceries". */
export const SCREEN_MAX = 60

/** The longest card name kept, like "Until payday". */
export const CARD_LABEL_MAX = 60

/** The longest figure kept, like "$1,180". */
export const FIGURE_MAX = 30

/** Anything longer than this is refused outright rather than trimmed. */
export const RAW_MAX = 500

export interface ScreenContext {
  /** The screen, like "Payday" or "Category: Groceries". */
  screen: string
  /** The card pressed and held, if the question came from one. */
  card?: { label: string; figure?: string }
}

/**
 * Text as one plain line: control and invisible characters and angle
 * brackets dropped (so it cannot pose as markup or a new line of the
 * prompt), runs of spaces joined, and cut to `max` characters.
 */
export function plainLine(text: string, max: number): string {
  return text
    .replace(/[\p{C}<>]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()
}

/** The line the model gets, like "Asked from: Payday, card Until payday showing $1,180". */
export function askedFromLine({ screen, card }: ScreenContext): string {
  if (!card) return `Asked from: ${screen}`
  const figure = card.figure ? ` showing ${card.figure}` : ''
  return `Asked from: ${screen}, card ${card.label}${figure}`
}

/**
 * The question as the model gets it: the screen line, a blank line, then
 * the owner's words; the words alone when the screen is not known.
 */
export function withAskedFrom(question: string, askedFrom?: ScreenContext): string {
  return askedFrom ? `${askedFromLine(askedFrom)}\n\n${question}` : question
}
