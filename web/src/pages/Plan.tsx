// The Plan screen: cash until payday on top, then bills, goals, debts, net worth or retirement.

import { useNavigate, useParams } from 'react-router-dom'
import { Shell } from '../components/Shell'
import { Segmented } from '../components/ui'
import { BillsSection } from './plan/Bills'
import { CashFlowCard } from './plan/CashFlow'
import { DebtsSection } from './plan/Debts'
import { GoalsSection } from './plan/goals/GoalsSection'
import { NetWorthSection } from './plan/NetWorth'
import { RetirementSection } from './plan/retirement/RetirementSection'

const SECTIONS = {
  bills: { label: 'Bills', component: BillsSection },
  goals: { label: 'Goals', component: GoalsSection },
  debts: { label: 'Debts', component: DebtsSection },
  'net-worth': { label: 'Net worth', component: NetWorthSection },
  retirement: { label: 'Retirement', component: RetirementSection },
} as const

type Section = keyof typeof SECTIONS

const OPTIONS = (Object.keys(SECTIONS) as Section[]).map((value) => ({
  value,
  label: SECTIONS[value].label,
}))

export function Plan() {
  const navigate = useNavigate()
  const { section } = useParams()
  // An unknown section in the address shows bills rather than nothing.
  const current: Section = section && section in SECTIONS ? (section as Section) : 'bills'
  const Content = SECTIONS[current].component
  return (
    <Shell>
      <div className="row-between wrap">
        <h1>Plan</h1>
        <Segmented
          label="Plan section"
          value={current}
          options={OPTIONS}
          onChange={(next) => navigate(`/plan/${next}`)}
        />
      </div>
      <CashFlowCard />
      <Content />
    </Shell>
  )
}
