// The Retirement page, a tap deeper in the Wealth tab: what pensions and savings could pay
// in retirement, the pensions behind it and the assumptions it rests on, with
// the birth year asked under the projection while no age is known. All worked
// out by rule on the server; a pension always counts as retirement saving.
// Only a paystub import asks Claude, to read the file, and the owner checks
// every figure it read.

import { useAction } from '../../../api/hooks'
import { LoadingOrError } from '../../../components/ui'
import { AssumptionsCard } from './AssumptionsCard'
import { BirthYearCard } from './BirthYearCard'
import { PaystubCard } from './paystub/PaystubCard'
import { pensionChoices } from './paystub/review'
import { PensionsCard } from './PensionsCard'
import { ProjectionCard } from './ProjectionCard'

export function RetirementSection() {
  const view = useAction('project_retirement')
  if (!view.data) return <LoadingOrError error={view.error} />
  const { plan } = view.data
  return (
    <>
      <ProjectionCard view={view.data} />
      {/* The server projects whenever it knows an age, so no projection means
          no usable year: none given, or one saved that is still to come. */}
      {plan.projection === null && <BirthYearCard savedYear={plan.assumptions.birthYear} />}
      <PensionsCard view={view.data} />
      <PaystubCard pensions={pensionChoices(view.data)} />
      <AssumptionsCard assumptions={view.data.plan.assumptions} />
    </>
  )
}
