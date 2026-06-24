import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createScheduleEvent,
  deleteScheduleEvent,
  fetchAllJobs,
  fetchScheduleEvents,
  setScheduleEventStatus,
  updateScheduleEvent,
  type NewScheduleEvent,
} from '../lib/queries'
import { formatDate } from '../lib/progress'
import type { JobWithClient, ScheduleEventFull, ScheduleKind } from '../lib/types'

const KIND_LABEL: Record<ScheduleKind, string> = {
  job: 'Job',
  concrete: 'Concrete',
  billing: 'Billing',
  bid: 'Bid',
  other: 'Other',
}
const KINDS = Object.keys(KIND_LABEL) as ScheduleKind[]

const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : '')
const todayISO = () => new Date().toISOString().slice(0, 10)

// Friendly header for a day group: Today / Tomorrow / Weekday MM-DD-YYYY.
function dayHeading(iso: string): string {
  const today = todayISO()
  if (iso === today) return 'Today'
  const t = new Date(today + 'T00:00:00')
  t.setDate(t.getDate() + 1)
  if (iso === t.toISOString().slice(0, 10)) return 'Tomorrow'
  const dow = new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })
  return `${dow} · ${formatDate(iso)}`
}

// 'HH:MM' (24h) → 'h:mm AM/PM'.
function fmtTime(t: string | null): string {
  if (!t) return ''
  const [hStr, m] = t.split(':')
  const h = Number(hStr)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

export function Schedule() {
  const [events, setEvents] = useState<ScheduleEventFull[]>([])
  const [jobs, setJobs] = useState<JobWithClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fKind, setFKind] = useState<ScheduleKind | ''>('')
  const [showPast, setShowPast] = useState(false)

  async function load() {
    try {
      setLoading(true)
      const [evData, jobData] = await Promise.all([fetchScheduleEvents(), fetchAllJobs()])
      setEvents(evData)
      setJobs(jobData)
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

  const today = todayISO()

  // An event is "past" once its last day is before today.
  const isPast = (e: ScheduleEventFull) => (e.end_date ?? e.event_date) < today

  const visible = useMemo(() => {
    return events.filter((e) => {
      if (fKind && e.kind !== fKind) return false
      if (!showPast && isPast(e)) return false
      return true
    })
  }, [events, fKind, showPast, today])

  // Group by event_date for date headers.
  const groups = useMemo(() => {
    const m = new Map<string, ScheduleEventFull[]>()
    for (const e of visible) {
      const key = d10(e.event_date)
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(e)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible])

  const upcomingConcrete = useMemo(
    () =>
      events.filter(
        (e) =>
          e.kind === 'concrete' &&
          e.status === 'scheduled' &&
          (e.end_date ?? e.event_date) >= today,
      ),
    [events, today],
  )

  const pastCount = useMemo(() => events.filter(isPast).length, [events, today])

  if (loading) return <div className="page"><p className="muted">Loading schedule…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>

  return (
    <div className="page">
      <div className="job-detail-head-row">
        <h1>Schedule</h1>
        {!adding && (
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            + Add
          </button>
        )}
      </div>

      {adding && (
        <EventForm
          jobs={jobs}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await load()
          }}
        />
      )}

      {upcomingConcrete.length > 0 && (
        <div className="sched-concrete-banner">
          <span className="sched-concrete-icon">🚚</span>
          <span>
            <strong>{upcomingConcrete.length}</strong> concrete order
            {upcomingConcrete.length === 1 ? '' : 's'} scheduled
            <span className="label"> — cancel or move them if plans change</span>
          </span>
        </div>
      )}

      <div className="filters">
        <label className="filter">
          <span className="label">Type</span>
          <select value={fKind} onChange={(e) => setFKind(e.target.value as ScheduleKind | '')}>
            <option value="">All types</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="filter filter-check">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
          />
          <span className="label">Show past ({pastCount})</span>
        </label>
      </div>

      {groups.length === 0 ? (
        <div className="empty-card">
          <p className="label">
            {fKind ? 'No matching events.' : 'Nothing scheduled. Tap “+ Add” to start.'}
          </p>
        </div>
      ) : (
        groups.map(([date, dayEvents]) => (
          <section key={date} className="sched-day">
            <h2 className="sched-day-label">{dayHeading(date)}</h2>
            <div className="lines">
              {dayEvents.map((ev) =>
                editingId === ev.id ? (
                  <EventForm
                    key={ev.id}
                    jobs={jobs}
                    existing={ev}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null)
                      await load()
                    }}
                  />
                ) : (
                  <EventCard
                    key={ev.id}
                    ev={ev}
                    onEdit={() => setEditingId(ev.id)}
                    onChanged={load}
                  />
                ),
              )}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function EventCard({
  ev,
  onEdit,
  onChanged,
}: {
  ev: ScheduleEventFull
  onEdit: () => void
  onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  async function act(fn: () => Promise<void>) {
    try {
      setBusy(true)
      await fn()
      await onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const range =
    ev.end_date && ev.end_date !== ev.event_date
      ? `${formatDate(ev.event_date)} → ${formatDate(ev.end_date)}`
      : null

  return (
    <article
      className={`event-card${ev.status === 'canceled' ? ' event-card-canceled' : ''}${
        ev.status === 'done' ? ' event-card-done' : ''
      }`}
    >
      <div className="event-top">
        <span className={`event-kind event-kind-${ev.kind}`}>{KIND_LABEL[ev.kind]}</span>
        {ev.start_time && <span className="event-time num">{fmtTime(ev.start_time)}</span>}
        {ev.status === 'canceled' && <span className="pill pill-archived">Canceled</span>}
        {ev.status === 'done' && <span className="pill pill-sent">Done</span>}
      </div>

      <div className="event-title">{ev.title}</div>

      <div className="label event-meta">
        {ev.job && <Link to={`/jobs/${ev.job.id}`}>{ev.job.name}</Link>}
        {ev.job?.client?.name && <span> · {ev.job.client.name}</span>}
        {ev.location && <span> · {ev.location}</span>}
        {range && <span> · {range}</span>}
      </div>

      {ev.notes && <p className="event-notes label">{ev.notes}</p>}

      <div className="event-actions">
        <button type="button" className="btn-ghost" onClick={onEdit} disabled={busy}>
          Edit
        </button>
        {ev.status !== 'done' && (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => act(() => setScheduleEventStatus(ev.id, 'done'))}
          >
            ✓ Done
          </button>
        )}
        {ev.status === 'scheduled' ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => act(() => setScheduleEventStatus(ev.id, 'canceled'))}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => act(() => setScheduleEventStatus(ev.id, 'scheduled'))}
          >
            Restore
          </button>
        )}
        <button
          type="button"
          className="btn-ghost edit-delete"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Delete this event? This cannot be undone.'))
              void act(() => deleteScheduleEvent(ev.id))
          }}
        >
          Delete
        </button>
      </div>
    </article>
  )
}

function EventForm({
  jobs,
  existing,
  onCancel,
  onSaved,
}: {
  jobs: JobWithClient[]
  existing?: ScheduleEventFull
  onCancel: () => void
  onSaved: () => void | Promise<void>
}) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [kind, setKind] = useState<ScheduleKind>(existing?.kind ?? 'job')
  const [date, setDate] = useState(d10(existing?.event_date) || todayISO())
  const [endDate, setEndDate] = useState(d10(existing?.end_date))
  const [time, setTime] = useState(existing?.start_time ?? '')
  const [jobId, setJobId] = useState(existing?.job_id ?? '')
  const [location, setLocation] = useState(existing?.location ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!title.trim()) {
      setErr('Give the event a title.')
      return
    }
    const payload: NewScheduleEvent = {
      title: title.trim(),
      kind,
      event_date: date,
      end_date: endDate && endDate !== date ? endDate : null,
      start_time: time || null,
      job_id: jobId || null,
      location: location.trim() || null,
      notes: notes.trim() || null,
    }
    try {
      setSaving(true)
      setErr(null)
      if (existing) await updateScheduleEvent(existing.id, payload)
      else await createScheduleEvent(payload)
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <article className="event-card sched-form">
      <label className="filter">
        <span className="label">What</span>
        <input
          type="text"
          value={title}
          placeholder="e.g. Pour Veridian 6A driveways"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <div className="edit-grid">
        <label className="filter">
          <span className="label">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="filter">
          <span className="label">Time (optional)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="filter">
          <span className="label">End date (optional)</span>
          <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>

      <label className="filter">
        <span className="label">Job (optional)</span>
        <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">— no job —</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}{j.client?.name ? ` · ${j.client.name}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="filter">
        <span className="label">Location (optional)</span>
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>

      <label className="filter">
        <span className="label">Notes (optional)</span>
        <textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {err && <p className="error-text">{err}</p>}

      <div className="edit-actions">
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Save' : 'Add to schedule'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </article>
  )
}
