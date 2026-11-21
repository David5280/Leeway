// The Plan screen: bills, goals, debts, net worth or retirement, one section
// at a time. Cash until payday leads the bills, the section it answers for,
// and stays off the others so each opens on its own subject. With a calendar
// linked, Coming up shows the weeks ahead; without one it stays out of sight.

import { useNavigate, useParams } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { Shell } from '../components/Shell'
import { TabRow } from '../components/TabRow'
import { AheadSection } from './plan/Ahead'
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
  ahead: { label: 'Coming up', component: AheadSection },
} as const

type Section = keyof typeof SECTIONS

const OPTIONS = (Object.keys(SECTIONS) as Section[]).map((value) => ({
  value,
  label: SECTIONS[value].label,
}))

export function Plan() {
  const navigate = useNavigate()
  const { section } = useParams()
  const calendar = useAction('calendar_status')
  const linked = calendar.data?.connected === true
  const options = linked ? OPTIONS : OPTIONS.filter((option) => option.value !== 'ahead')
  // An unknown section in the address, or one not offered, shows bills rather than nothing.
  const offered = options.some((option) => option.value === section)
  const current: Section = offered ? (section as Section) : 'bills'
  const Content = SECTIONS[current].component
  return (
    <Shell>
      <h1>Plan</h1>
      <TabRow
        label="Plan section"
        value={current}
        options={options}
        onChange={(next) => navigate(`/plan/${next}`)}
      />
      {current === 'bills' && <CashFlowCard />}
      <Content />
    </Shell>
  )
}
