// A value to paste somewhere else, like the connector address, with a Copy
// button; and the copying itself, for a button that copies something longer.

import { useEffect, useState } from 'react'

/**
 * Copies text on demand. `copied` shows a moment of confirmation; `failed`
 * means the browser refused, so the person can copy by hand.
 */
export function useCopy() {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  // The "Copied" confirmation fades back to "Copy" after a moment.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setFailed(false)
    } catch {
      // Clipboard access can be blocked (an insecure page, a strict browser).
      setFailed(true)
    }
  }

  return { copy, copied, failed }
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const { copy, copied, failed } = useCopy()
  return (
    <div className="copy-field">
      <code className="code" aria-label={label}>
        {value}
      </code>
      <button type="button" className="btn small" onClick={() => void copy(value)}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      {failed && (
        <span className="small muted" role="status">
          Your browser blocked copying. Select the text and copy it instead.
        </span>
      )}
    </div>
  )
}
