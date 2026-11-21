// The one question a retirement projection cannot do without: the year the
// owner was born. Shown only until it is given; after that it lives in
// Settings, under Planning.

import { BirthYearForm } from '../../../components/BirthYearForm'
import { Card } from '../../../components/design/Card'

export function BirthYearCard() {
  return (
    <Card static="form" label="What year were you born?" className="stack-sm">
      <h2>What year were you born?</h2>
      <p className="small muted">
        Only the year. Your projection starts from your age, and you can change it in Settings.
      </p>
      <BirthYearForm />
    </Card>
  )
}
