// Whether reloading the page now would lose something the owner is doing:
// typing, a sheet or Ask Leeway open, text typed in a field, or a reason held
// by a part of the app the page cannot see (an Ask Leeway draft kept while its
// box is closed, an answer still arriving). buildCheck.ts waits while it is.

/** Reasons held by parts of the app, such as "ask" while a question is drafted or answered. */
const holds = new Set<string>()

/** Holds off a reload for a reason, or lets go of it. */
export function holdReload(reason: string, holding: boolean): void {
  if (holding) holds.add(reason)
  else holds.delete(reason)
}

/** Inputs that hold no typed text, so a value in one is not the owner's work. */
const NOT_TYPED = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** Whether a field takes typed text. */
function takesText(field: Element): field is HTMLInputElement | HTMLTextAreaElement {
  if (field instanceof HTMLTextAreaElement) return true
  return field instanceof HTMLInputElement && !NOT_TYPED.has(field.type)
}

/** Whether focus sits where the owner types. */
function typing(doc: Document): boolean {
  const focused = doc.activeElement
  if (!focused || focused === doc.body) return false
  return (
    takesText(focused) ||
    focused instanceof HTMLSelectElement ||
    focused.closest('[contenteditable]') !== null
  )
}

/** Whether any field on the page holds text, which a reload would throw away. */
function textTyped(doc: Document): boolean {
  return [...doc.querySelectorAll('input, textarea')].some(
    (field) => takesText(field) && field.value.trim() !== '',
  )
}

/** Whether a sheet, Ask Leeway's box or any other dialog is open; each is in the page only while open. */
const dialogOpen = (doc: Document) => doc.querySelector('[role="dialog"], dialog[open]') !== null

export function pageBusy(doc: Document = document): boolean {
  return holds.size > 0 || typing(doc) || dialogOpen(doc) || textTyped(doc)
}
