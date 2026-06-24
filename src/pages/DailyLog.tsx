import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  addDailyLogItem,
  addPriceItem,
  deleteDailyLog,
  deleteDailyLogItem,
  fetchAllDailyLogs,
  fetchClients,
  fetchPriceList,
  setDailyLogReviewed,
  updateDailyLog,
  updateDailyLogItem,
} from '../lib/queries'
import { formatDate, formatQty } from '../lib/progress'
import type { Client, DailyLogFull, PriceListItem } from '../lib/types'

const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : '')

// A report needs review when it carries a note or issue and hasn't been cleared.
const needsReview = (l: DailyLogFull): boolean =>
  !l.reviewed_at && !!((l.notes && l.notes.trim()) || (l.issues_delays && l.issues_delays.trim()))

export function DailyLog() {
  const [params, setParams] = useSearchParams()
  const [logs, setLogs] = useState<DailyLogFull[]>([])
  const [priceList, setPriceList] = useState<PriceListItem[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Filters live in the URL so deep-links from the job view work + are shareable.
  const fJob = params.get('job') ?? ''
  const fClient = params.get('client') ?? ''
  const fProduct = params.get('product') ?? ''
  const fFrom = params.get('from') ?? ''
  const fTo = params.get('to') ?? ''
  const fReview = params.get('review') === '1'

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true })

  async function load() {
    try {
      setLoading(true)
      const [logData, priceData, clientData] = await Promise.all([
        fetchAllDailyLogs(),
        fetchPriceList(),
        fetchClients(),
      ])
      setLogs(logData)
      setPriceList(priceData)
      setClients(clientData)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const productName = useMemo(
    () => new Map(priceList.map((p) => [p.id, p.name])),
    [priceList],
  )
  const productUnit = useMemo(
    () => new Map(priceList.map((p) => [p.id, p.unit])),
    [priceList],
  )

  // Jobs present in the data, for the job filter dropdown.
  const jobOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of logs) if (l.job) m.set(l.job.id, l.job.name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [logs])

  const reviewCount = useMemo(() => logs.filter(needsReview).length, [logs])

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (fReview && !needsReview(l)) return false
      if (fJob && l.job?.id !== fJob) return false
      if (fClient && l.job?.client?.id !== fClient) return false
      if (fFrom && d10(l.log_date) < fFrom) return false
      if (fTo && d10(l.log_date) > fTo) return false
      if (fProduct && !l.items.some((it) => it.product_id === fProduct)) return false
      return true
    })
  }, [logs, fReview, fJob, fClient, fFrom, fTo, fProduct])

  const hasFilter = !!(fJob || fClient || fProduct || fFrom || fTo || fReview)

  // Add a brand-new work type (price_list product) on the fly while editing a
  // report — for work the crew did that isn't in the price sheet yet. Rate seeds
  // at $0 (set it later in Price Sheet); the point here is logging the quantity.
  // NOTE: this only adds it to the dashboard's price list — the field Daily Report
  // app reads work types from the Google Sheet, so reflecting it there is the
  // Phase-5 cutover item (parallel-run: don't touch the daily app yet).
  async function createWorkType(name: string, unit: string): Promise<PriceListItem> {
    const item = await addPriceItem({ name, category: null, unit: unit || 'EA', default_rate: 0 })
    setPriceList((prev) => [...prev, item])
    return item
  }

  async function markReviewed(id: string, reviewed: boolean) {
    await setDailyLogReviewed(id, reviewed)
    window.dispatchEvent(new Event('logs-reviewed')) // refresh the tab badge
    await load()
  }

  if (loading) return <div className="page"><p className="muted">Loading daily logs…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>

  return (
    <div className="page">
      <div className="job-detail-head">
        <h1>Daily Log</h1>
        <p className="label">
          {filtered.length} of {logs.length} report{logs.length === 1 ? '' : 's'}
          {hasFilter ? ' · filtered' : ''}
        </p>
      </div>

      {reviewCount > 0 && (
        <button
          type="button"
          className={`review-banner${fReview ? ' review-banner-active' : ''}`}
          onClick={() => setFilter('review', fReview ? '' : '1')}
        >
          <span className="review-banner-icon">⚠</span>
          <span>
            <strong>{reviewCount}</strong> report{reviewCount === 1 ? '' : 's'} need review
            <span className="label"> — a note or issue was logged</span>
          </span>
          <span className="label review-banner-cta">{fReview ? 'Show all' : 'Review →'}</span>
        </button>
      )}

      <div className="filters">
        <label className="filter">
          <span className="label">Job</span>
          <select value={fJob} onChange={(e) => setFilter('job', e.target.value)}>
            <option value="">All jobs</option>
            {jobOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="label">Client</span>
          <select value={fClient} onChange={(e) => setFilter('client', e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="label">Work type</span>
          <select value={fProduct} onChange={(e) => setFilter('product', e.target.value)}>
            <option value="">All work types</option>
            {priceList.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="label">From</span>
          <input type="date" value={fFrom} onChange={(e) => setFilter('from', e.target.value)} />
        </label>
        <label className="filter">
          <span className="label">To</span>
          <input type="date" value={fTo} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
        {hasFilter && (
          <button type="button" className="btn-ghost filter-clear" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-card">
          <p className="label">No daily reports match these filters.</p>
        </div>
      ) : (
        <div className="lines">
          {filtered.map((log) =>
            editingId === log.id ? (
              <LogEditor
                key={log.id}
                log={log}
                priceList={priceList}
                onCreateWorkType={createWorkType}
                onCancel={() => setEditingId(null)}
                onSaved={async () => {
                  setEditingId(null)
                  await load()
                }}
              />
            ) : (
              <article key={log.id} className={`logcard${needsReview(log) ? ' logcard-review' : ''}`}>
                <div className="logcard-head">
                  <div>
                    <span className="logcard-date num">{formatDate(log.log_date)}</span>
                    {needsReview(log) && <span className="pill pill-review">Needs review</span>}
                    <span className="logcard-job">
                      {log.job ? (
                        <Link to={`/jobs/${log.job.id}`}>{log.job.name}</Link>
                      ) : (
                        'Unassigned'
                      )}
                    </span>
                    <span className="label logcard-meta">
                      {log.job?.client?.name ?? 'No client'}
                      {log.submitted_by ? ` · ${log.submitted_by}` : ''}
                    </span>
                  </div>
                  <div className="logcard-head-actions">
                    {needsReview(log) ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => void markReviewed(log.id, true)}
                      >
                        ✓ Mark reviewed
                      </button>
                    ) : log.reviewed_at && ((log.notes && log.notes.trim()) || (log.issues_delays && log.issues_delays.trim())) ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => void markReviewed(log.id, false)}
                      >
                        Re-flag
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setEditingId(log.id)}
                    >
                      Edit
                    </button>
                  </div>
                </div>

                <div className="logitems">
                  {log.items.length === 0 ? (
                    <span className="muted">No work items.</span>
                  ) : (
                    log.items.map((it) => (
                      <div
                        key={it.id}
                        className={`logitem${fProduct && it.product_id === fProduct ? ' logitem-hit' : ''}`}
                      >
                        <span>{it.product_id ? productName.get(it.product_id) ?? 'Unknown' : 'Unknown'}</span>
                        <span className="num">
                          {formatQty(Number(it.quantity))}
                          {it.product_id && productUnit.get(it.product_id)
                            ? ` ${productUnit.get(it.product_id)}`
                            : ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {(log.concrete_yards != null || log.ready_to_bill || log.notes || log.issues_delays) && (
                  <div className="logcard-foot label">
                    {log.concrete_yards != null && <span>{formatQty(Number(log.concrete_yards))} yd³ concrete</span>}
                    {log.ready_to_bill && <span className="pill pill-warn">Ready to bill</span>}
                    {log.notes && <span className="lognote">📝 {log.notes}</span>}
                    {log.issues_delays && <span className="lognote">⚠ {log.issues_delays}</span>}
                  </div>
                )}
              </article>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────── Inline editor ───────────────────────────

interface DraftItem {
  id?: string // present = existing row
  product_id: string | null
  quantity: string
}

function LogEditor({
  log,
  priceList,
  onCreateWorkType,
  onCancel,
  onSaved,
}: {
  log: DailyLogFull
  priceList: PriceListItem[]
  onCreateWorkType: (name: string, unit: string) => Promise<PriceListItem>
  onCancel: () => void
  onSaved: () => void | Promise<void>
}) {
  const [logDate, setLogDate] = useState(d10(log.log_date))
  const [submittedBy, setSubmittedBy] = useState(log.submitted_by ?? '')
  const [yards, setYards] = useState(log.concrete_yards != null ? String(log.concrete_yards) : '')
  const [readyToBill, setReadyToBill] = useState(log.ready_to_bill)
  const [notes, setNotes] = useState(log.notes ?? '')
  const [issues, setIssues] = useState(log.issues_delays ?? '')
  const [items, setItems] = useState<DraftItem[]>(
    log.items.map((it) => ({
      id: it.id,
      product_id: it.product_id,
      quantity: String(it.quantity),
    })),
  )
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Inline "new work type" mini-form — creates a price_list product on the fly,
  // then drops it in as a new work item on this report.
  const [ntOpen, setNtOpen] = useState(false)
  const [ntName, setNtName] = useState('')
  const [ntUnit, setNtUnit] = useState('EA')

  async function addNewType() {
    if (!ntName.trim()) {
      setErr('Enter a name for the new work type.')
      return
    }
    try {
      const p = await onCreateWorkType(ntName.trim(), ntUnit.trim() || 'EA')
      setItems((prev) => [...prev, { product_id: p.id, quantity: '0' }])
      setNtName('')
      setNtUnit('EA')
      setNtOpen(false)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const updateItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const removeItem = (idx: number) =>
    setItems((prev) => {
      const it = prev[idx]
      if (it.id) setRemovedIds((r) => [...r, it.id!])
      return prev.filter((_, i) => i !== idx)
    })

  const addItem = () =>
    setItems((prev) => [...prev, { product_id: priceList[0]?.id ?? null, quantity: '0' }])

  async function save() {
    try {
      setSaving(true)
      setErr(null)
      await updateDailyLog(log.id, {
        log_date: logDate,
        submitted_by: submittedBy || null,
        concrete_yards: yards === '' ? null : Number(yards),
        notes: notes || null,
        issues_delays: issues || null,
        ready_to_bill: readyToBill,
      })

      for (const id of removedIds) await deleteDailyLogItem(id)

      const original = new Map(log.items.map((it) => [it.id, it]))
      for (const it of items) {
        const qty = Number(it.quantity) || 0
        if (it.id) {
          const orig = original.get(it.id)
          if (orig && (Number(orig.quantity) !== qty || orig.product_id !== it.product_id)) {
            await updateDailyLogItem(it.id, { product_id: it.product_id, quantity: qty })
          }
        } else {
          await addDailyLogItem(log.id, it.product_id, qty)
        }
      }

      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  async function removeLog() {
    if (!window.confirm('Delete this entire daily report? This cannot be undone.')) return
    try {
      setSaving(true)
      await deleteDailyLog(log.id)
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <article className="logcard logcard-editing">
      <div className="logcard-head">
        <strong>{log.job?.name ?? 'Unassigned'}</strong>
        <span className="label">Editing report</span>
      </div>

      <div className="edit-grid">
        <label className="filter">
          <span className="label">Date</span>
          <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
        </label>
        <label className="filter">
          <span className="label">Submitted by</span>
          <input type="text" value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} />
        </label>
        <label className="filter">
          <span className="label">Concrete (yd³)</span>
          <input
            type="number"
            inputMode="decimal"
            value={yards}
            onChange={(e) => setYards(e.target.value)}
          />
        </label>
        <label className="filter filter-check">
          <input
            type="checkbox"
            checked={readyToBill}
            onChange={(e) => setReadyToBill(e.target.checked)}
          />
          <span className="label">Ready to bill</span>
        </label>
      </div>

      <div className="edit-items">
        <span className="label">Work items</span>
        {items.map((it, idx) => (
          <div key={it.id ?? `new-${idx}`} className="edit-item">
            <select
              value={it.product_id ?? ''}
              onChange={(e) => updateItem(idx, { product_id: e.target.value || null })}
            >
              <option value="">— work type —</option>
              {priceList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              type="number"
              inputMode="decimal"
              className="edit-qty"
              value={it.quantity}
              onChange={(e) => updateItem(idx, { quantity: e.target.value })}
            />
            <button type="button" className="btn-ghost edit-rm" onClick={() => removeItem(idx)}>
              ✕
            </button>
          </div>
        ))}
        <div className="edit-actions">
          <button type="button" className="btn-ghost" onClick={addItem}>
            + Add work item
          </button>
          <button type="button" className="btn-ghost" onClick={() => setNtOpen((v) => !v)}>
            {ntOpen ? 'Cancel new type' : '+ New work type'}
          </button>
        </div>
        {ntOpen && (
          <div className="edit-item">
            <input
              type="text"
              placeholder="New work type name"
              value={ntName}
              autoFocus
              onChange={(e) => setNtName(e.target.value)}
            />
            <input
              type="text"
              className="edit-qty"
              placeholder="unit"
              aria-label="unit"
              value={ntUnit}
              onChange={(e) => setNtUnit(e.target.value)}
            />
            <button type="button" className="btn-ghost" onClick={() => void addNewType()}>
              Add
            </button>
          </div>
        )}
      </div>

      <label className="filter">
        <span className="label">Notes</span>
        <textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="filter">
        <span className="label">Issues / delays</span>
        <textarea value={issues} rows={2} onChange={(e) => setIssues(e.target.value)} />
      </label>

      {err && <p className="error-text">{err}</p>}

      <div className="edit-actions">
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn-ghost edit-delete" onClick={removeLog} disabled={saving}>
          Delete report
        </button>
      </div>
    </article>
  )
}
