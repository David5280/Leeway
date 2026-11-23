// Choosing a paystub to read: who reads it, what is sent and what is kept,
// said plainly before the file leaves the browser. Shared by the pension
// import and the full review.

import { ErrorNote, Loading } from '../../../../components/ui'
import { ACCEPT } from './review'

/** What the owner sees before choosing a file: who reads it, what is sent, and what is kept. */
export function ChooseFile({
  readerName,
  reads = 'its pay, pension, 401(k), 457, 403(b) and HSA figures',
  reading,
  problem,
  error,
  onFile,
  onCancel,
}: {
  readerName: string
  /** What the reader takes from the file, after "Claude reads". */
  reads?: string
  reading: boolean
  problem: string | null
  error: unknown
  onFile: (file: File) => void
  onCancel: () => void
}) {
  return (
    <div className="stack paystub">
      <p className="small">
        Choose a PDF or a photo of a paystub. {readerName} reads {reads}, and you check each one
        before anything is saved.
      </p>
      <p className="small">
        A paystub is a page or two. A longer file is turned away before it is read, so save just the
        pages with your pay figures.
      </p>
      {/* Plain about what leaves Leeway: the file goes as it is, identifiers and all. */}
      <ul className="plain-list small muted">
        <li>
          The whole file goes to Anthropic as it is, including any Social Security number or address
          printed on it: first to check its length, then to be read once. Nothing else of yours goes
          with it.
        </li>
        <li>Leeway never keeps the file, only the figures you save.</li>
        <li>
          Leeway takes Social Security numbers, labeled IDs and long numbers out of what it shows
          and keeps.
        </li>
      </ul>
      {reading ? (
        <Loading label={`${readerName} is reading your paystub`} />
      ) : (
        <div className="row wrap">
          <label className="btn primary">
            Choose a paystub
            <input
              type="file"
              accept={ACCEPT}
              className="visually-hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0]
                if (chosen) onFile(chosen)
                e.target.value = ''
              }}
            />
          </label>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      <ErrorNote error={error} />
    </div>
  )
}
