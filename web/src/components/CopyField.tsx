// A value to paste somewhere else, like the connector address, with a Copy button.

import { useEffect, useState } from 'react'

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  // The "Copied" confirmation fades back to "Copy" after a moment.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setFailed(false)
    } catch {
      // Clipboard access can be blocked (an insecure page, a strict browser); the text stays selectable.
      setFailed(true)
    }
  }

  return (
    <div className="copy-field">
      <code className="code" aria-label={label}>
        {value}
      </code>
      <button type="button" className="btn small" onClick={() => void copy()}>
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
