import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/daily-log', label: 'Logs', end: false },
  { to: '/schedule', label: 'Schedule', end: false },
  { to: '/billing', label: 'Billing', end: false },
  { to: '/estimating', label: 'Estimate', end: false },
  { to: '/price-sheet', label: 'Prices', end: false },
]

export function AppShell({ email, children }: { email: string; children: ReactNode }) {
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
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
