// Holds off a new build's reload while a part of the app the page cannot see
// is mid-task, such as Plaid's window or an Ask Leeway answer still arriving.

import { useEffect, useId } from 'react'
import { holdReload } from './pageBusy'

/** Holds off a reload while `holding` is true, and lets go when it turns false or the part unmounts. */
export function useReloadHold(holding: boolean): void {
  // Each part holds under its own id, so one letting go never frees another's hold.
  const reason = useId()
  useEffect(() => {
    holdReload(reason, holding)
    return () => holdReload(reason, false)
  }, [reason, holding])
}
