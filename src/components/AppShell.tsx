import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { countDailyLogsNeedingReview } from '../lib/queries'

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/daily-log', label: 'Logs', end: false },
  { to: '/schedule', label: 'Schedule', end: false },
  { to: '/billing', label: 'Billing', end: false },
  { to: '/estimating', label: 'Estimate', end: false },
  { to: '/price-sheet', label: 'Prices', end: false },
]

export function AppShell({ email, children }: { email: string; children: ReactNode }) {
  const location = useLocation()
  const [reviewCount, setReviewCount] = useState(0)

  // Keep the Logs-tab badge fresh: on load, on navigation, and when a report is
  // marked reviewed (DailyLog dispatches 'logs-reviewed').
  useEffect(() => {
    let alive = true
    const refresh = () =>
      countDailyLogsNeedingReview()
        .then((n) => alive && setReviewCount(n))
        .catch(() => {})
    refresh()
    window.addEventListener('logs-reviewed', refresh)
    return () => {
      alive = false
      window.removeEventListener('logs-reviewed', refresh)
    }
  }, [location.pathname])

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="topbar-brand">
          <img src="/grindstone-mark.png" alt="" className="topbar-mark brand-logo" />
          <span>Grindstone</span>
        </NavLink>
        <div className="topbar-right">
          <span className="topbar-email">{email}</span>
          <button type="button" className="btn-ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="content">{children}</main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `tab${isActive ? ' tab-active' : ''}`}
          >
            {t.label}
            {t.to === '/daily-log' && reviewCount > 0 && (
              <span className="tab-badge">{reviewCount}</span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
