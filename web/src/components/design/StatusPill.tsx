// A short status word in a tinted pill, with an icon so the status never
// rests on color alone: "On track", "Watch", "Over", or a quiet fact like
// "Pending".

import type { ReactNode } from 'react'

export type Status = 'ok' | 'watch' | 'over' | 'info' | 'quiet'

/** What each status says when no label is given. */
export const STATUS_WORDS: Record<Status, string> = {
  ok: 'On track',
  watch: 'Watch',
  over: 'Over',
  info: 'Note',
  quiet: '',
}

/** A small mark for each status, so it reads without its color. */
const MARKS: Record<Status, ReactNode> = {
  ok: <path d="M5 12l4 4 10-10" />,
  watch: <path d="M12 5v8M12 17v.5" />,
  over: <path d="M7 7l10 10M17 7L7 17" />,
  info: <path d="M12 11v6M12 7v.5" />,
  quiet: null,
}

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const mark = MARKS[status]
  return (
    <span className={`pill pill-${status}`}>
      {mark && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {mark}
        </svg>
      )}
      {label ?? STATUS_WORDS[status]}
    </span>
  )
}
