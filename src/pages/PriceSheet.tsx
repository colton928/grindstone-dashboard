import { useEffect, useMemo, useState } from 'react'
import {
  addPriceItem,
  fetchPriceList,
  updatePriceItem,
  type PriceItemPatch,
} from '../lib/queries'
import { formatMoney } from '../lib/progress'
import type { PriceListItem } from '../lib/types'

const UNITS = ['LF', 'SF', 'EA', 'CY', 'HR']

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export function PriceSheet() {
  const [items, setItems] = useState<PriceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)

  async function load() {
    try {
      setLoading(true)
      setItems(await fetchPriceList())
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const visible = showInactive ? items : items.filter((i) => i.active)

  // Group by category, preserving the price-list sort order within each group.
  const groups = useMemo(() => {
    const m = new Map<string, PriceListItem[]>()
    for (const it of visible) {
      const cat = it.category ?? 'Other'
      const a = m.get(cat) ?? []
      a.push(it)
      m.set(cat, a)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible])

  if (loading) return <div className="page"><p className="muted">Loading price sheet…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>

  return (
    <div className="page">
      <div className="job-detail-head">
        <h1>Price Sheet</h1>
        <p className="label">The starting-point rates that seed new estimates. Editing a rate here only affects future line items — saved estimates keep their locked rates.</p>
      </div>

      <div className="bill-action-row">
        <button type="button" className="btn-primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : '+ Add product'}
        </button>
        <label className="filter price-toggle">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <span className="label">Show inactive</span>
        </label>
      </div>

      {adding && <AddProduct onAdded={async () => { setAdding(false); await load() }} onCancel={() => setAdding(false)} />}

      {groups.map(([cat, rows]) => (
        <div key={cat}>
          <h2>{cat}</h2>
          <div className="lines">
            {rows.map((it) => (
              <PriceRow key={it.id} item={it} onChanged={load} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PriceRow({ item, onChanged }: { item: PriceListItem; onChanged: () => void | Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [unit, setUnit] = useState(item.unit)
  const [rate, setRate] = useState(String(item.default_rate))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    const patch: PriceItemPatch = {
      name: name.trim() || item.name,
      unit,
      default_rate: Number(rate) || 0,
    }
    try {
      await updatePriceItem(item.id, patch)
      setEditing(false)
      await onChanged()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive() {
    try {
      await updatePriceItem(item.id, { active: !item.active })
      await onChanged()
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  if (!editing) {
    return (
      <div className={`line ${item.active ? '' : 'line-inactive'}`}>
        <div className="line-top">
          <span className="line-desc">{item.name}{item.active ? '' : ' (inactive)'}</span>
          <span className="num">{formatMoney(item.default_rate)}<span className="label"> /{item.unit}</span></span>
        </div>
        <div className="logcard-foot label">
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="btn-ghost" onClick={() => void toggleActive()}>
            {item.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="logcard logcard-editing">
      <label className="filter">
        <span className="label">Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="edit-grid">
        <label className="filter">
          <span className="label">Rate</span>
          <input type="number" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="filter">
          <span className="label">Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            {!UNITS.includes(unit) && <option value={unit}>{unit}</option>}
          </select>
        </label>
      </div>
      {err && <p className="error-text">{err}</p>}
      <div className="edit-actions">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  )
}

function AddProduct({ onAdded, onCancel }: { onAdded: () => void | Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [unit, setUnit] = useState('LF')
  const [rate, setRate] = useState('0')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) {
      setErr('Give the product a name.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await addPriceItem({
        name: name.trim(),
        category: category.trim() || null,
        unit,
        default_rate: Number(rate) || 0,
      })
      await onAdded()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="logcard logcard-editing">
      <div className="logcard-head"><strong>New product</strong></div>
      <label className="filter">
        <span className="label">Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Curb Slip 24&quot; High Back" />
      </label>
      <label className="filter">
        <span className="label">Category</span>
        <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Curb, Flatwork, Sidewalk" />
      </label>
      <div className="edit-grid">
        <label className="filter">
          <span className="label">Rate</span>
          <input type="number" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="filter">
          <span className="label">Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>
      {err && <p className="error-text">{err}</p>}
      <div className="edit-actions">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Adding…' : 'Add product'}
        </button>
        <button type="button" className="btn-ghost" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
