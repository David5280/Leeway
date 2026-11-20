// Decides what to show: first-run setup, sign-in, or the app and its screens.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ApiError, auth, setSignedOutHandler, UNREACHABLE } from './api/client'
import { useAction } from './api/hooks'
import { Loading, LoadingOrError } from './components/ui'
import { AppProvider, useAppearance } from './lib/app'
import { Accounts } from './pages/Accounts'
import { Alerts } from './pages/Alerts'
import { Budgets } from './pages/Budgets'
import { CategoryPage } from './pages/Category'
import { Connect, ConnectProblem } from './pages/Connect'
import { ImportTransactions } from './pages/ImportTransactions'
import { Inbox } from './pages/Inbox'
import { Login } from './pages/Login'
import { Overview } from './pages/Overview'
import { Plan } from './pages/Plan'
import { OldSettingsAddress, SettingsPage } from './pages/Settings'
import { Setup } from './pages/Setup'
import { Transactions } from './pages/Transactions'
import { CONNECT_ROUTES, SCREEN_ROUTES } from './routes'

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="auth">{children}</div>
}

/** The app's screens, once setup is done. */
function Screens() {
  return (
    <Routes>
      <Route path={SCREEN_ROUTES.overview} element={<Overview />} />
      <Route path={SCREEN_ROUTES.accounts} element={<Accounts />} />
      <Route path={SCREEN_ROUTES.alerts} element={<Alerts />} />
      <Route path={SCREEN_ROUTES.inbox} element={<Inbox />} />
      <Route path={SCREEN_ROUTES.transactions} element={<Transactions />} />
      <Route path={SCREEN_ROUTES.importTransactions} element={<ImportTransactions />} />
      <Route path={SCREEN_ROUTES.budgets} element={<Budgets />} />
      <Route path={SCREEN_ROUTES.category} element={<CategoryPage />} />
      <Route path={SCREEN_ROUTES.plan} element={<Plan />} />
      <Route path={SCREEN_ROUTES.planSection} element={<Plan />} />
      <Route path={SCREEN_ROUTES.settings} element={<SettingsPage />} />
      <Route path={SCREEN_ROUTES.oldSettings} element={<OldSettingsAddress />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/** Decides what to show: first-run setup, sign-in, or the app itself. */
export function App() {
  const client = useQueryClient()
  useEffect(() => {
    setSignedOutHandler(() => void client.invalidateQueries({ queryKey: ['me'] }))
  }, [client])

  const status = useQuery({ queryKey: ['status'], queryFn: auth.status })
  const me = useQuery({
    queryKey: ['me'],
    queryFn: auth.me,
    enabled: status.data?.hasOwner === true,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  })
  const signedIn = me.isSuccess
  const settings = useAction('get_settings', undefined, { enabled: signedIn })
  useAppearance(settings.data?.appearance)

  if (status.isError) {
    return (
      <Centered>
        <p className="notice error">{UNREACHABLE}</p>
      </Centered>
    )
  }
  if (!status.data) {
    return (
      <Centered>
        <Loading />
      </Centered>
    )
  }
  if (!status.data.hasOwner) return <Setup status={status.data} />
  if (me.isPending) {
    return (
      <Centered>
        <Loading />
      </Centered>
    )
  }
  if (!signedIn) return <Login />
  if (!settings.data) {
    return (
      <Centered>
        <LoadingOrError error={settings.error} />
      </Centered>
    )
  }

  return (
    <AppProvider settings={settings.data} status={status.data}>
      <Routes>
        {/* An assistant asking to connect is answered even before setup is finished. */}
        <Route path={CONNECT_ROUTES.connectProblem} element={<ConnectProblem />} />
        <Route path={CONNECT_ROUTES.connect} element={<Connect />} />
        <Route
          path="*"
          element={me.data.owner.onboarded ? <Screens /> : <Setup status={status.data} signedIn />}
        />
      </Routes>
    </AppProvider>
  )
}
