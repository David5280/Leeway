// An answer's words, with its links to the app's own screens made real, so
// chat is also a way to find things: "[Payday](/payday)" becomes a link to
// Payday. Only a path to a screen the router answers is ever a link
// (screens.ts, isAppLink); an outside address, or a screen that does not
// exist, shows as its words alone and can never be followed.
//
// Followed from the phone's sheet, the link takes the sheet's place in the
// history, so the sheet closes and Back returns to the screen it was over.
// From the computer's panel or the Chat page it is an ordinary link.

import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useAskControls } from '../../components/ask/AskProvider'
import { isAppLink } from '../../components/ask/screens'

/** A markdown link, "[words](address)", on one line, with sane lengths. */
const LINK = /\[([^\]\n]{1,80})\]\(([^)\s]{1,200})\)/g

/** A piece of an answer: plain words, or a link to one of the app's screens. */
export type AnswerPiece = { text: string } | { text: string; to: string }

/** Splits an answer into its words and its links, keeping only links to the app's screens. */
export function answerPieces(answer: string): AnswerPiece[] {
  const pieces: AnswerPiece[] = []
  let at = 0
  for (const match of answer.matchAll(LINK)) {
    const [whole, words, address] = match as unknown as [string, string, string]
    if (match.index > at) pieces.push({ text: answer.slice(at, match.index) })
    pieces.push(isAppLink(address) ? { text: words, to: address } : { text: words })
    at = match.index + whole.length
  }
  if (at < answer.length) pieces.push({ text: answer.slice(at) })
  return pieces
}

export function AnswerText({ text }: { text: string }) {
  const replace = useAskControls()?.sheetOpen ?? false
  return answerPieces(text).map((piece, index) =>
    'to' in piece ? (
      <Link key={index} to={piece.to} replace={replace} className="chat-link">
        {piece.text}
      </Link>
    ) : (
      <Fragment key={index}>{piece.text}</Fragment>
    ),
  )
}
