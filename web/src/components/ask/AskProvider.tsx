// Ask Leeway on every screen: one conversation for the whole app, opened from
// the bar above the tabs, a card pressed and held, or the "/" key.
//
// It lives above the routes, so a question keeps streaming and a typed draft
// survives moving between screens. Two contexts keep typing cheap: the
// controls (open, close, which screen) change rarely and are read by every
// card; the talk (the draft, the answer streaming) changes with each key and
// is read only by the conversation.
//
// Where it opens depends on the frame (shell/frame.ts):
//   - a phone: a sheet over the screen, entered as a history entry of the
//     same address, so Back closes it and the screen under it, scroll
//     included, is never left;
//   - a computer: a panel beside the page, open or collapsed as this browser
//     last left it (panelMemory.ts). Each page draws its own frame, so the
//     panel is drawn anew on every tab; its scroll is kept here, above the
//     pages, so it opens on each tab where the owner left it.
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
import { useLocation, useNavigate } from 'react-router-dom'
import { useChatAvailable, type ScreenContext } from '../../api/chat'
import { useAsk, type Asking } from '../../pages/chat/useAsk'
import { paths } from '../../routes'
import { useFrame } from '../shell/frame'
import { readPanelOpen, writePanelOpen } from './panelMemory'
import { screenName } from './screens'

/** A card the next question is about, from a press and hold: its name and figure. */
export type CardAbout = NonNullable<ScreenContext['card']>

/** The mark on a history entry that shows the phone's sheet. */
const SHEET_STATE = 'askLeeway'

/** Whether a history entry's state shows the sheet. */
function showsSheet(state: unknown): boolean {
  return typeof state === 'object' && state !== null && SHEET_STATE in state
}

export interface AskControls {
  /** Whether Ask Leeway is on: only with an AI key on the server. */
  available: boolean
  /** The screen's name, like "Payday", for the bar and the question. */
  screen: string
  /** Whether this is the full Chat page, where the bar and panel step aside. */
  onChatPage: boolean
  /** The phone's sheet is showing. */
  sheetOpen: boolean
  /** The computer's panel is open, not collapsed to its rail. */
  panelOpen: boolean
  /** Opens the conversation, about a card when given one, and moves focus to its box. */
  open: (card?: CardAbout | null) => void
  /** Closes the phone's sheet, back to the screen under it. */
  closeSheet: () => void
  setPanelOpen: (open: boolean) => void
  /** How far the computer's panel was scrolled, kept across tabs; null until it is. */
  panelScroll: RefObject<number | null>
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
  /** Whether the question box should take focus once it is on screen. */
  wantsFocus: boolean
  /** Called by the box once it has taken focus. */
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

/** The computer's panel, open or collapsed, as this browser last left it. */
function usePanel() {
  const [panelOpen, setOpen] = useState(readPanelOpen)
  const setPanelOpen = useCallback((open: boolean) => {
    setOpen(open)
    writePanelOpen(open)
  }, [])
  return { panelOpen, setPanelOpen }
}

export function AskProvider({ children }: { children: ReactNode }) {
  // Asked for by the shell on every screen; here it only listens (api/chat.ts).
  const available = useChatAvailable({ ask: false }) === true
  const frame = useFrame()
  const location = useLocation()
  const navigate = useNavigate()
  const { screen, nameScreen } = useScreen(location.pathname)
  const { panelOpen, setPanelOpen } = usePanel()
  const panelScroll = useRef<number | null>(null)
  const onChatPage = location.pathname === paths.chat()
  const sheetOpen = available && frame !== 'sidebar' && !onChatPage && showsSheet(location.state)

  const [draft, setDraft] = useState('')
  const [about, setAbout] = useState<CardAbout | null>(null)
  const [wantsFocus, setWantsFocus] = useState(false)
  const { ask: send, ...asking } = useAsk(setDraft)

  // Set the moment the sheet is asked for, so a second open in the same
  // moment (a hold, then its context menu) never adds a second entry.
  const sheetAsked = useRef(sheetOpen)
  useEffect(() => {
    sheetAsked.current = sheetOpen
  }, [sheetOpen])

  const open = useCallback(
    (card: CardAbout | null = null) => {
      setAbout(card)
      setWantsFocus(true)
      if (onChatPage) return
      if (frame === 'sidebar') return setPanelOpen(true)
      if (sheetAsked.current) return
      sheetAsked.current = true
      const state = typeof location.state === 'object' ? location.state : {}
      navigate(location, { state: { ...state, [SHEET_STATE]: true } })
    },
    [onChatPage, frame, location, navigate, setPanelOpen],
  )

  const closeSheet = useCallback(() => {
    if (sheetAsked.current) navigate(-1)
  }, [navigate])

  const controls = useMemo<AskControls>(
    () => ({
      available,
      screen,
      onChatPage,
      sheetOpen,
      panelOpen,
      open,
      closeSheet,
      setPanelOpen,
      panelScroll,
      nameScreen,
    }),
    [
      available,
      screen,
      onChatPage,
      sheetOpen,
      panelOpen,
      open,
      closeSheet,
      setPanelOpen,
      nameScreen,
    ],
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
 * Groceries", for the bar and the questions asked from it. Nothing happens
 * until the name is known, or outside the provider.
 */
export function useScreenName(name: string | undefined): void {
  const nameScreen = useAskControls()?.nameScreen
  const { pathname } = useLocation()
  useEffect(() => {
    if (name) nameScreen?.(pathname, name)
  }, [nameScreen, pathname, name])
}
