// Ask Leeway's button: a round button with the logo in the bottom right of
// every screen, in the same corner on every frame (shell/frame.ts):
//   - a phone: just above the tab bar;
//   - a phone turned sideways: at the foot, clear of the home indicator;
//   - a computer: at the foot of the page.
// Pressed, it swings open into the box (AskBox.tsx), which covers it while
// open and swings back into it when closed, the logo spinning back into
// place as it returns and focus handed back to it.

import { useEffect, useRef, useState } from 'react'
import type { Frame } from '../shell/frame'
import { Logo } from '../ui'
import { AskBox } from './AskBox'
import { useAskControls, type AskControls } from './AskProvider'
import { usePresence } from './usePresence'

/** How long the box takes to swing back into the button, in milliseconds; styles/askMotion.css matches it. */
export const BOX_EXIT_MS = 200

export function AskFab({ ask, frame }: { ask: AskControls; frame: Frame }) {
  const button = useRef<HTMLButtonElement>(null)
  const { boxOpen, claimRefocus } = ask
  const box = usePresence(boxOpen, BOX_EXIT_MS)
  const returns = useReturns(boxOpen)

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
        {/* A new key each time the box closes restarts the logo's spin back into place. */}
        <span className="ask-fab-logo" key={returns} data-spin={returns > 0}>
          <Logo size={36} />
        </span>
      </button>
      {box.mounted && <AskBox ask={ask} leaving={box.leaving} />}
    </div>
  )
}

/** How many times the box has closed since this button appeared; the first open never counts. */
function useReturns(boxOpen: boolean): number {
  const [returns, setReturns] = useState(0)
  const [wasOpen, setWasOpen] = useState(boxOpen)
  // Counted while rendering, as React suggests for state that follows a prop.
  if (wasOpen !== boxOpen) {
    setWasOpen(boxOpen)
    if (!boxOpen) setReturns(returns + 1)
  }
  return returns
}

/**
 * Ask Leeway's controls when it is offered on this screen: with an AI key,
 * and not on the full Chat page, which is the conversation itself.
 */
export function useAskOffered(): AskControls | null {
  const ask = useAskControls()
  return ask?.available && !ask.onChatPage ? ask : null
}
