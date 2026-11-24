// Ask Leeway's button: a round button with the logo in the bottom right of
// every screen, in the same corner on every frame (shell/frame.ts):
//   - a phone: just above the tab bar;
//   - a phone turned sideways: at the foot, clear of the home indicator;
//   - a computer: at the foot of the page.
// Pressed, it grows into the box (AskBox.tsx), which covers it while open
// and shrinks back into it when closed, handing focus back to it.

import { useEffect, useRef } from 'react'
import type { Frame } from '../shell/frame'
import { Logo } from '../ui'
import { AskBox } from './AskBox'
import { useAskControls, type AskControls } from './AskProvider'
import { usePresence } from './usePresence'

/** How long the box takes to shrink back into the button, in milliseconds; styles/ask.css matches it. */
export const BOX_EXIT_MS = 140

export function AskFab({ ask, frame }: { ask: AskControls; frame: Frame }) {
  const button = useRef<HTMLButtonElement>(null)
  const { boxOpen, claimRefocus } = ask
  const box = usePresence(boxOpen, BOX_EXIT_MS)

  // Focus comes back once the box closes; also on a new page's button, after a link in an answer.
  useEffect(() => {
    if (!boxOpen && claimRefocus()) button.current?.focus()
  }, [boxOpen, claimRefocus])

  return (
    <div className="ask-fab" data-frame={frame}>
      <button
        ref={button}
        type="button"
        className="ask-fab-button"
        aria-label="Ask Leeway"
        aria-haspopup="dialog"
        aria-expanded={boxOpen}
        // Covered by the box while it is open, so out of reach until it closes.
        inert={boxOpen}
        onClick={() => ask.open()}
      >
        <Logo size={30} />
      </button>
      {box.mounted && <AskBox ask={ask} leaving={box.leaving} />}
    </div>
  )
}

/**
 * Ask Leeway's controls when it is offered on this screen: with an AI key,
 * and not on the full Chat page, which is the conversation itself.
 */
export function useAskOffered(): AskControls | null {
  const ask = useAskControls()
  return ask?.available && !ask.onChatPage ? ask : null
}
