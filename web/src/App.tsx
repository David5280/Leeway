// Decides what to show: first-run setup, sign-in, or the app and its screens.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ApiError, auth, setSignedOutHandler, UNREACHABLE } from './api/client'
import { useAction } from './api/hooks'
import { AskProvider } from './components/ask/AskProvider'
import { Loading, LoadingOrError } from './components/ui'
import { AppProvider, useAppearance } from './lib/app'
import { AccountDetail } from './pages/AccountDetail'
import { Alerts } from './pages/Alerts'
import { BillsPage } from './pages/Bills'
import { CategoryPage } from './pages/Category'
import { ChatPage } from './pages/Chat'
import { Connect, ConnectProblem } from './pages/Connect'
import { DebtsPage } from './pages/Debts'
import { Goals } from './pages/Goals'
import { IdleCashPage } from './pages/IdleCash'
import { ImportTransactions } from './pages/ImportTransactions'
import { Inbox } from './pages/Inbox'
import { Login } from './pages/Login'
import { Moved, NEW_HOMES } from './pages/OldAddresses'
import { Overview } from './pages/Overview'
import { Payday } from './pages/Payday'
import { RetirementPage } from './pages/Retirement'
import { SettingsPage } from './pages/Settings'
import { SixWeeksPage } from './pages/SixWeeks'
import { Spending } from './pages/Spending'
import { SpendingOverTimePage } from './pages/SpendingOverTime'
import { Setup } from './pages/Setup'
import { TopMerchantsPage } from './pages/TopMerchants'
import { Transactions } from './pages/Transactions'
import { TripPage } from './pages/Trip'
import { Wealth } from './pages/Wealth'
import { YourPayPage } from './pages/YourPay'
import { CONNECT_ROUTES, OLD_ROUTES, paths, SCREEN_ROUTES } from './routes'

/** The old addresses by name, each sent on to its new home (pages/OldAddresses.tsx). */
const OLD_NAMES = Object.keys(OLD_ROUTES) as (keyof typeof OLD_ROUTES)[]

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="auth">{children}</div>
}

/** The app's screens, once setup is done. */
function Screens() {
  return (
    <Routes>
      <Route path={SCREEN_ROUTES.home} element={<Overview />} />
      <Route path={SCREEN_ROUTES.spending} element={<Spending />} />
      <Route path={SCREEN_ROUTES.activity} element={<Transactions />} />
      <Route path={SCREEN_ROUTES.importTransactions} element={<ImportTransactions />} />
      <Route path={SCREEN_ROUTES.spendingOverTime} element={<SpendingOverTimePage />} />
      <Route path={SCREEN_ROUTES.topMerchants} element={<TopMerchantsPage />} />
      <Route path={SCREEN_ROUTES.category} element={<CategoryPage />} />
      <Route path={SCREEN_ROUTES.payday} element={<Payday />} />
      <Route path={SCREEN_ROUTES.bills} element={<BillsPage />} />
      <Route path={SCREEN_ROUTES.pay} element={<YourPayPage />} />
      <Route path={SCREEN_ROUTES.sixWeeks} element={<SixWeeksPage />} />
      <Route path={SCREEN_ROUTES.goals} element={<Goals />} />
      <Route path={SCREEN_ROUTES.trip} element={<TripPage />} />
      <Route path={SCREEN_ROUTES.wealth} element={<Wealth />} />
      <Route path={SCREEN_ROUTES.account} element={<AccountDetail />} />
      <Route path={SCREEN_ROUTES.debts} element={<DebtsPage />} />
      <Route path={SCREEN_ROUTES.retirement} element={<RetirementPage />} />
      <Route path={SCREEN_ROUTES.idleCash} element={<IdleCashPage />} />
      <Route path={SCREEN_ROUTES.alerts} element={<Alerts />} />
      <Route path={SCREEN_ROUTES.inbox} element={<Inbox />} />
      <Route path={SCREEN_ROUTES.chat} element={<ChatPage />} />
      <Route path={SCREEN_ROUTES.settings} element={<SettingsPage />} />
      {OLD_NAMES.map((name) => (
        <Route key={name} path={OLD_ROUTES[name]} element={<Moved to={NEW_HOMES[name]} />} />
      ))}
      <Route path="*" element={<Navigate to={paths.home()} replace />} />
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
      <AskProvider>
        <Routes>
          {/* An assistant asking to connect is answered even before setup is finished. */}
          <Route path={CONNECT_ROUTES.connectProblem} element={<ConnectProblem />} />
          <Route path={CONNECT_ROUTES.connect} element={<Connect />} />
          <Route
            path="*"
            element={
              me.data.owner.onboarded ? <Screens /> : <Setup status={status.data} signedIn />
            }
          />
        </Routes>
      </AskProvider>
    </AppProvider>
  )
}
