// A short note at the foot of the screen after a one-tap change, with a way
// to take it back: "Comcast added to Bills  Undo". It goes by itself after a
// few seconds, or at once on Undo or its close button. Screen readers hear it
// as a status, without moving focus.

import { useEffect } from 'react'
import { Icon } from './ui'

/** How long a toast stays: long enough to read it and reach Undo. */
export const TOAST_MS = 8000

export function Toast({
  message,
  actionLabel,
  onAction,
  onClose,
}: {
  message: string
  actionLabel: string
  onAction: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, TOAST_MS)
    return () => clearTimeout(timer)
  }, [onClose])
  return (
    <div className="toast" role="status">
      <span className="grow">{message}</span>
      <button type="button" className="linkbtn strong tap" onClick={onAction}>
        {actionLabel}
      </button>
      <button type="button" className="toast-close tap" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
