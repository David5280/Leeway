// What the newest paystub shows, on Your pay: the figures Leeway uses from it
// (paystub/InUse.tsx). Importing or redoing a paystub is setup, so it stays
// in Settings, and the whole card is one link there.

import { useAction } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { SectionHead } from '../../../components/design/SectionHead'
import { LoadingOrError } from '../../../components/ui'
import { PaystubInUse } from '../../paystub/InUse'
import { settingsPath } from '../../settings/paths'

export function PaystubCard() {
  const use = useAction('get_paystub_use')
  return (
    <Card to={settingsPath('paystub')} label="Your paystub" className="stack-sm">
      <SectionHead icon="receipt" title="Your paystub" />
      {use.data ? (
        <PaystubInUse use={use.data} />
      ) : (
        <LoadingOrError error={use.error} label="Loading your paystub" />
      )}
      <span className="small muted">Import or redo a paystub in Settings.</span>
    </Card>
  )
}
