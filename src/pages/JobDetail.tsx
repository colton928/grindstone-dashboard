import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchJob,
  fetchJobEstimate,
  fetchJobLoggedItems,
  fetchPriceList,
} from '../lib/queries'
import {
  computeJobProgress,
  formatMoney,
  formatPct,
  formatQty,
  type JobProgress,
} from '../lib/progress'
import type { Estimate, JobWithClient } from '../lib/types'
import { ProgressBar } from '../components/ProgressBar'

export function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const [job, setJob] = useState<JobWithClient | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const [jobData, { estimate, lineItems }, { items }, priceList] = await Promise.all([
          fetchJob(id),
          fetchJobEstimate(id),
          fetchJobLoggedItems(id),
          fetchPriceList(),
        ])
        if (cancelled) return
        setJob(jobData)
        setEstimate(estimate)
        setProgress(computeJobProgress(lineItems, items, priceList))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <div className="page"><p className="muted">Loading job…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>
  if (!job || !progress) return <div className="page"><p className="muted">Job not found.</p></div>

  return (
    <div className="page">
      <Link to="/" className="back-link label">← All jobs</Link>
      <div className="job-detail-head">
        <h1>{job.name}</h1>
        <p className="label">
          {job.client?.name ?? 'No client'}
          {job.city ? ` · ${job.city}` : ''}
          {estimate?.estimate_number ? ` · Est #${estimate.estimate_number}` : ''}
        </p>
      </div>

      {progress.hasEstimate ? (
        <>
          <div className="detail-summary">
            <div className="detail-summary-pct">
              <span className="num big">{formatPct(progress.overallPct)}</span>
              <span className="label">complete · {formatMoney(progress.builtAmount)} of {formatMoney(progress.bidAmount)}</span>
            </div>
            <ProgressBar pct={progress.overallPct} />
          </div>

          <h2>Estimate line items</h2>
          <div className="lines">
            {progress.lines.map((line) => (
              <div key={line.key} className="line">
                <div className="line-top">
                  <span className="line-desc">{line.description}</span>
                  <span className="line-pct num">{formatPct(line.pct)}</span>
                </div>
                <ProgressBar pct={line.pct} overage={line.overage} />
                <div className="line-stats label">
                  <span className="num">
                    {formatQty(line.loggedQty)} / {formatQty(line.estimatedQty)}
                    {line.unit ? ` ${line.unit}` : ''}
                  </span>
                  <span className="num">
                    {line.remainingQty > 0
                      ? `${formatQty(line.remainingQty)} left`
                      : line.overage
                        ? `+${formatQty(-line.remainingQty)} over`
                        : 'done'}
                  </span>
                  <span className="num">@ {formatMoney(line.rate)}</span>
                </div>
                {line.productId && (
                  <Link
                    to={`/daily-log?job=${id}&product=${line.productId}`}
                    className="line-logs label"
                  >
                    View daily logs →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-card">
          <p className="label">No estimate on file</p>
          <p>Showing logged field work only. The bid baseline will appear once an estimate is imported for this job.</p>
        </div>
      )}

      {progress.extras.length > 0 && (
        <>
          <h2>Extra / off-estimate work</h2>
          <p className="muted section-note">Logged in the field but not on the estimate.</p>
          <div className="lines">
            {progress.extras.map((ex) => (
              <div key={ex.productId} className="line line-extra">
                <div className="line-top">
                  <span className="line-desc">{ex.description}</span>
                  <span className="num label">
                    {formatQty(ex.loggedQty)}
                    {ex.unit ? ` ${ex.unit}` : ''}
                  </span>
                </div>
                <Link
                  to={`/daily-log?job=${id}&product=${ex.productId}`}
                  className="line-logs label"
                >
                  View daily logs →
                </Link>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
