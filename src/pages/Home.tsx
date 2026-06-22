import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchActiveJobs,
  fetchJobEstimate,
  fetchJobLoggedItems,
  fetchPriceList,
} from '../lib/queries'
import { computeJobProgress, formatMoney, formatPct } from '../lib/progress'
import type { JobWithClient } from '../lib/types'
import { ProgressBar } from '../components/ProgressBar'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [jobs, priceList] = await Promise.all([fetchActiveJobs(), fetchPriceList()])
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
                  {job.client?.name ?? 'No client'}
                  {job.city ? ` · ${job.city}` : ''}
                </p>
              </div>
              {needsBilling && <span className="pill pill-warn">Bill</span>}
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
