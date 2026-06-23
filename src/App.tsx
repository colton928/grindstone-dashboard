import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { AppShell } from './components/AppShell'
import { Home } from './pages/Home'
import { JobDetail } from './pages/JobDetail'
import { DailyLog } from './pages/DailyLog'
import { Billing } from './pages/Billing'
import { Estimating } from './pages/Estimating'
import { PriceSheet } from './pages/PriceSheet'
import { ComingSoon } from './pages/ComingSoon'
import './App.css'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) return null

  if (!session) {
    return (
      <section className="login">
        <img src="/grindstone-logo.png" alt="Grindstone Concrete" className="login-logo brand-logo" />
        <h1>Grindstone Dashboard</h1>
        <p className="login-sub">Job tracking, billing &amp; estimating — one place.</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            supabase.auth.signInWithOAuth({
              provider: 'google',
              options: { redirectTo: window.location.origin },
            })
          }
        >
          Sign in with Google
        </button>
      </section>
    )
  }

  return (
    <AppShell email={session.user.email ?? ''}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/daily-log" element={<DailyLog />} />
        <Route path="/schedule" element={<ComingSoon title="Schedule" phase={4} />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/estimating" element={<Estimating />} />
        <Route path="/price-sheet" element={<PriceSheet />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </AppShell>
  )
}

export default App
