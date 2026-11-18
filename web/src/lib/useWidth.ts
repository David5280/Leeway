// Tracks an element's rendered width, so a chart can draw at its real pixel
// size. Scaling a fixed-size drawing instead shrinks its labels in narrow cards.

import { useEffect, useState } from 'react'

/**
 * Pass the returned ref to the element to measure. Until it has been
 * measured, and where ResizeObserver is missing, the fallback width is used.
 */
export function useWidth<T extends Element>(fallback: number): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      // A hidden element measures 0; keep the last real width instead.
      const measured = Math.round(entry?.contentRect.width ?? 0)
      if (measured > 0) setWidth(measured)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width]
}
