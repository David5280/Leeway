// Top merchants for one budget period, the one Spending was showing: where
// the most went, biggest first, each bar against the biggest. The card opens
// the math behind the total, as Home's card does.

import { useAction } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { SectionHead } from '../../../components/design/SectionHead'
import { MerchantRows } from '../../../components/MerchantRows'
import { LoadingOrError } from '../../../components/ui'
import { merchantsDrill } from '../../../lib/drills/plan'

/** How many merchants the page lists: past the few Home's card has room for. */
export const MERCHANTS_LISTED = 20

export function MerchantsList({ period, when }: { period: number; when: string }) {
  const merchants = useAction('top_merchants', { offset: period, limit: MERCHANTS_LISTED })
  // The period on its own line, not beside the title, so a narrow phone has room for both.
  const head = (
    <>
      <SectionHead icon="moneyOut" title="Where the most went" />
      <p className="small muted">{when}</p>
    </>
  )
  if (!merchants.data || merchants.data.length === 0) {
    return (
      <Card static="empty" label="Top merchants" className="stack-sm">
        {head}
        {merchants.data ? (
          <p className="empty">No spending at a merchant in this period.</p>
        ) : (
          <LoadingOrError error={merchants.error} label="Loading top merchants" />
        )}
      </Card>
    )
  }
  return (
    <Card drill={merchantsDrill(merchants.data)} label="Top merchants" className="stack-sm">
      {head}
      <MerchantRows merchants={merchants.data} />
    </Card>
  )
}
