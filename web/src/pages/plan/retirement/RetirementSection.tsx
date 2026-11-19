// The Retirement section of the Plan tab: what pensions and savings could pay
// in retirement, the pensions behind it and the assumptions it rests on. All
// worked out by rule on the server, with no AI; a pension always counts as
// retirement saving.

import { useAction } from '../../../api/hooks'
import { LoadingOrError } from '../../../components/ui'
import { AssumptionsCard } from './AssumptionsCard'
import { PensionsCard } from './PensionsCard'
import { ProjectionCard } from './ProjectionCard'

export function RetirementSection() {
  const view = useAction('project_retirement')
  if (!view.data) return <LoadingOrError error={view.error} />
  return (
    <>
      <ProjectionCard view={view.data} />
      <PensionsCard view={view.data} />
      <AssumptionsCard assumptions={view.data.plan.assumptions} />
    </>
  )
}
