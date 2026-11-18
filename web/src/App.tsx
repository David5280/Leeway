// Decides what to show: first-run setup, sign-in, or the app and its screens.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ApiError, auth, setSignedOutHandler } from './api/client'
import { useAction } from './api/hooks'
import { Loading } from './components/ui'
import { AppProvider, useAppearance } from './lib/app'
import { Budgets } from './pages/Budgets'
import { CategoryPage } from './pages/Category'
import { Connect, ConnectProblem } from './pages/Connect'
import { Customize } from './pages/Customize'
import { ImportTransactions } from './pages/ImportTransactions'
import { Login } from './pages/Login'
import { Overview } from './pages/Overview'
import { Plan } from './pages/Plan'
import { Setup } from './pages/Setup'
import { Transactions } from './pages/Transactions'

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="auth">{children}</div>
}

/** The app's screens, once setup is done. */
function Screens() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/transactions" element={<Transactions />} />
      <Route path="/transactions/import" element={<ImportTransactions />} />
      <Route path="/budgets" element={<Budgets />} />
      <Route path="/budgets/:id" element={<CategoryPage />} />
      <Route path="/plan" element={<Plan />} />
      <Route path="/plan/:section" element={<Plan />} />
      <Route path="/customize" element={<Customize />} />
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
        <p className="notice error">Leeway's server is not answering. Check that it is running.</p>
      </Centered>
    )
  }
  if (!status.data) return <Centered>{<Loading />}</Centered>
  if (!status.data.hasOwner) return <Setup status={status.data} />
  if (me.isPending) return <Centered>{<Loading />}</Centered>
  if (!signedIn) return <Login />
  if (!settings.data) return <Centered>{<Loading />}</Centered>

  return (
    <AppProvider settings={settings.data} status={status.data}>
      <Routes>
        {/* An assistant asking to connect is answered even before setup is finished. */}
        <Route path="/connect" element={<ConnectProblem />} />
        <Route path="/connect/:id" element={<Connect />} />
        <Route
          path="*"
          element={
            me.data.owner.onboarded ? <Screens /> : <Setup status={status.data} startAt={2} />
          }
        />
      </Routes>
    </AppProvider>
  )
}
