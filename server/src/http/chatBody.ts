// What POST /api/chat takes: the question, and where it was asked. The
// screen line is checked here, at the door, then kept to one plain line and
// capped (chat/screen.ts): too long is trimmed, far too long or the wrong
// shape is refused.

import { z } from 'zod'
import {
  CARD_LABEL_MAX,
  FIGURE_MAX,
  plainLine,
  RAW_MAX,
  SCREEN_MAX,
  type ScreenContext,
} from '../chat/screen.js'

/** A string kept as a plain line of at most `max`; refused when far too long or empty once cleaned. */
function plainText(max: number) {
  return z
    .string()
    .max(RAW_MAX)
    .transform((text) => plainLine(text, max))
    .pipe(z.string().min(1))
}

export const screenContextSchema = z.strictObject({
  screen: plainText(SCREEN_MAX),
  card: z
    .strictObject({
      label: plainText(CARD_LABEL_MAX),
      figure: plainText(FIGURE_MAX).optional(),
    })
    .optional(),
}) satisfies z.ZodType<ScreenContext, unknown>

export const chatBody = z.object({
  message: z.string(),
  context: screenContextSchema.optional(),
})

/** Said when the screen a question came from could not be read. */
export const UNREADABLE_SCREEN = 'Leeway could not tell which screen this was asked on. Ask again.'

/** Why a body was refused: a bad screen line (a bug, never the owner's doing), or no question. */
export function refusal(error: z.ZodError): string {
  const aboutContext = error.issues.some((issue) => issue.path[0] === 'context')
  return aboutContext ? UNREADABLE_SCREEN : 'Type a question first.'
}
