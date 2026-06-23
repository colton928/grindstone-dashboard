import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createInvoice,
  deleteInvoice,
  fetchAllInvoices,
  fetchBillingData,
  fetchPriceList,
  replaceInvoiceLines,
  updateInvoice,
  updateInvoiceStatus,
  type BillingRawData,
  type NewInvoiceLine,
} from '../lib/queries'
import { computeJobBilling, type JobBilling } from '../lib/billing'
import { formatDate, formatMoney, formatQty } from '../lib/progress'
import type {
  InvoiceFull,
  InvoiceStatus,
  JobWithClient,
  PriceListItem,
} from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)

// Lazy-load jsPDF (~450KB) only when a PDF is actually generated, then open the
// native share sheet (falls back to download).
async function sharePdf(invoice: InvoiceFull, productName: Map<string, string>) {
  const { shareInvoicePdf } = await import('../lib/pdf')
  await shareInvoicePdf(invoice, productName)
}

// Quick view — open the invoice PDF in a new tab to look at it.
async function viewPdf(invoice: InvoiceFull, productName: Map<string, string>) {
  const { viewInvoicePdf } = await import('../lib/pdf')
  viewInvoicePdf(invoice, productName)
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export function Billing() {
  const [data, setData] = useState<BillingRawData | null>(null)
  const [invoices, setInvoices] = useState<InvoiceFull[]>([])
  const [priceList, setPriceList] = useState<PriceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  // When the user hits "Edit" on a draft from the overview, jump to that job's
  // billing detail with the draft already open in the editor.
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(null)

  async function load() {
    try {
      setLoading(true)
      const [billing, inv, prices] = await Promise.all([
        fetchBillingData(),
        fetchAllInvoices(),
        fetchPriceList(),
      ])
      setData(billing)
      setInvoices(inv)
      setPriceList(prices)
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

  const productName = useMemo(() => new Map(priceList.map((p) => [p.id, p.name])), [priceList])

  // Per-job billing computed from the bulk pull.
  const billingByJob = useMemo(() => {
    const m = new Map<string, JobBilling>()
    if (!data) return m
    const by = <T extends { job_id: string }>(rows: T[]) => {
      const g = new Map<string, T[]>()
      for (const r of rows) {
        const a = g.get(r.job_id) ?? []
        a.push(r)
        g.set(r.job_id, a)
      }
      return g
    }
    const logged = by(data.logged)
    const billed = by(data.billed)
    const est = by(data.estRates)
    for (const job of data.jobs) {
      m.set(
        job.id,
        computeJobBilling(
          logged.get(job.id) ?? [],
          billed.get(job.id) ?? [],
          est.get(job.id) ?? [],
          priceList,
        ),
      )
    }
    return m
  }, [data, priceList])

  if (loading) return <div className="page"><p className="muted">Loading billing…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>
  if (!data) return null

  const selectedJob = data.jobs.find((j) => j.id === selectedJobId) ?? null

  if (selectedJob) {
    return (
      <JobBillingDetail
        job={selectedJob}
        billing={billingByJob.get(selectedJob.id)!}
        invoices={invoices.filter((i) => i.job_id === selectedJob.id)}
        priceList={priceList}
        productName={productName}
        initialEditId={editInvoiceId}
        onBack={() => {
          setSelectedJobId(null)
          setEditInvoiceId(null)
        }}
        onChanged={load}
      />
    )
  }

  // ── Overview ──
  const jobsNeeding = data.jobs
    .filter((j) => (billingByJob.get(j.id)?.hasUnbilled ?? false))
    .sort(
      (a, b) =>
        (billingByJob.get(b.id)?.remainingValue ?? 0) -
        (billingByJob.get(a.id)?.remainingValue ?? 0),
    )

  const totalRemaining = data.jobs.reduce(
    (s, j) => s + (billingByJob.get(j.id)?.remainingValue ?? 0),
    0,
  )
  const totalBilled = data.jobs.reduce(
    (s, j) => s + (billingByJob.get(j.id)?.billedValue ?? 0),
    0,
  )

  return (
    <div className="page">
      <div className="job-detail-head">
        <h1>Billing</h1>
        <p className="label">What's billed, what's left, and your invoice history.</p>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-value stat-accent">{formatMoney(totalRemaining)}</span>
          <span className="label">left to bill</span>
        </div>
        <div className="stat">
          <span className="stat-value">{jobsNeeding.length}</span>
          <span className="label">jobs to bill</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatMoney(totalBilled)}</span>
          <span className="label">billed all-time</span>
        </div>
        <div className="stat">
          <span className="stat-value">{invoices.length}</span>
          <span className="label">invoices</span>
        </div>
      </div>

      <h2>Ready to bill</h2>
      {jobsNeeding.length === 0 ? (
        <div className="empty-card"><p className="label">Nothing outstanding — all logged work is billed.</p></div>
      ) : (
        <div className="job-grid">
          {jobsNeeding.map((job) => {
            const b = billingByJob.get(job.id)!
            return (
              <button key={job.id} className="job-card billing-card" onClick={() => setSelectedJobId(job.id)}>
                <div className="job-card-head">
                  <div>
                    <div className="job-name">{job.name}</div>
                    <div className="label job-meta">{job.client?.name ?? 'No client'}</div>
                  </div>
                  <span className="pill pill-warn">Bill</span>
                </div>
                <div className="job-card-pct">
                  <span className="num">{formatMoney(b.remainingValue)}</span>
                  <span className="label">to bill</span>
                </div>
                <div className="label">{formatMoney(b.billedValue)} billed so far</div>
              </button>
            )
          })}
        </div>
      )}

      <h2>Invoice history</h2>
      {invoices.length === 0 ? (
        <div className="empty-card"><p className="label">No invoices yet.</p></div>
      ) : (
        <div className="lines">
          {invoices.map((inv) => {
            const total = inv.lines.reduce(
              (s, l) => s + (l.amount != null ? Number(l.amount) : Number(l.quantity) * Number(l.rate)),
              0,
            )
            return (
              <div key={inv.id} className="logcard">
                <div className="logcard-head">
                  <div>
                    <span className="logcard-date num">{formatDate(inv.date_sent) || 'draft'}</span>
                    <span className="logcard-job">{inv.job?.name ?? '—'}</span>
                    <span className="label logcard-meta">
                      Bill #{inv.bill_number ?? '—'} · {inv.job?.client?.name ?? 'No client'}
                    </span>
                  </div>
                  <span className={`pill ${inv.status === 'draft' ? 'pill-draft' : 'pill-sent'}`}>
                    {inv.status === 'draft' ? 'Draft' : 'Sent'}
                  </span>
                </div>
                <div className="logcard-foot label">
                  <span className="num bill-total">{formatMoney(total)}</span>
                  <button type="button" className="btn-ghost" onClick={() => void viewPdf(inv, productName)}>
                    View
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => void sharePdf(inv, productName)}>
                    Send PDF
                  </button>
                  {inv.status === 'draft' && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          setEditInvoiceId(inv.id)
                          setSelectedJobId(inv.job_id)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={async () => {
                          await updateInvoiceStatus(inv.id, 'sent_to_michelle')
                          await load()
                        }}
                      >
                        Mark sent
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn-ghost edit-delete"
                    onClick={async () => {
                      if (!window.confirm(`Delete Bill #${inv.bill_number ?? ''} for ${inv.job?.name}?`)) return
                      await deleteInvoice(inv.id)
                      await load()
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────── Job billing detail ───────────────────────

function JobBillingDetail({
  job,
  billing,
  invoices,
  priceList,
  productName,
  initialEditId,
  onBack,
  onChanged,
}: {
  job: JobWithClient
  billing: JobBilling
  invoices: InvoiceFull[]
  priceList: PriceListItem[]
  productName: Map<string, string>
  initialEditId?: string | null
  onBack: () => void
  onChanged: () => void | Promise<void>
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<InvoiceFull | null>(
    () => invoices.find((i) => i.id === initialEditId) ?? null,
  )

  const nextBill = useMemo(() => {
    const nums = invoices
      .map((i) => parseInt(i.bill_number ?? '', 10))
      .filter((n) => !Number.isNaN(n))
    return String((nums.length ? Math.max(...nums) : 0) + 1)
  }, [invoices])

  return (
    <div className="page">
      <button type="button" className="back-link label" onClick={onBack}>← All billing</button>
      <div className="job-detail-head">
        <h1>{job.name}</h1>
        <p className="label">{job.client?.name ?? 'No client'}</p>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{formatMoney(billing.loggedValue)}</span>
          <span className="label">logged value</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatMoney(billing.billedValue)}</span>
          <span className="label">billed</span>
        </div>
        <div className="stat">
          <span className="stat-value stat-accent">{formatMoney(billing.remainingValue)}</span>
          <span className="label">left to bill</span>
        </div>
      </div>

      {creating || editing ? (
        <DraftInvoiceEditor
          job={job}
          billing={billing}
          priceList={priceList}
          nextBill={nextBill}
          productName={productName}
          existing={editing}
          onCancel={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setCreating(false)
            setEditing(null)
            await onChanged()
          }}
        />
      ) : (
        <>
          <div className="bill-action-row">
            <button
              type="button"
              className="btn-primary"
              disabled={!billing.hasUnbilled}
              onClick={() => setCreating(true)}
            >
              {billing.hasUnbilled ? `Create bill #${nextBill}` : 'Nothing to bill'}
            </button>
          </div>

          <h2>Work logged vs. billed</h2>
          <div className="lines">
            {billing.lines.map((l) => (
              <div key={l.productId ?? l.description} className="line">
                <div className="line-top">
                  <span className="line-desc">{l.description}</span>
                  <span className="num label">@ {formatMoney(l.rate)}</span>
                </div>
                <div className="line-stats label">
                  <span className="num">logged {formatQty(l.loggedQty)}{l.unit ? ` ${l.unit}` : ''}</span>
                  <span className="num">billed {formatQty(l.billedQty)}</span>
                  <span className={`num ${l.remainingQty > 0.005 ? 'remain-hot' : ''}`}>
                    {l.remainingQty > 0.005 ? `${formatQty(l.remainingQty)} to bill` : 'fully billed'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {invoices.length > 0 && (
        <>
          <h2>This job's invoices</h2>
          <div className="lines">
            {invoices.map((inv) => {
              const total = inv.lines.reduce(
                (s, l) => s + (l.amount != null ? Number(l.amount) : Number(l.quantity) * Number(l.rate)),
                0,
              )
              return (
                <div key={inv.id} className="logcard">
                  <div className="logcard-head">
                    <div>
                      <span className="logcard-date num">Bill #{inv.bill_number ?? '—'}</span>
                      <span className="label logcard-meta">{formatDate(inv.date_sent) || 'no date'}</span>
                    </div>
                    <span className={`pill ${inv.status === 'draft' ? 'pill-draft' : 'pill-sent'}`}>
                      {inv.status === 'draft' ? 'Draft' : 'Sent'}
                    </span>
                  </div>
                  <div className="logcard-foot label">
                    <span className="num bill-total">{formatMoney(total)}</span>
                    <button type="button" className="btn-ghost" onClick={() => void viewPdf(inv, productName)}>View</button>
                    <button type="button" className="btn-ghost" onClick={() => void sharePdf(inv, productName)}>Send PDF</button>
                    {inv.status === 'draft' && (
                      <button type="button" className="btn-ghost" onClick={() => setEditing(inv)}>Edit</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────── Draft invoice editor ───────────────────────

interface DraftLine {
  product_id: string | null
  description: string
  unit: string | null
  quantity: string
  rate: string
}

function DraftInvoiceEditor({
  job,
  billing,
  priceList,
  nextBill,
  productName,
  existing,
  onCancel,
  onSaved,
}: {
  job: JobWithClient
  billing: JobBilling
  priceList: PriceListItem[]
  nextBill: string
  productName: Map<string, string>
  existing?: InvoiceFull | null
  onCancel: () => void
  onSaved: () => void | Promise<void>
}) {
  const isEdit = !!existing
  const [billNumber, setBillNumber] = useState(existing?.bill_number ?? nextBill)
  const [dateSent, setDateSent] = useState(
    existing?.date_sent ? existing.date_sent.slice(0, 10) : today(),
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [lines, setLines] = useState<DraftLine[]>(
    existing
      ? [...existing.lines]
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((l) => ({
            product_id: l.product_id,
            description: l.description ?? (l.product_id ? productName.get(l.product_id) ?? '' : ''),
            unit: l.unit,
            quantity: String(l.quantity),
            rate: String(l.rate),
          }))
      : billing.lines
          .filter((l) => l.remainingQty > 0.005)
          .map((l) => ({
            product_id: l.productId,
            description: l.description,
            unit: l.unit,
            quantity: String(l.remainingQty),
            rate: String(l.rate),
          })),
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const savedRef = useRef(false) // guards against double-submit creating duplicates

  const updateLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i))
  const addLine = () => {
    const p = priceList[0]
    setLines((prev) => [
      ...prev,
      { product_id: p?.id ?? null, description: p?.name ?? '', unit: p?.unit ?? null, quantity: '0', rate: String(p?.default_rate ?? 0) },
    ])
  }
  const onPickProduct = (i: number, productId: string) => {
    const p = priceList.find((x) => x.id === productId)
    updateLine(i, {
      product_id: productId || null,
      description: p?.name ?? '',
      unit: p?.unit ?? null,
      rate: p ? String(p.default_rate) : '0',
    })
  }

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0)

  async function save(status: InvoiceStatus, andPdf: boolean) {
    if (saving || savedRef.current) return // never create the same invoice twice
    setSaving(true)
    setErr(null)

    const payload: NewInvoiceLine[] = lines
      .filter((l) => (Number(l.quantity) || 0) !== 0)
      .map((l, idx) => ({
        product_id: l.product_id,
        description: l.description || null,
        unit: l.unit,
        quantity: Number(l.quantity) || 0,
        rate: Number(l.rate) || 0,
        sort_order: idx,
      }))

    if (payload.length === 0) {
      setErr('Add at least one line with a quantity before saving.')
      setSaving(false)
      return
    }

    // 1) Save the invoice — exactly once. A failure here is the only thing
    //    that should keep the editor open for a retry. Editing an existing
    //    draft updates it in place + replaces its lines; otherwise we create.
    const header = {
      bill_number: billNumber || null,
      date_sent: status === 'sent_to_michelle' ? dateSent || today() : dateSent || null,
      status,
      notes: notes || null,
    }
    let id: string
    try {
      if (existing) {
        await updateInvoice(existing.id, header)
        await replaceInvoiceLines(existing.id, payload)
        id = existing.id
      } else {
        id = await createInvoice({ job_id: job.id, ...header }, payload)
      }
      savedRef.current = true
    } catch (e) {
      setErr(errMsg(e))
      setSaving(false)
      return
    }

    // 2) PDF/share is best-effort — it must NOT block closing or cause a re-save.
    //    (The invoice is already saved and re-downloadable from history.)
    if (andPdf) {
      try {
        await sharePdf(
          {
            id,
            job_id: job.id,
            bill_number: billNumber || null,
            date_sent: dateSent || null,
            status,
            notes: notes || null,
            job: { id: job.id, name: job.name, client: job.client ?? null },
            lines: payload.map((l, idx) => ({
              id: `tmp-${idx}`,
              invoice_id: id,
              product_id: l.product_id,
              description: l.description,
              unit: l.unit,
              quantity: l.quantity,
              rate: l.rate,
              amount: l.quantity * l.rate,
              sort_order: l.sort_order,
            })),
          },
          productName,
        )
      } catch {
        /* sharing/printing failed — invoice is saved; user can re-send from history */
      }
    }

    // 3) Close + refresh.
    await onSaved()
  }

  return (
    <div className="logcard logcard-editing">
      <div className="logcard-head">
        <strong>{isEdit ? 'Edit invoice' : 'New invoice'} — {job.name}</strong>
        <span className="label">Bill #{billNumber}</span>
      </div>

      <div className="edit-grid">
        <label className="filter">
          <span className="label">Bill #</span>
          <input type="text" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
        </label>
        <label className="filter">
          <span className="label">Date</span>
          <input type="date" value={dateSent} onChange={(e) => setDateSent(e.target.value)} />
        </label>
      </div>

      <div className="edit-items">
        <span className="label">Line items</span>
        {lines.length === 0 && <p className="muted">No lines — add one below.</p>}
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
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={addLine}>+ Add line</button>
      </div>

      <div className="bill-total-row">
        <span className="label">Invoice total</span>
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
  )
}
