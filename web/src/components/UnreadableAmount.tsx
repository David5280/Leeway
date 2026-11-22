// The line a money field shows when what was typed cannot be read, shared by
// every form that takes an amount. Its form keeps Save off meanwhile, so a
// typo is named rather than saved as none, or $0, in its place.

import { isUnreadableMoney } from '../lib/format'

/** What the line says. */
export const UNREADABLE_AMOUNT = "Couldn't read that amount."

/** The line for a field holding `text`: shown only when it is typed but not an amount. */
export function UnreadableAmount({ text }: { text: string }) {
  if (!isUnreadableMoney(text)) return null
  return (
    <span className="small over" role="alert">
      {UNREADABLE_AMOUNT}
    </span>
  )
}
