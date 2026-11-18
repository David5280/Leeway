// Waiting for a value to settle before acting on it.

import { useEffect, useState } from 'react'

/**
 * The value, once it has stopped changing for a moment. Keeps typing from
 * firing a request per key.
 *
 * Values are compared by content (as JSON), so a caller can pass a fresh
 * object each render without restarting the wait or re-rendering forever.
 * Values must therefore be plain JSON: strings, numbers, booleans, null,
 * arrays and objects.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value)
  const key = JSON.stringify(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      // Keep the current object when the content is the same, so nothing re-renders.
      setSettled((current) => (JSON.stringify(current) === key ? current : (JSON.parse(key) as T)))
    }, ms)
    return () => clearTimeout(timer)
  }, [key, ms])
  return settled
}
