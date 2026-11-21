// The Plan screen: payday, bills, goals, debts, net worth or retirement, one
// section at a time, opening on payday. Cash until payday leads the bills,
// the section it answers for, and stays off the others so each opens on its
// own subject.

import { useNavigate, useParams } from 'react-router-dom'
import { Shell } from '../components/Shell'
import { TabRow } from '../components/TabRow'
import { BillsSection } from './plan/Bills'
import { CashFlowCard } from './plan/CashFlow'
import { DebtsSection } from './plan/Debts'
import { GoalsSection } from './plan/goals/GoalsSection'
import { NetWorthSection } from './plan/NetWorth'
import { PaydaySection } from './plan/payday/PaydaySection'
import { RetirementSection } from './plan/retirement/RetirementSection'

const SECTIONS = {
  payday: { label: 'Payday', component: PaydaySection },
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
  // An unknown section in the address shows payday rather than nothing.
  const current: Section = section && section in SECTIONS ? (section as Section) : 'payday'
  const Content = SECTIONS[current].component
  return (
    <Shell>
      <h1>Plan</h1>
      <TabRow
        label="Plan section"
        value={current}
        options={OPTIONS}
        onChange={(next) => navigate(`/plan/${next}`)}
      />
      {current === 'bills' && <CashFlowCard />}
      <Content />
    </Shell>
  )
}
