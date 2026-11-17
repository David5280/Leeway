// App-wide context: settings, server status and money formatting for the signed-in app.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Settings, Status } from '../api/client'
import { money, signedAmount, type MoneyOptions } from './format'
import { applyAppearance } from './theme'

interface AppValue {
  settings: Settings
  status: Status
  /** Whole units: "$1,234". */
  money: (cents: number) => string
  /** Exact: "$1,234.56". */
  exact: (cents: number) => string
  /** Transaction amounts: "+$12.00" for money in. */
  signed: (cents: number) => string
}

const AppContext = createContext<AppValue | null>(null)

export function AppProvider({
  settings,
  status,
  children,
}: {
  settings: Settings
  status: Status
  children: ReactNode
}) {
  const value = useMemo<AppValue>(() => {
    const options: MoneyOptions = { currency: settings.currency, locale: settings.locale }
    return {
      settings,
      status,
      money: (cents) => money(cents, options),
      exact: (cents) => money(cents, options, true),
      signed: (cents) => signedAmount(cents, options),
    }
  }, [settings, status])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}

/** Whether the device asks for dark mode, kept up to date. */
export function usePrefersDark(): boolean {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? true)
  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const update = () => setDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return dark
}

/** Keeps the page's look in step with the appearance settings. */
export function useAppearance(appearance: Settings['appearance'] | undefined): void {
  const prefersDark = usePrefersDark()
  useEffect(() => {
    if (appearance) applyAppearance(appearance, prefersDark)
  }, [appearance, prefersDark])
}
