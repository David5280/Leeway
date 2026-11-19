// The Settings screen's groups, in menu order. This list is the whole menu:
// adding a group, or moving a section, is one change here. Each group gets
// its own address, /settings/<id>, so an id never changes once shipped.

import type { ComponentType } from 'react'
import { AccountSection } from './Accounts'
import { AgentSection } from './Agent'
import { AiModelsSection } from './AiModels'
import { BanksSection } from './Banks'
import { BudgetingSection } from './Budgeting'
import { DataSection } from './Data'
import { EmailSection } from './Email'
import { LayoutSection } from './Layout'
import { LookSection } from './Look'
import { RegionSection } from './Region'
import { SignInSection } from './SignIn'

export interface SettingsGroup {
  /** The last part of the group's address: lowercase words joined by hyphens. */
  id: string
  /** The menu label and the group's heading. */
  title: string
  /** One plain line under the heading on what the group holds. */
  description: string
  /** The cards the group shows, top to bottom. */
  sections: readonly ComponentType[]
}

export const SETTINGS_GROUPS = [
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Theme, colors and type, and what the overview shows.',
    sections: [LookSection, LayoutSection],
  },
  {
    id: 'budgeting',
    title: 'Budgeting',
    description: 'When a period starts, when warnings show, and your currency and time zone.',
    sections: [BudgetingSection, RegionSection],
  },
  {
    id: 'accounts',
    title: 'Accounts',
    description: 'Rename or hide accounts, set low-balance warnings, and add ones kept by hand.',
    sections: [AccountSection],
  },
  {
    id: 'banks',
    title: 'Banks',
    description: 'Bank connections through Plaid. Read-only: Leeway never moves money.',
    sections: [BanksSection],
  },
  {
    id: 'email',
    title: 'Email',
    description: 'A summary of your week in your inbox, with anything that needs you.',
    sections: [EmailSection],
  },
  {
    id: 'assistant',
    title: 'AI assistant',
    description: 'Connect Claude or another assistant, manage its keys, and the AI summary.',
    sections: [AgentSection],
  },
  {
    id: 'ai',
    title: 'AI models',
    description: 'The Claude model for each AI job, and a monthly limit on what they spend.',
    sections: [AiModelsSection],
  },
  {
    id: 'data',
    title: 'Data',
    description: 'Bring in transaction history, and back up your setup.',
    sections: [DataSection],
  },
  {
    id: 'sign-in',
    title: 'Sign-in',
    description: 'Change your password, or sign out.',
    sections: [SignInSection],
  },
] as const satisfies readonly SettingsGroup[]

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]['id']

/** The group an address names, or undefined for none or one that does not exist. */
export function findGroup(id: string | null | undefined): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((group) => group.id === id)
}
