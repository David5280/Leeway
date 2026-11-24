// Settings, Paystub: import a paystub, check what was read, and confirm it;
// then what Leeway uses from it. Import again any time to redo it with a
// newer one. Without an Anthropic key nothing can read a paystub, so the
// import gives way to a note, and figures already in use still show.

import { useState } from 'react'
import { useAction } from '../../api/hooks'
import { ErrorNote, Loading } from '../../components/ui'
import { FullPaystubImport } from '../paystub/FullPaystubImport'
import { PaystubInUse, SavedNote } from '../paystub/InUse'
import { NoReader } from '../paystub/NoReader'
import { Section } from './Section'

export function PaystubSection() {
  const status = useAction('get_paystub')
  const use = useAction('get_paystub_use')
  const [importing, setImporting] = useState(false)
  const [saved, setSaved] = useState(false)
  const readerName = status.data?.available ? status.data.readerName : null

  return (
    <Section id="paystub" title="Paystub">
      {importing && readerName ? (
        <FullPaystubImport
          readerName={readerName}
          onSaved={() => {
            setImporting(false)
            setSaved(true)
          }}
          onCancel={() => setImporting(false)}
        />
      ) : (
        <>
          {/* Named as in use only once the refetch after saving says so. */}
          {saved && <SavedNote state={use.isFetching ? undefined : use.data?.state} />}
          <ErrorNote error={status.error ?? use.error} />
          {use.data ? <PaystubInUse use={use.data} /> : !use.error && <Loading />}
          {status.data &&
            (readerName ? (
              <div className="row">
                <button
                  type="button"
                  // The main button until a paystub is in use; after that a quiet way to redo it.
                  className={use.data?.state === 'used' ? 'btn' : 'btn primary'}
                  onClick={() => {
                    setSaved(false)
                    setImporting(true)
                  }}
                >
                  Import a paystub
                </button>
              </div>
            ) : (
              <NoReader later="come back here" />
            ))}
        </>
      )}
    </Section>
  )
}
