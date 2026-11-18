// The Customize screen: every setting, one section each, all saving live.

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useSettingsSaveError } from '../api/settings'
import { Shell } from '../components/Shell'
import { ErrorNote } from '../components/ui'
import { AccountSection } from './customize/Accounts'
import { AgentSection } from './customize/Agent'
import { DataSection } from './customize/Data'
import { BanksSection } from './customize/Banks'
import { BudgetingSection } from './customize/Budgeting'
import { EmailSection } from './customize/Email'
import { LayoutSection } from './customize/Layout'
import { LookSection } from './customize/Look'
import { RegionSection } from './customize/Region'
import { SignInSection } from './customize/SignIn'

/** The jump links at the top; ids match each section's anchor. */
const SECTIONS = [
  ['look', 'Look'],
  ['layout', 'Dashboard'],
  ['budgeting', 'Budgeting'],
  ['region', 'Region'],
  ['accounts', 'Accounts'],
  ['banks', 'Banks'],
  ['agent', 'AI assistant'],
  ['email', 'Email'],
  ['data', 'Data'],
  ['account', 'Sign-in'],
] as const

/** Scrolls to the section a link named, like /customize#accounts from setup's last step. */
function useScrollToSection() {
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [hash])
}

export function Customize() {
  const saveError = useSettingsSaveError()
  useScrollToSection()
  return (
    <Shell>
      <div>
        <h1>Make it yours</h1>
        <span className="muted">Every change saves right away and shows live.</span>
      </div>
      <nav aria-label="Customize sections" className="row wrap">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip">
            {label}
          </a>
        ))}
      </nav>
      <ErrorNote error={saveError} />
      <LookSection />
      <LayoutSection />
      <BudgetingSection />
      <RegionSection />
      <AccountSection />
      <BanksSection />
      <AgentSection />
      <EmailSection />
      <DataSection />
      <SignInSection />
    </Shell>
  )
}
