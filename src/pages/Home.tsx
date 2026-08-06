import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAllJobs,
  fetchHomeJobs,
  fetchJobEstimate,
  fetchJobLoggedItems,
  fetchPriceList,
  fetchUpcomingSchedule,
  updateJobStatus,
} from '../lib/queries'
import { computeJobProgress, formatDate, formatMoney, formatPct } from '../lib/progress'
import type { JobWithClient, ScheduleEventFull, ScheduleKind } from '../lib/types'
import { ProgressBar } from '../components/ProgressBar'

const KIND_LABEL: Record<ScheduleKind, string> = {
  job: 'Job',
  concrete: 'Concrete',
  billing: 'Billing',
  bid: 'Bid',
  other: 'Other',
}

// Friendly date for the snapshot: Today / Tomorrow / MM-DD-YYYY.
function snapDate(iso: string): string {
  const today = new Date().toISOString().slice(0, 10)
  if (iso.slice(0, 10) === today) return 'Today'
  const t = new Date(today + 'T00:00:00')
  t.setDate(t.getDate() + 1)
  if (iso.slice(0, 10) === t.toISOString().slice(0, 10)) return 'Tomorrow'
  return formatDate(iso)
}

interface JobSummary {
  job: JobWithClient
  bidAmount: number
  builtAmount: number
  overallPct: number | null
  hasEstimate: boolean
  needsBilling: boolean
}

export function Home() {
  const [summaries, setSummaries] = useState<JobSummary[]>([])
  const [upcoming, setUpcoming] = useState<ScheduleEventFull[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [archived, setArchived] = useState<JobWithClient[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Archive a job off the Home page (reuses the Billing "Archive job" action).
  async function archiveJob(e: MouseEvent, job: JobWithClient) {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(`Archive "${job.name}"? It'll drop off Home — restore it any time from "Show archived".`)) return
    setBusyId(job.id)
    try {
      await updateJobStatus(job.id, 'archived')
      setSummaries((prev) => prev.filter((s) => s.job.id !== job.id))
      setArchived((prev) => (prev ? [...prev, job].sort((a, b) => a.name.localeCompare(b.name)) : prev))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  // Restore an archived job back to active (it reappears on Home if it has logs).
  async function restoreJob(job: JobWithClient) {
    setBusyId(job.id)
    try {
      await updateJobStatus(job.id, 'active')
      setArchived((prev) => (prev ? prev.filter((j) => j.id !== job.id) : prev))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function toggleArchived() {
    const next = !showArchived
    setShowArchived(next)
    if (next && archived === null) {
      try {
        const all = await fetchAllJobs()
        setArchived(all.filter((j) => j.status === 'archived'))
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [jobs, priceList, sched] = await Promise.all([
          fetchHomeJobs(),
          fetchPriceList(),
          fetchUpcomingSchedule(5),
        ])
        if (!cancelled) setUpcoming(sched)
        const result = await Promise.all(
          jobs.map(async (job): Promise<JobSummary> => {
            const [{ lineItems }, { logs, items }] = await Promise.all([
              fetchJobEstimate(job.id),
              fetchJobLoggedItems(job.id),
            ])
            const p = computeJobProgress(lineItems, items, priceList)
            return {
              job,
              bidAmount: p.bidAmount,
              builtAmount: p.builtAmount,
              overallPct: p.overallPct,
              hasEstimate: p.hasEstimate,
              needsBilling: logs.some((l) => l.ready_to_bill),
            }
          }),
        )
        if (!cancelled) setSummaries(result)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <div className="page"><p className="muted">Loading jobs…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>

  const totalBid = summaries.reduce((s, x) => s + x.bidAmount, 0)
  const totalBuilt = summaries.reduce((s, x) => s + x.builtAmount, 0)
  const billingCount = summaries.filter((x) => x.needsBilling).length
  const overall = totalBid > 0 ? (totalBuilt / totalBid) * 100 : null

  return (
    <div className="page">
      <h1>Active Jobs</h1>

      <div className="stats">
        <Stat label="Active jobs" value={String(summaries.length)} />
        <Stat label="Total bid" value={formatMoney(totalBid)} />
        <Stat label="Built to date" value={formatMoney(totalBuilt)} accent />
        <Stat label="Overall" value={formatPct(overall)} />
        <Stat label="Needs billing" value={String(billingCount)} warn={billingCount > 0} />
      </div>

      <div className="snap">
        <div className="snap-head">
          <h2>Up next</h2>
          <Link to="/schedule" className="label snap-all">Schedule →</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="label snap-empty">Nothing scheduled. Add jobs &amp; concrete orders in Schedule.</p>
        ) : (
          <div className="snap-list">
            {upcoming.map((ev) => (
              <Link key={ev.id} to="/schedule" className="snap-row">
                <span className="snap-when num">{snapDate(ev.event_date)}</span>
                <span className={`event-kind event-kind-${ev.kind}`}>{KIND_LABEL[ev.kind]}</span>
                <span className="snap-title">{ev.title}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {summaries.length === 0 && (
        <div className="empty-card">
          <p>No active jobs found.</p>
        </div>
      )}

      <div className="job-grid">
        {summaries.map(({ job, bidAmount, builtAmount, overallPct, hasEstimate, needsBilling }) => (
          <Link key={job.id} to={`/jobs/${job.id}`} className="job-card">
            <div className="job-card-head">
              <div>
                <h3 className="job-name">{job.name}</h3>
                <p className="job-meta label">
                  {job.client?.name ?? <span className="chip-warn">⚠ Needs client</span>}
                  {job.city ? ` · ${job.city}` : ''}
                </p>
              </div>
              <div className="job-card-actions">
                {needsBilling && <span className="pill pill-warn">Bill</span>}
                <button
                  type="button"
                  className="card-archive"
                  title="Archive job"
                  disabled={busyId === job.id}
                  onClick={(e) => archiveJob(e, job)}
                >
                  Archive
                </button>
              </div>
            </div>

            {hasEstimate ? (
              <>
                <div className="job-card-pct">
                  <span className="num">{formatPct(overallPct)}</span>
                  <span className="label">complete</span>
                </div>
                <ProgressBar pct={overallPct} />
                <p className="job-card-money label">
                  {formatMoney(builtAmount)} of {formatMoney(bidAmount)}
                </p>
              </>
            ) : (
              <p className="job-card-noest label">No estimate on file</p>
            )}
          </Link>
        ))}
      </div>

      <div className="archived-section">
        <button type="button" className="btn-ghost" onClick={toggleArchived}>
          {showArchived ? 'Hide archived' : 'Show archived'}
          {archived && archived.length > 0 ? ` (${archived.length})` : ''}
        </button>
        {showArchived && (
          archived === null ? (
            <p className="label" style={{ marginTop: 8 }}>Loading…</p>
          ) : archived.length === 0 ? (
            <p className="label" style={{ marginTop: 8 }}>No archived jobs.</p>
          ) : (
            <div className="archived-list">
              {archived.map((job) => (
                <div key={job.id} className="archived-row">
                  <Link to={`/jobs/${job.id}`} className="archived-name">
                    {job.name}
                    <span className="label"> · {job.client?.name ?? 'No client'}</span>
                  </Link>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busyId === job.id}
                    onClick={() => restoreJob(job)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  warn,
}: {
  label: string
  value: string
  accent?: boolean
  warn?: boolean
}) {
  return (
    <div className="stat">
      <span className={`stat-value num${accent ? ' stat-accent' : ''}${warn ? ' stat-warn' : ''}`}>
        {value}
      </span>
      <span className="label">{label}</span>
    </div>
  )
}
