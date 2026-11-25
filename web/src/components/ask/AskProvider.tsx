// Ask Leeway on every screen: one conversation for the whole app, opened from
// the round logo button in the corner, a card pressed and held, or the "/"
// key, into a box anchored to that corner (AskFab.tsx).
//
// It lives above the routes, so a question keeps streaming while the box is
// closed or the owner moves between screens, and a typed draft survives both.
// Two contexts keep typing cheap: the controls (open, close, which screen)
// change rarely and are read by every card; the talk (the draft, the answer
// streaming) changes with each key and is read only by the conversation.
//
// Each page draws its own frame, so the button and box are drawn anew on
// every tab. What must outlast that is kept here: whether the box is open,
// how far it was scrolled, and whether focus goes back to the button.
// Without an AI key none of it exists: `available` is false everywhere.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useChatAvailable, type ScreenContext } from '../../api/chat'
import { useAsk, type Asking } from '../../pages/chat/useAsk'
import { holdReload } from '../../lib/update/pageBusy'
import { paths } from '../../routes'
import { screenName } from './screens'

/** A card the next question is about, from a press and hold: its name and figure. */
export type CardAbout = NonNullable<ScreenContext['card']>

/** How the box was closed: focus goes back to the button unless the owner pressed something that takes it. */
export interface Closing {
  refocus?: boolean
}

export interface AskControls {
  /** Whether Ask Leeway is on: only with an AI key on the server. */
  available: boolean
  /** The screen's name, like "Payday", for the box and the question. */
  screen: string
  /** Whether this is the full Chat page, where the button steps aside. */
  onChatPage: boolean
  /** The box is open over the corner. Never on the full Chat page. */
  boxOpen: boolean
  /** Opens the box, about a card when given one, and moves focus to its question field. */
  open: (card?: CardAbout | null) => void
  /** Shrinks the box back into the button. The conversation, and any answer streaming, carry on. */
  close: (closing?: Closing) => void
  /** Called as a link in an answer is followed: the box closes, and focus goes to the new screen's button. */
  followLink: (to: string) => void
  /** Whether the button should take focus now that the box closed; true once per close. */
  claimRefocus: () => boolean
  /** How far the box's conversation was scrolled, kept across tabs; null until it is. */
  boxScroll: RefObject<number | null>
  /** Lets a page name itself more exactly, like "Category: Groceries". */
  nameScreen: (pathname: string, name: string) => void
}

export interface AskTalk extends Omit<Asking, 'ask'> {
  draft: string
  setDraft: (draft: string) => void
  /** The card the next question carries, if any. */
  about: CardAbout | null
  /** Asks about the screen alone, letting the card go. */
  forgetAbout: () => void
  /** Sends a question with the screen (and card) it was asked from. */
  ask: (question: string) => void
  /** Whether the question field should take focus once it is on screen. */
  wantsFocus: boolean
  /** Called by the field once it has taken focus. */
  focused: () => void
}

const ControlsContext = createContext<AskControls | null>(null)
const TalkContext = createContext<AskTalk | null>(null)

/** The screen's name, unless the page gave a more exact one for this address. */
function useScreen(pathname: string) {
  const [named, setNamed] = useState<{ pathname: string; name: string } | null>(null)
  const nameScreen = useCallback((at: string, name: string) => setNamed({ pathname: at, name }), [])
  const screen = named?.pathname === pathname ? named.name : screenName(pathname)
  return { screen, nameScreen }
}

/**
 * Whether the box is open, and whether focus goes back to the button once it
 * closes. The box belongs to the screen it was opened on: moving to another
 * screen closes it in the same render as the move, so the old screen's
 * button never takes focus on its way out. The wish to refocus is a ref, not
 * state: the button that reads it may be the next screen's.
 */
function useBox(pathname: string, onChatPage: boolean) {
  const [openOn, setOpenOn] = useState<string | null>(null)
  const refocus = useRef(false)
  // Left behind by a move to another screen: forget it, so Back never reopens it.
  if (openOn !== null && openOn !== pathname) setOpenOn(null)

  const show = useCallback(() => setOpenOn(pathname), [pathname])
  const close = useCallback(({ refocus: back = true }: Closing = {}) => {
    refocus.current = back
    setOpenOn(null)
  }, [])
  const followLink = useCallback(
    (to: string) => {
      refocus.current = true
      // A link to this same screen moves nowhere, so it closes the box itself.
      if (to === pathname) setOpenOn(null)
    },
    [pathname],
  )
  const claimRefocus = useCallback(() => {
    const claimed = refocus.current
    refocus.current = false
    return claimed
  }, [])
  // The full Chat page is the conversation itself: no box over it.
  const boxOpen = openOn === pathname && !onChatPage
  return { boxOpen, show, close, followLink, claimRefocus }
}

export function AskProvider({ children }: { children: ReactNode }) {
  // Asked for by the shell on every screen; here it only listens (api/chat.ts).
  const available = useChatAvailable({ ask: false }) === true
  const location = useLocation()
  const { screen, nameScreen } = useScreen(location.pathname)
  const onChatPage = location.pathname === paths.chat()
  const { boxOpen, show, close, followLink, claimRefocus } = useBox(location.pathname, onChatPage)
  const boxScroll = useRef<number | null>(null)

  const [draft, setDraft] = useState('')
  const [about, setAbout] = useState<CardAbout | null>(null)
  const [wantsFocus, setWantsFocus] = useState(false)
  const { ask: send, ...asking } = useAsk(setDraft)

  // A new build waits while a question is drafted or answered (lib/update/pageBusy.ts).
  const busy = draft.trim() !== '' || asking.pending !== null
  useEffect(() => {
    holdReload('ask', busy)
    return () => holdReload('ask', false)
  }, [busy])

  // Opening twice in a moment (a hold, then its context menu) only refocuses the field.
  const open = useCallback(
    (card: CardAbout | null = null) => {
      setAbout(card)
      setWantsFocus(true)
      // On the full Chat page "/" focuses its own field; there is no box to open.
      if (!onChatPage) show()
    },
    [onChatPage, show],
  )

  const controls = useMemo<AskControls>(
    () => ({
      available,
      screen,
      onChatPage,
      boxOpen: available && boxOpen,
      open,
      close,
      followLink,
      claimRefocus,
      boxScroll,
      nameScreen,
    }),
    [available, screen, onChatPage, boxOpen, open, close, followLink, claimRefocus, nameScreen],
  )

  // The full Chat page asks about no screen: it is the conversation itself.
  const context: ScreenContext | undefined = onChatPage
    ? undefined
    : { screen, ...(about ? { card: about } : {}) }
  const talk: AskTalk = {
    ...asking,
    draft,
    setDraft,
    about,
    forgetAbout: () => setAbout(null),
    ask: (question) => {
      send(question, context)
      setAbout(null)
    },
    wantsFocus,
    focused: () => setWantsFocus(false),
  }

  return (
    <ControlsContext.Provider value={controls}>
      <TalkContext.Provider value={talk}>{children}</TalkContext.Provider>
    </ControlsContext.Provider>
  )
}

/** Ask Leeway's controls, or null outside the provider (where it simply is not offered). */
export function useAskControls(): AskControls | null {
  return useContext(ControlsContext)
}

/** The conversation's state; only inside the provider. */
export function useAskTalk(): AskTalk {
  const talk = useContext(TalkContext)
  if (!talk) throw new Error('useAskTalk must be used inside AskProvider')
  return talk
}

/**
 * Names the screen more exactly than its address can, like "Category:
 * Groceries", for the box and the questions asked from it. Nothing happens
 * until the name is known, or outside the provider.
 */
export function useScreenName(name: string | undefined): void {
  const nameScreen = useAskControls()?.nameScreen
  const { pathname } = useLocation()
  useEffect(() => {
    if (name) nameScreen?.(pathname, name)
  }, [nameScreen, pathname, name])
}
