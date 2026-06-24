import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from './lib/api'
import { Layout } from './components/Layout'
import { GaugeMark } from './components/Brand'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import SettingsTokens from './pages/SettingsTokens'

export function useAuth() {
  return useQuery({ queryKey: ['me'], queryFn: apiClient.me, staleTime: 60_000 })
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="animate-pulse-dot">
        <GaugeMark size={40} />
      </div>
    </div>
  )
}

function RequireAuth() {
  const { data, isLoading } = useAuth()
  if (isLoading) return <Splash />
  if (!data?.authenticated) return <Navigate to="/login" replace />
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings/tokens" element={<SettingsTokens />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
