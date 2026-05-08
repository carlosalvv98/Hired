import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './hooks/useAuth'
import { UIProvider } from './hooks/useUI'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Tracker from './pages/Tracker'
import Inbox from './pages/Inbox'
import Calendar from './pages/Calendar'
import Resumes from './pages/Resumes'
import ResumeEditor from './pages/ResumeEditor'
import Connections from './pages/Connections'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route element={
            <ProtectedRoute>
              <UIProvider>
                <Layout />
              </UIProvider>
            </ProtectedRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="tracker" element={<Tracker />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="resumes" element={<Resumes />} />
            <Route path="resumes/:id" element={<ResumeEditor />} />
            <Route path="connections" element={<Connections />} />
            <Route path="settings" element={<Settings />} />
            <Route path="integrations" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="bottom-right" toastOptions={{
          style: { fontSize: 13, fontFamily: 'var(--sans)', borderRadius: 8 },
        }} />
      </AuthProvider>
    </BrowserRouter>
  )
}
