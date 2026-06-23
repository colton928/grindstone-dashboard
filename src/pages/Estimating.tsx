import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createEstimate,
  deleteEstimate,
  fetchAllEstimates,
  fetchAllJobs,
  fetchClientPriceRules,
  fetchPriceList,
  updateEstimateStatus,
  type NewEstimateLine,
} from '../lib/queries'
import { nextEstimateNumber, seedRate } from '../lib/estimate'
import { formatMoney } from '../lib/progress'
import type {
  ClientPriceRule,
  EstimateFull,
  EstimateStatus,
  JobWithClient,
  PriceListItem,
} from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)
const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : '')

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

function estimateTotal(est: EstimateFull): number {
  return est.lines.reduce(
    (s, l) => s + (l.amount != null ? Number(l.amount) : Number(l.quantity) * Number(l.rate)),
    0,
  )
}

async function sharePdf(estimate: EstimateFull, productName: Map<string, string>) {
  const { shareEstimatePdf } = await import('../lib/pdf')
  await shareEstimatePdf(estimate, productName)
}

export function Estimating() {
  const [jobs, setJobs] = useState<JobWithClient[]>([])
  const [estimates, setEstimates] = useState<EstimateFull[]>([])
  const [priceList, setPriceList] = useState<PriceListItem[]>([])
  const [rules, setRules] = useState<ClientPriceRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      setLoading(true)
      const [j, e, p, r] = await Promise.all([
        fetchAllJobs(),
        fetchAllEstimates(),
        fetchPriceList(),
        fetchClientPriceRules(),
      ])
      setJobs(j)
      setEstimates(e)
      setPriceList(p)
      setRules(r)
      setError(null)
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const productName = useMemo(() => new Map(priceList.map((p) => [p.id, p.name])), [priceList])

  if (loading) return <div className="page"><p className="muted">Loading estimates…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>

  if (creating) {
    return (
      <NewEstimateEditor
        jobs={jobs}
        priceList={priceList.filter((p) => p.active)}
        rules={rules}
        existingNumbers={estimates.map((e) => e.estimate_number)}
        productName={productName}
        onCancel={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false)
          await load()
        }}
      />
    )
  }

  const drafts = estimates.filter((e) => e.status === 'draft')
  const sent = estimates.filter((e) => e.status === 'sent_to_michelle')
  const totalValue = estimates.reduce((s, e) => s + estimateTotal(e), 0)

  return (
    <div className="page">
      <div className="job-detail-head">
        <h1>Estimating</h1>
        <p className="label">Build bids off the price sheet. Client rules apply automatically; each estimate locks its own rates.</p>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{estimates.length}</span>
          <span className="label">estimates</span>
        </div>
        <div className="stat">
          <span className="stat-value stat-accent">{drafts.length}</span>
          <span className="label">drafts</span>
        </div>
        <div className="stat">
          <span className="stat-value">{sent.length}</span>
          <span className="label">sent</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatMoney(totalValue)}</span>
          <span className="label">total bid value</span>
        </div>
      </div>

      <div className="bill-action-row">
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          + New estimate
        </button>
      </div>

      <h2>Estimate history</h2>
      {estimates.length === 0 ? (
        <div className="empty-card"><p className="label">No estimates yet.</p></div>
      ) : (
        <div className="lines">
          {estimates.map((est) => (
            <div key={est.id} className="logcard">
              <div className="logcard-head">
                <div>
                  <span className="logcard-date num">Est #{est.estimate_number ?? '—'}</span>
                  <span className="logcard-job">{est.job?.name ?? '—'}</span>
                  <span className="label logcard-meta">
                    {d10(est.estimate_date) || 'no date'} · {est.job?.client?.name ?? 'No client'}
                  </span>
                </div>
                <span className={`pill ${est.status === 'draft' ? 'pill-draft' : 'pill-sent'}`}>
                  {est.status === 'draft' ? 'Draft' : 'Sent'}
                </span>
              </div>
              <div className="logcard-foot label">
                <span className="num bill-total">{formatMoney(estimateTotal(est))}</span>
                <button type="button" className="btn-ghost" onClick={() => void sharePdf(est, productName)}>
                  Send PDF
                </button>
                {est.status === 'draft' && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={async () => {
                      await updateEstimateStatus(est.id, 'sent_to_michelle')
                      await load()
                    }}
                  >
                    Mark sent
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost edit-delete"
                  onClick={async () => {
                    if (!window.confirm(`Delete Est #${est.estimate_number ?? ''} for ${est.job?.name}?`)) return
                    await deleteEstimate(est.id)
                    await load()
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────── New estimate editor ───────────────────────

interface DraftLine {
  product_id: string | null
  description: string
  unit: string | null
  quantity: string
  rate: string
  adjustment_note: string | null
}

function NewEstimateEditor({
  jobs,
  priceList,
  rules,
  existingNumbers,
  productName,
  onCancel,
  onSaved,
}: {
  jobs: JobWithClient[]
  priceList: PriceListItem[]
  rules: ClientPriceRule[]
  existingNumbers: (string | null)[]
  productName: Map<string, string>
  onCancel: () => void
  onSaved: () => void | Promise<void>
}) {
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? '')
  const [estNumber, setEstNumber] = useState(() => nextEstimateNumber(existingNumbers))
  const [estDate, setEstDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const savedRef = useRef(false)

  const job = jobs.find((j) => j.id === jobId) ?? null
  // Client rules for the selected job's client (auto-applied when seeding lines).
  const jobRules = useMemo(
    () => (job?.client_id ? rules.filter((r) => r.client_id === job.client_id) : []),
    [rules, job],
  )

  const updateLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i))

  const addLine = () => {
    const p = priceList[0]
    if (!p) {
      setLines((prev) => [...prev, { product_id: null, description: '', unit: null, quantity: '0', rate: '0', adjustment_note: null }])
      return
    }
    const seeded = seedRate(p, jobRules)
    setLines((prev) => [
      ...prev,
      {
        product_id: p.id,
        description: p.name,
        unit: p.unit,
        quantity: '0',
        rate: String(seeded.rate),
        adjustment_note: seeded.adjustment ? seeded.note : null,
      },
    ])
  }

  const onPickProduct = (i: number, productId: string) => {
    const p = priceList.find((x) => x.id === productId)
    if (!p) {
      updateLine(i, { product_id: null, description: '', unit: null, rate: '0', adjustment_note: null })
      return
    }
    const seeded = seedRate(p, jobRules)
    updateLine(i, {
      product_id: p.id,
      description: p.name,
      unit: p.unit,
      rate: String(seeded.rate),
      adjustment_note: seeded.adjustment ? seeded.note : null,
    })
  }

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0)

  async function save(status: EstimateStatus, andPdf: boolean) {
    if (saving || savedRef.current) return
    if (!jobId) {
      setErr('Pick a job for this estimate.')
      return
    }
    setSaving(true)
    setErr(null)

    const payload: NewEstimateLine[] = lines
      .filter((l) => (Number(l.quantity) || 0) !== 0)
      .map((l, idx) => ({
        product_id: l.product_id,
        description: l.description || null,
        unit: l.unit,
        quantity: Number(l.quantity) || 0,
        rate: Number(l.rate) || 0,
        adjustment_note: l.adjustment_note,
        sort_order: idx,
      }))

    if (payload.length === 0) {
      setErr('Add at least one line with a quantity before saving.')
      setSaving(false)
      return
    }

    let id: string
    try {
      id = await createEstimate(
        {
          job_id: jobId,
          estimate_number: estNumber || null,
          estimate_date: estDate || today(),
          status,
          notes: notes || null,
        },
        payload,
      )
      savedRef.current = true
    } catch (e) {
      setErr(errMsg(e))
      setSaving(false)
      return
    }

    if (andPdf) {
      try {
        await sharePdf(
          {
            id,
            job_id: jobId,
            estimate_number: estNumber || null,
            estimate_date: estDate || today(),
            status,
            notes: notes || null,
            job: job ? { id: job.id, name: job.name, client: job.client ?? null } : null,
            lines: payload.map((l, idx) => ({
              id: `tmp-${idx}`,
              estimate_id: id,
              product_id: l.product_id,
              description: l.description,
              unit: l.unit,
              quantity: l.quantity,
              rate: l.rate,
              adjustment_note: l.adjustment_note,
              amount: l.quantity * l.rate,
              sort_order: l.sort_order,
            })),
          },
          productName,
        )
      } catch {
        /* sharing failed — estimate is saved; user can re-send from history */
      }
    }

    await onSaved()
  }

  return (
    <div className="page">
      <button type="button" className="back-link label" onClick={onCancel}>← All estimates</button>
      <div className="job-detail-head">
        <h1>New estimate</h1>
        <p className="label">Rates seed from the price sheet{jobRules.length ? ' + this client’s rules' : ''} — adjust per line as needed.</p>
      </div>

      <div className="logcard logcard-editing">
        <label className="filter">
          <span className="label">Job</span>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            {jobs.length === 0 && <option value="">No jobs</option>}
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}{j.client?.name ? ` — ${j.client.name}` : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="edit-grid">
          <label className="filter">
            <span className="label">Estimate #</span>
            <input type="text" value={estNumber} onChange={(e) => setEstNumber(e.target.value)} />
          </label>
          <label className="filter">
            <span className="label">Date</span>
            <input type="date" value={estDate} onChange={(e) => setEstDate(e.target.value)} />
          </label>
        </div>

        <div className="edit-items">
          <span className="label">Line items</span>
          {lines.length === 0 && <p className="muted">No lines yet — add one below.</p>}
          {lines.map((l, i) => (
            <div key={i} className="bill-line">
              <select value={l.product_id ?? ''} onChange={(e) => onPickProduct(i, e.target.value)}>
                <option value="">— custom —</option>
                {priceList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="bill-line-nums">
                <input
                  type="number"
                  inputMode="decimal"
                  className="edit-qty"
                  aria-label="quantity"
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                />
                <span className="label bill-x">×</span>
                <input
                  type="number"
                  inputMode="decimal"
                  className="edit-qty"
                  aria-label="rate"
                  value={l.rate}
                  onChange={(e) => updateLine(i, { rate: e.target.value })}
                />
                <span className="num bill-line-amt">
                  {formatMoney((Number(l.quantity) || 0) * (Number(l.rate) || 0))}
                </span>
                <button type="button" className="btn-ghost edit-rm" onClick={() => removeLine(i)}>✕</button>
              </div>
              {l.adjustment_note && <span className="label est-adj">↳ {l.adjustment_note}</span>}
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={addLine}>+ Add line</button>
        </div>

        <div className="bill-total-row">
          <span className="label">Estimate total</span>
          <span className="num bill-grand">{formatMoney(total)}</span>
        </div>

        <label className="filter">
          <span className="label">Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {err && <p className="error-text">{err}</p>}

        <div className="edit-actions">
          <button type="button" className="btn-primary" disabled={saving} onClick={() => save('sent_to_michelle', true)}>
            {saving ? 'Saving…' : 'Save & send PDF'}
          </button>
          <button type="button" className="btn-ghost" disabled={saving} onClick={() => save('draft', false)}>
            Save draft
          </button>
          <button type="button" className="btn-ghost" disabled={saving} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
