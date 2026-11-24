// Ask Leeway's places in the frame (Shell.tsx):
//   - AskBar: the slim bar just above the phone's tab bar (or at the foot of
//     a phone turned sideways), naming the screen, one tap from the
//     conversation;
//   - AskSheet: that conversation over the screen on a phone;
//   - AskPanel: on a computer, the conversation in a panel on the right that
//     stays open across tabs, or collapsed to a slim rail.
// All of them show the one conversation (pages/chat/ChatThread.tsx).

import { ChatThread } from '../../pages/chat/ChatThread'
import { Sheet } from '../design/Sheet'
import { Icon } from '../ui'
import { useAskControls, type AskControls } from './AskProvider'

/** What the bar and the empty box say, naming the screen: "Ask about Payday". */
export function askPrompt(screen: string): string {
  return `Ask about ${screen}`
}

/** The bar above the tabs: looks like a box to type in, opens the conversation over the screen. */
export function AskBar({ ask }: { ask: AskControls }) {
  return (
    <div className="ask-dock">
      <button
        type="button"
        className="ask-bar"
        aria-haspopup="dialog"
        aria-label={`Ask Leeway: ${askPrompt(ask.screen)}`}
        onClick={() => ask.open()}
      >
        <Icon name="sparkle" size={18} />
        <span className="ask-bar-prompt">{askPrompt(ask.screen)}</span>
      </button>
    </div>
  )
}

/** The phone's conversation over the screen; Close, Escape, a swipe down or Back closes it. */
export function AskSheet({ ask }: { ask: AskControls }) {
  return (
    <Sheet title="Ask Leeway" onClose={ask.closeSheet}>
      <div className="ask-sheet-body">
        <ChatThread placeholder={askPrompt(ask.screen)} />
      </div>
    </Sheet>
  )
}

/** The computer's panel beside the page, or the slim rail it collapses to. */
export function AskPanel({ ask }: { ask: AskControls }) {
  if (!ask.panelOpen) {
    return (
      <div className="ask-rail">
        <button
          type="button"
          className="ask-rail-open"
          aria-expanded="false"
          aria-label={`Open Ask Leeway: ${askPrompt(ask.screen)}`}
          title="Ask Leeway"
          onClick={() => ask.open()}
        >
          <Icon name="sparkle" size={20} />
        </button>
      </div>
    )
  }
  return (
    <aside className="ask-panel" aria-labelledby="ask-panel-title">
      <div className="ask-panel-head">
        <h2 id="ask-panel-title" className="ask-panel-title">
          <Icon name="sparkle" size={18} />
          Ask Leeway
        </h2>
        <button
          type="button"
          className="ask-panel-collapse"
          aria-expanded="true"
          aria-label="Collapse Ask Leeway"
          onClick={() => ask.setPanelOpen(false)}
        >
          <Icon name="forward" size={18} />
        </button>
      </div>
      <ChatThread placeholder={askPrompt(ask.screen)} />
    </aside>
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
