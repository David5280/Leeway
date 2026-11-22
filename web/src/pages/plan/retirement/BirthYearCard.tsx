// The one question a retirement projection cannot do without: the year the
// owner was born. Shown while no age is known: before the year is given, or
// when the year saved is still to come. After that it lives in Settings,
// under Planning.

import { BirthYearForm } from '../../../components/BirthYearForm'
import { Card } from '../../../components/design/Card'

/** `savedYear` is the year saved that gives no age, or null when none is saved. */
export function BirthYearCard({ savedYear }: { savedYear: number | null }) {
  return (
    <Card static="form" label="What year were you born?" className="stack-sm">
      <h2>What year were you born?</h2>
      <p className="small muted">
        {savedYear !== null && `The year saved, ${savedYear}, is still to come. `}
        Only the year. Your projection starts from your age, and you can change it in Settings.
      </p>
      <BirthYearForm />
    </Card>
  )
}
