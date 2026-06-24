import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createClient,
  createEstimate,
  createJob,
  deleteEstimate,
  fetchAllEstimates,
  fetchClientPriceRules,
  fetchClients,
  fetchPriceList,
  updateEstimateStatus,
  type NewEstimateLine,
} from '../lib/queries'
import { nextEstimateNumber, seedRate } from '../lib/estimate'
import { formatDate, formatMoney } from '../lib/progress'
import type {
  Client,
  ClientPriceRule,
  EstimateFull,
  EstimateStatus,
  PriceListItem,
} from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)

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

// Quick view — open the estimate PDF in a new tab to look at it.
async function viewPdf(estimate: EstimateFull, productName: Map<string, string>) {
  const { viewEstimatePdf } = await import('../lib/pdf')
  viewEstimatePdf(estimate, productName)
}

export function Estimating() {
  const [clients, setClients] = useState<Client[]>([])
  const [estimates, setEstimates] = useState<EstimateFull[]>([])
  const [priceList, setPriceList] = useState<PriceListItem[]>([])
  const [rules, setRules] = useState<ClientPriceRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [clientFilter, setClientFilter] = useState<string>('') // '' = all clients
  const [showArchived, setShowArchived] = useState(false)
  const [draftsOnly, setDraftsOnly] = useState(false) // drafts stat toggles this filter
  const [search, setSearch] = useState('')

  async function load() {
    try {
      setLoading(true)
      const [c, e, p, r] = await Promise.all([
        fetchClients(),
        fetchAllEstimates(),
        fetchPriceList(),
        fetchClientPriceRules(),
      ])
      setClients(c)
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
        clients={clients}
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

  const archivedCount = estimates.filter((e) => e.status === 'archived').length
  const clientNames = [...new Set(estimates.map((e) => e.job?.client?.name).filter(Boolean))].sort() as string[]

  // Visible list: hide archived unless toggled on, optionally drafts-only (drafts
  // stat acts as a filter), apply the client filter, and sort most-recent first
  // (newest estimate date at the top, newest est # breaking ties).
  const q = search.trim().toLowerCase()
  const visible = estimates
    .filter((e) => (showArchived ? e.status === 'archived' : e.status !== 'archived'))
    .filter((e) => !draftsOnly || e.status === 'draft')
    .filter((e) => !clientFilter || e.job?.client?.name === clientFilter)
    .filter(
      (e) =>
        !q ||
        (e.job?.name ?? '').toLowerCase().includes(q) ||
        (e.job?.client?.name ?? '').toLowerCase().includes(q) ||
        String(e.estimate_number ?? '').toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        (b.estimate_date ?? '').localeCompare(a.estimate_date ?? '') ||
        (Number(b.estimate_number) || 0) - (Number(a.estimate_number) || 0),
    )

  const drafts = estimates.filter((e) => e.status === 'draft')
  const sent = estimates.filter((e) => e.status === 'sent_to_michelle')
  const totalValue = estimates
    .filter((e) => e.status !== 'archived')
    .reduce((s, e) => s + estimateTotal(e), 0)

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
        <button
          type="button"
          className={`stat stat-toggle${draftsOnly ? ' stat-toggle-active' : ''}`}
          onClick={() => {
            setShowArchived(false)
            setDraftsOnly((v) => !v)
          }}
          title="Show only draft estimates"
        >
          <span className="stat-value stat-accent">{drafts.length}</span>
          <span className="label">drafts{draftsOnly ? ' ✓' : ''}</span>
        </button>
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

      <div className="bill-overview-head">
        <h2>{showArchived ? 'Archived bids' : draftsOnly ? 'Draft estimates' : 'Estimate history'}</h2>
        <div className="est-filters">
          <label className="filter">
            <span className="label">Search</span>
            <input
              type="search"
              placeholder="Job, client, est #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {clientNames.length > 1 && (
            <label className="filter">
              <span className="label">Client</span>
              <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                <option value="">All clients</option>
                {clientNames.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? '← Active bids' : `Archived (${archivedCount})`}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty-card"><p className="label">{showArchived ? 'No archived bids.' : 'No estimates yet.'}</p></div>
      ) : (
        <div className="lines">
          {visible.map((est) => (
            <div key={est.id} className="logcard">
              <div className="logcard-head">
                <div>
                  <span className="logcard-date num">Est #{est.estimate_number ?? '—'}</span>
                  <span className="logcard-job">{est.job?.name ?? '—'}</span>
                  <span className="label logcard-meta">
                    {formatDate(est.estimate_date) || 'no date'} · {est.job?.client?.name ?? 'No client'}
                  </span>
                </div>
                <span className={`pill ${est.status === 'draft' ? 'pill-draft' : est.status === 'archived' ? 'pill-archived' : 'pill-sent'}`}>
                  {est.status === 'draft' ? 'Draft' : est.status === 'archived' ? 'Archived' : 'Sent'}
                </span>
              </div>
              <div className="logcard-foot label">
                <span className="num bill-total">{formatMoney(estimateTotal(est))}</span>
                <button type="button" className="btn-ghost" onClick={() => void viewPdf(est, productName)}>
                  View
                </button>
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
                {est.status === 'archived' ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={async () => {
                      await updateEstimateStatus(est.id, 'sent_to_michelle')
                      await load()
                    }}
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={async () => {
                      await updateEstimateStatus(est.id, 'archived')
                      await load()
                    }}
                  >
                    Archive
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
  clients,
  priceList,
  rules,
  existingNumbers,
  productName,
  onCancel,
  onSaved,
}: {
  clients: Client[]
  priceList: PriceListItem[]
  rules: ClientPriceRule[]
  existingNumbers: (string | null)[]
  productName: Map<string, string>
  onCancel: () => void
  onSaved: () => void | Promise<void>
}) {
  // An estimate always starts a brand-new job — just type the job name. The
  // client is chosen separately so its pricing rules (e.g. Noland) auto-apply.
  const [jobName, setJobName] = useState('')
  const [clientId, setClientId] = useState<string>('')
  const [newClientName, setNewClientName] = useState('') // used when clientId === '__new__'
  const [estNumber, setEstNumber] = useState(() => nextEstimateNumber(existingNumbers))
  const [estDate, setEstDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const savedRef = useRef(false)

  const client = clients.find((c) => c.id === clientId) ?? null
  // Client rules for the chosen client (auto-applied when seeding lines).
  const jobRules = useMemo(
    () => (clientId ? rules.filter((r) => r.client_id === clientId) : []),
    [rules, clientId],
  )

  const updateLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i))

  // Customer-facing description: append the client-rule tag (e.g. "(includes
  // shading)" for Noland) so the baked-in add-on shows on the line + the PDF.
  const seedDescription = (name: string, lineLabel: string | null) =>
    lineLabel ? `${name} (${lineLabel})` : name

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
        description: seedDescription(p.name, seeded.lineLabel),
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
      description: seedDescription(p.name, seeded.lineLabel),
      unit: p.unit,
      rate: String(seeded.rate),
      adjustment_note: seeded.adjustment ? seeded.note : null,
    })
  }

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0)

  async function save(status: EstimateStatus, andPdf: boolean) {
    if (saving || savedRef.current) return
    if (!jobName.trim()) {
      setErr('Enter a job name for this estimate.')
      return
    }
    if (clientId === '__new__' && !newClientName.trim()) {
      setErr('Enter the new client’s name (or pick an existing client).')
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

    // Always a new job — create it first, then attach the estimate to it.
    // If the user chose "+ New client", create that client up front.
    let id: string
    let jobId: string
    let resolvedClient: { id: string; name: string } | null = client
      ? { id: client.id, name: client.name }
      : null
    try {
      if (clientId === '__new__') {
        const nc = await createClient(newClientName.trim())
        resolvedClient = { id: nc.id, name: nc.name }
      }
      const newJob = await createJob({ name: jobName.trim(), client_id: resolvedClient?.id ?? null })
      jobId = newJob.id
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
            job: {
              id: jobId,
              name: jobName.trim(),
              client: resolvedClient,
            },
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
          <span className="label">Job name</span>
          <input
            type="text"
            value={jobName}
            placeholder="New job name"
            onChange={(e) => setJobName(e.target.value)}
          />
        </label>
        <label className="filter">
          <span className="label">Client</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— no client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="__new__">+ New client…</option>
          </select>
        </label>
        {clientId === '__new__' && (
          <label className="filter">
            <span className="label">New client name</span>
            <input
              type="text"
              value={newClientName}
              placeholder="Client name"
              autoFocus
              onChange={(e) => setNewClientName(e.target.value)}
            />
          </label>
        )}

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
