// The frame around every screen: header, navigation and the phone tab bar.

import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useUpdateSettings } from '../api/settings'
import { useApp, usePrefersDark } from '../lib/app'
import { THEMES, themeVariables, type ThemeId } from '../lib/theme'
import { Icon, Logo, type IconName } from './ui'

const LINKS: { to: string; label: string; short: string; icon: IconName }[] = [
  { to: '/', label: 'Overview', short: 'Overview', icon: 'overview' },
  { to: '/accounts', label: 'Accounts', short: 'Accounts', icon: 'accounts' },
  { to: '/transactions', label: 'Transactions', short: 'Activity', icon: 'activity' },
  { to: '/budgets', label: 'Budgets', short: 'Budgets', icon: 'budgets' },
  { to: '/plan', label: 'Plan', short: 'Plan', icon: 'plan' },
  { to: '/customize', label: 'Customize', short: 'Customize', icon: 'customize' },
]

/** Quick theme switch: one dot per theme, painted in that theme's colors. */
function ThemeDots() {
  const { settings } = useApp()
  const prefersDark = usePrefersDark()
  const update = useUpdateSettings()
  return (
    <div role="group" aria-label="Theme" className="pillbar" style={{ padding: 6, gap: 6 }}>
      {(Object.keys(THEMES) as ThemeId[]).map((id) => {
        const { vars } = themeVariables({ ...settings.appearance, theme: id }, prefersDark)
        return (
          <button
            key={id}
            type="button"
            className="theme-dot"
            aria-label={`${THEMES[id].name} theme`}
            aria-pressed={settings.appearance.theme === id}
            onClick={() => update.mutate({ appearance: { theme: id } })}
            style={{
              background: `linear-gradient(135deg, ${vars['--bg']} 50%, ${vars['--accent']} 50%)`,
            }}
          />
        )
      })}
    </div>
  )
}

export function Shell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <div className="page">
        <header className="topbar">
          <NavLink to="/" className="brand" aria-label="Leeway overview">
            <Logo />
            leeway
          </NavLink>
          <nav aria-label="Main" className="pillbar">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="row">
            <ThemeDots />
            {actions}
          </div>
        </header>
        {children}
      </div>
      <nav aria-label="Main" className="tabbar">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            <Icon name={link.icon} size={22} />
            {link.short}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
