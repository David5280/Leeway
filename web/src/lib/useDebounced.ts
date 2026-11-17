import { useEffect, useState } from 'react'

/** The value, once it has stopped changing for a moment. Keeps typing from firing a request per key. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}
