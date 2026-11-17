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
import { Customize } from './pages/Customize'
import { Login } from './pages/Login'
import { Overview } from './pages/Overview'
import { Setup } from './pages/Setup'
import { Transactions } from './pages/Transactions'

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="auth">{children}</div>
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
      {!me.data.owner.onboarded ? (
        <Setup status={status.data} startAt={2} />
      ) : (
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/budgets/:id" element={<CategoryPage />} />
          <Route path="/customize" element={<Customize />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </AppProvider>
  )
}
