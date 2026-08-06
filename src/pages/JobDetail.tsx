import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createClient,
  deleteJobIfEmpty,
  fetchAllEstimates,
  fetchClients,
  fetchJob,
  fetchJobEstimate,
  fetchJobLoggedItems,
  fetchPriceList,
  mergeJobInto,
  updateJob,
} from '../lib/queries'
import {
  computeJobProgress,
  formatDate,
  formatMoney,
  formatPct,
  formatQty,
  type JobProgress,
} from '../lib/progress'
import type { Client, Estimate, EstimateFull, JobWithClient } from '../lib/types'

function estTotal(est: EstimateFull): number {
  return est.lines.reduce(
    (s, l) => s + (l.amount != null ? Number(l.amount) : Number(l.quantity) * Number(l.rate)),
    0,
  )
}
import { ProgressBar } from '../components/ProgressBar'

export function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobWithClient | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  // Link-an-estimate (merge a name-mismatched duplicate job into this one).
  const [linking, setLinking] = useState(false)
  const [allEstimates, setAllEstimates] = useState<EstimateFull[] | null>(null)
  const [selectedEstId, setSelectedEstId] = useState('')
  const [merging, setMerging] = useState(false)

  // Assign-a-client (for jobs the sync auto-created without one).
  const [editingClient, setEditingClient] = useState(false)
  const [clients, setClients] = useState<Client[] | null>(null)
  const [clientChoice, setClientChoice] = useState('') // client id, or '__new__'
  const [newClientName, setNewClientName] = useState('')
  const [savingClient, setSavingClient] = useState(false)

  async function openClientEditor() {
    setEditingClient(true)
    setClientChoice(job?.client_id ?? '')
    if (!clients) {
      try {
        setClients(await fetchClients())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  async function saveClient() {
    if (!id) return
    setSavingClient(true)
    try {
      let clientId: string | null
      if (clientChoice === '__new__') {
        const name = newClientName.trim()
        if (!name) {
          setSavingClient(false)
          return
        }
        const created = await createClient(name)
        setClients((prev) => (prev ? [...prev, created].sort((a, b) => a.name.localeCompare(b.name)) : prev))
        clientId = created.id
      } else {
        clientId = clientChoice || null
      }
      await updateJob(id, { client_id: clientId })
      setEditingClient(false)
      setNewClientName('')
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingClient(false)
    }
  }

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
  }, [id, reloadKey])

  async function openLinker() {
    setLinking(true)
    if (!allEstimates) {
      try {
        setAllEstimates(await fetchAllEstimates())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  async function linkEstimate() {
    if (!id || !selectedEstId || !allEstimates) return
    const est = allEstimates.find((e) => e.id === selectedEstId)
    if (!est) return
    if (!window.confirm(
      `Link Est #${est.estimate_number ?? '—'} (${est.job?.name ?? '—'}) to "${job!.name}"? ` +
        `Its estimate, invoices, and any logs merge into this job and the duplicate job is removed.`,
    )) return
    setMerging(true)
    try {
      await mergeJobInto(est.job_id, id) // move the estimate's job INTO this one
      setLinking(false)
      setSelectedEstId('')
      setAllEstimates(null) // force a fresh list next time
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMerging(false)
    }
  }

  if (loading) return <div className="page"><p className="muted">Loading job…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>
  if (!job || !progress) return <div className="page"><p className="muted">Job not found.</p></div>

  // A job is an empty shell (e.g. a deleted/test bid) when it has no estimate and
  // no logged field work. Such jobs can be removed; deleteJobIfEmpty re-checks
  // server-side (estimates/logs/invoices) so a real job is never deleted.
  const isEmpty = !progress.hasEstimate && progress.extras.length === 0

  async function removeJob() {
    if (!id) return
    if (!window.confirm(`Remove "${job!.name}"? This empty job will be deleted.`)) return
    setRemoving(true)
    try {
      const deleted = await deleteJobIfEmpty(id)
      if (deleted) {
        navigate('/')
      } else {
        setError('This job has logs, invoices, or an estimate — it wasn’t deleted.')
        setRemoving(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRemoving(false)
    }
  }

  return (
    <div className="page">
      <Link to="/" className="back-link label">← All jobs</Link>
      <div className="job-detail-head">
        <h1>{job.name}</h1>
        <p className="label">
          {job.client?.name ?? <span className="chip-warn">⚠ Needs client</span>}
          {job.city ? ` · ${job.city}` : ''}
          {estimate?.estimate_number ? ` · Est #${estimate.estimate_number}` : ''}
          {!editingClient && (
            <button type="button" className="link-btn" onClick={() => void openClientEditor()}>
              {job.client ? 'Change client' : 'Assign client'}
            </button>
          )}
        </p>

        {editingClient && (
          clients == null ? (
            <p className="muted">Loading clients…</p>
          ) : (
            <div className="client-editor">
              <label className="filter">
                <span className="label">Client for this job</span>
                <select value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
                  <option value="">— no client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  <option value="__new__">+ New client…</option>
                </select>
              </label>
              {clientChoice === '__new__' && (
                <label className="filter">
                  <span className="label">New client name</span>
                  <input
                    type="text"
                    placeholder="e.g. Mitchell X"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                </label>
              )}
              <div className="edit-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingClient || (clientChoice === '__new__' && !newClientName.trim())}
                  onClick={() => void saveClient()}
                >
                  {savingClient ? 'Saving…' : 'Save client'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={savingClient}
                  onClick={() => {
                    setEditingClient(false)
                    setNewClientName('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )
        )}
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
          <p>Showing logged field work only. If this job has a bid under a different name (the sync can split a logged job from its estimate), link it here.</p>
          {!linking ? (
            <div className="bill-action-row">
              <button type="button" className="btn-ghost" onClick={() => void openLinker()}>
                Link an estimate
              </button>
            </div>
          ) : allEstimates == null ? (
            <p className="muted">Loading estimates…</p>
          ) : (
            <div className="edit-items">
              <label className="filter">
                <span className="label">Pick the bid for this job</span>
                <select value={selectedEstId} onChange={(e) => setSelectedEstId(e.target.value)}>
                  <option value="">— choose an estimate —</option>
                  {allEstimates
                    .filter((e) => e.job_id !== id && e.status !== 'archived')
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        Est #{e.estimate_number ?? '—'} · {e.job?.name ?? '—'}
                        {e.job?.client?.name ? ` · ${e.job.client.name}` : ''} · {formatMoney(estTotal(e))}
                        {e.estimate_date ? ` · ${formatDate(e.estimate_date)}` : ''}
                      </option>
                    ))}
                </select>
              </label>
              <div className="edit-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!selectedEstId || merging}
                  onClick={() => void linkEstimate()}
                >
                  {merging ? 'Linking…' : 'Link & merge'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={merging}
                  onClick={() => {
                    setLinking(false)
                    setSelectedEstId('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isEmpty && (
        <div className="bill-action-row">
          <button
            type="button"
            className="btn-ghost edit-delete"
            disabled={removing}
            onClick={() => void removeJob()}
          >
            {removing ? 'Removing…' : 'Remove empty job'}
          </button>
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
