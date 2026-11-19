// The Scriptable script, served by this server so it always matches it: to
// download as a file, or to copy and paste into a new script in Scriptable.

import { useQuery } from '@tanstack/react-query'
import { requestText } from '../../../api/client'
import { useCopy } from '../../../components/CopyField'
import { ErrorNote } from '../../../components/ui'

export const WIDGET_SCRIPT_PATH = '/api/widget/script'

export function WidgetScript() {
  // Read ahead, so Copy can write it at once: a browser only lets a page
  // copy straight after a tap, not after waiting on the network.
  const script = useQuery({
    queryKey: ['widget-script'],
    queryFn: () => requestText(WIDGET_SCRIPT_PATH),
    staleTime: Infinity,
  })
  const { copy, copied, failed } = useCopy()

  return (
    <div className="stack-sm">
      <h3>Script</h3>
      <div className="row wrap">
        <button
          type="button"
          className="btn"
          disabled={!script.data}
          onClick={() => script.data && void copy(script.data)}
        >
          {copied ? 'Copied the script' : 'Copy the script'}
        </button>
        <a className="btn" href={WIDGET_SCRIPT_PATH} download="Leeway.js">
          Download Leeway.js
        </a>
      </div>
      {failed && (
        <span className="small muted" role="status">
          Your browser blocked copying. Download the file instead.
        </span>
      )}
      <ErrorNote error={script.error} />
    </div>
  )
}
