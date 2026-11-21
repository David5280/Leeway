// What plans are worked out from: for now, the birth year retirement
// projections start from. Asked once on the Retirement section, changed here.

import { BirthYearForm } from '../../components/BirthYearForm'
import { Section } from './Section'

export function PlanningSection() {
  return (
    <Section
      id="planning"
      title="Planning"
      hint="Your birth year, only the year. Retirement projections start from your age."
    >
      <BirthYearForm />
    </Section>
  )
}
