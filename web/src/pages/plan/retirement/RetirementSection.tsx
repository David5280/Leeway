// The Retirement section of the Plan tab: what pensions and savings could pay
// in retirement, the pensions behind it and the assumptions it rests on, with
// the birth year asked under the projection until it is given. All
// worked out by rule on the server; a pension always counts as retirement
// saving. Only a paystub import asks Claude, to read the file, and the owner
// checks every figure it read.

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
  return (
    <>
      <ProjectionCard view={view.data} />
      {view.data.plan.assumptions.birthYear === null && <BirthYearCard />}
      <PensionsCard view={view.data} />
      <PaystubCard pensions={pensionChoices(view.data)} />
      <AssumptionsCard assumptions={view.data.plan.assumptions} />
    </>
  )
}
