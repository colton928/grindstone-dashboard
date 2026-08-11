import { useMemo, useRef, useState } from 'react'
import { createClient, createJob } from '../lib/queries'
import type { Client, JobWithClient } from '../lib/types'

// A searchable combobox for choosing a job. Type to filter the (now long) job
// list by job OR client name; optionally create a brand-new job + client inline
// without leaving the picker. Mirrors LineItemPicker's interaction + styling so
// the two feel the same. Reused by the Logs Move panel, the Logs job filter, and
// the Schedule event editor — each supplies only the props it needs.
export function JobPicker({
  jobs,
  value,
  onChange,
  placeholder = 'Type to search jobs…',
  clearLabel,
  excludeJobId = null,
  disabled = false,
  allowCreate = false,
  clients = [],
  onJobCreated,
  onClientCreated,
}: {
  jobs: JobWithClient[]
  value: string // selected job id, or '' for none
  onChange: (jobId: string) => void
  placeholder?: string
  // When set, the picker shows this as the empty/no-selection label and offers a
  // row to clear back to it (used by the Logs filter: "All jobs" / Schedule: "no job").
  clearLabel?: string
  excludeJobId?: string | null // hide one job (e.g. the report's current job)
  disabled?: boolean
  allowCreate?: boolean // show "+ New job…" → inline create form
  clients?: Client[] // required when allowCreate
  onJobCreated?: (job: JobWithClient) => void // parent adds it to its own list
  onClientCreated?: (client: Client) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const blurTimer = useRef<number | undefined>(undefined)

  const selected = useMemo(() => jobs.find((j) => j.id === value) ?? null, [jobs, value])

  const q = query.trim().toLowerCase()
  const options = useMemo(() => {
    return jobs
      .filter((j) => j.id !== excludeJobId)
      .filter((j) =>
        !q
          ? true
          : j.name.toLowerCase().includes(q) ||
            (j.client?.name?.toLowerCase().includes(q) ?? false),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 25)
  }, [jobs, q, excludeJobId])

  const exact = jobs.some((j) => j.name.trim().toLowerCase() === q)
  const showCreate = allowCreate && q.length > 0 && !exact
  const showClear = !!clearLabel && value !== ''

  // Flat action list so arrow/Enter nav lines up with what's rendered.
  type Row =
    | { kind: 'clear' }
    | { kind: 'job'; job: JobWithClient }
    | { kind: 'create' }
  const rows: Row[] = [
    ...(showClear ? [{ kind: 'clear' } as Row] : []),
    ...options.map((job) => ({ kind: 'job', job }) as Row),
    ...(showCreate ? [{ kind: 'create' } as Row] : []),
  ]

  function reset() {
    setOpen(false)
    setCreating(false)
    setQuery('')
    setActive(0)
  }

  function run(row: Row) {
    if (row.kind === 'clear') {
      onChange('')
      reset()
    } else if (row.kind === 'job') {
      onChange(row.job.id)
      reset()
    } else {
      setCreating(true) // open the create form; keep the picker open
    }
  }

  const label = selected
    ? selected.name +
      (selected.client?.name ? ` — ${selected.client.name}` : '') +
      (selected.status !== 'active' ? ` (${selected.status})` : '')
    : ''

  return (
    <div
      className="job-picker"
      onBlur={(e) => {
        // Close only when focus leaves the whole picker (menu + create form).
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          blurTimer.current = window.setTimeout(() => {
            setOpen(false)
            setCreating(false)
          }, 120)
        }
      }}
    >
      <input
        type="text"
        className="job-picker-input"
        placeholder={selected ? label : clearLabel ?? placeholder}
        value={open ? query : label}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setCreating(false)
          setActive(0)
        }}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (creating) return
          if (!open || rows.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, rows.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (rows[active]) run(rows[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />

      {open && !creating && rows.length > 0 && (
        <ul className="li-picker-menu">
          {rows.map((row, idx) => {
            const isActive = idx === active
            if (row.kind === 'clear') {
              return (
                <li
                  key="__clear"
                  className={`li-picker-opt${isActive ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(row)}
                >
                  <span className="li-picker-name muted">— {clearLabel} —</span>
                </li>
              )
            }
            if (row.kind === 'create') {
              return (
                <li
                  key="__create"
                  className={`li-picker-opt li-picker-create${isActive ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(row)}
                >
                  + New job “{query.trim()}”…
                </li>
              )
            }
            return (
              <li
                key={row.job.id}
                className={`li-picker-opt${isActive ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(row)}
              >
                <span className="li-picker-name">{row.job.name}</span>
                <span className="li-picker-rate">
                  {row.job.client?.name ?? 'No client'}
                  {row.job.status !== 'active' ? ` · ${row.job.status}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {open && creating && (
        <CreateJobForm
          initialName={query.trim()}
          clients={clients}
          onCancel={() => setCreating(false)}
          onCreated={(job, newClient) => {
            if (newClient) onClientCreated?.(newClient)
            onJobCreated?.(job)
            onChange(job.id)
            reset()
          }}
        />
      )}
    </div>
  )
}

function CreateJobForm({
  initialName,
  clients,
  onCancel,
  onCreated,
}: {
  initialName: string
  clients: Client[]
  onCancel: () => void
  onCreated: (job: JobWithClient, newClient: Client | null) => void
}) {
  const [name, setName] = useState(initialName)
  const [clientId, setClientId] = useState('') // '' = no client, '__new' = add one
  const [newClient, setNewClient] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  )

  async function create() {
    if (!name.trim()) {
      setErr('Give the new job a name.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      let created: Client | null = null
      let cid: string | null = null
      if (clientId === '__new') {
        if (!newClient.trim()) {
          setErr('Enter the new client’s name.')
          setBusy(false)
          return
        }
        created = await createClient(newClient.trim())
        cid = created.id
      } else if (clientId) {
        cid = clientId
      }
      const job = await createJob({ name: name.trim(), client_id: cid })
      onCreated(job, created)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="job-picker-create">
      <label className="filter">
        <span className="label">New job name</span>
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Veridian 6A — Curb Repair"
        />
      </label>
      <label className="filter">
        <span className="label">Client</span>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">— no client —</option>
          {sortedClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new">+ New client…</option>
        </select>
      </label>
      {clientId === '__new' && (
        <label className="filter">
          <span className="label">New client name</span>
          <input
            type="text"
            value={newClient}
            onChange={(e) => setNewClient(e.target.value)}
            placeholder="e.g. JB Parsons"
          />
        </label>
      )}
      {err && <p className="error-text">{err}</p>}
      <div className="edit-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create & select'}
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
