import { useEffect, useMemo, useState } from 'react'
import {
  addPriceItem,
  fetchClientPriceRules,
  fetchClients,
  fetchPriceBaseYear,
  fetchPriceList,
  promotePricingYear,
  renameCategory,
  updatePriceItem,
  type PriceItemPatch,
} from '../lib/queries'
import { rateForYear } from '../lib/estimate'
import { formatMoney } from '../lib/progress'
import type { Client, ClientPriceRule, PriceListItem } from '../lib/types'

const UNITS = ['LF', 'SF', 'EA', 'CY', 'HR']
const OTHER = 'Other' // synthetic group label for items with no category
const NEW_CAT = '__new__' // sentinel select value = "type a new category"

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export function PriceSheet() {
  const [items, setItems] = useState<PriceListItem[]>([])
  const [rules, setRules] = useState<ClientPriceRule[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [baseYear, setBaseYear] = useState<number>(new Date().getFullYear())
  const [year, setYear] = useState<number>(new Date().getFullYear()) // which column we're viewing/editing
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)
  const [promoting, setPromoting] = useState(false)

  async function load() {
    try {
      setLoading(true)
      const [priceData, ruleData, clientData, by] = await Promise.all([
        fetchPriceList(),
        fetchClientPriceRules(),
        fetchClients(),
        fetchPriceBaseYear(),
      ])
      setItems(priceData)
      setRules(ruleData)
      setClients(clientData)
      setBaseYear(by)
      // Keep the viewed year valid (base or next) across reloads.
      setYear((y) => (y === by || y === by + 1 ? y : by))
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

  const nextYear = baseYear + 1
  const viewingNext = year > baseYear

  const visible = showInactive ? items : items.filter((i) => i.active)

  // Every real (non-null) category currently in use — offered when moving items.
  const categories = useMemo(
    () =>
      [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [items],
  )

  // category -> names of clients whose pricing rule keys off that category string.
  // Used to warn before a rename that would move a rule out from under its rows.
  const rulesByCategory = useMemo(() => {
    const nameById = new Map(clients.map((c) => [c.id, c.name]))
    const m = new Map<string, string[]>()
    for (const r of rules) {
      if (!r.active) continue
      const arr = m.get(r.category) ?? []
      arr.push(nameById.get(r.client_id) ?? 'a client')
      m.set(r.category, arr)
    }
    return m
  }, [rules, clients])

  // Group by category, preserving the price-list sort order within each group.
  const groups = useMemo(() => {
    const m = new Map<string, PriceListItem[]>()
    for (const it of visible) {
      const cat = it.category ?? OTHER
      const a = m.get(cat) ?? []
      a.push(it)
      m.set(cat, a)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible])

  async function promote() {
    const ok = window.confirm(
      `Roll ${nextYear} pricing into current?\n\n` +
        `Every ${nextYear} rate becomes the new current price, ${nextYear + 1} starts blank, ` +
        `and the current year becomes ${nextYear}. This does NOT touch any saved estimate. Continue?`,
    )
    if (!ok) return
    setPromoting(true)
    setError(null)
    try {
      await promotePricingYear()
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setPromoting(false)
    }
  }

  if (loading) return <div className="page"><p className="muted">Loading price sheet…</p></div>
  if (error) return <div className="page"><p className="error-text">{error}</p></div>

  return (
    <div className="page">
      <div className="job-detail-head">
        <h1>Price Sheet</h1>
        <p className="label">The starting-point rates that seed new estimates. Editing a rate here only affects future line items — saved estimates keep their locked rates. Work types, rates, and categories here are shared with the Daily Log and the field Daily Report app.</p>
        <p className="label">
          <strong>{baseYear}</strong> is the current price (what un-estimated jobs bill at). <strong>{nextYear}</strong> is next year's price — pick it in the estimate editor to bid at the new rates. Switch the year below to view or edit each.
        </p>
      </div>

      <div className="bill-action-row">
        <div className="seg">
          <button
            type="button"
            className={year === baseYear ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setYear(baseYear)}
          >
            {baseYear}
          </button>
          <button
            type="button"
            className={viewingNext ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setYear(nextYear)}
          >
            {nextYear}
          </button>
        </div>
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

      {adding && <AddProduct categories={categories} onAdded={async () => { setAdding(false); await load() }} onCancel={() => setAdding(false)} />}

      {groups.map(([cat, rows]) => (
        <CategoryGroup
          key={cat}
          cat={cat}
          rows={rows}
          categories={categories}
          ruleClients={rulesByCategory.get(cat) ?? []}
          year={year}
          baseYear={baseYear}
          onChanged={load}
        />
      ))}

      <div className="price-promote">
        <p className="label">
          When {nextYear} arrives, roll its prices into current so new work bills at the new rates.
        </p>
        <button type="button" className="btn-ghost" disabled={promoting} onClick={() => void promote()}>
          {promoting ? 'Rolling…' : `Roll ${nextYear} pricing → current`}
        </button>
      </div>
    </div>
  )
}

function CategoryGroup({
  cat,
  rows,
  categories,
  ruleClients,
  year,
  baseYear,
  onChanged,
}: {
  cat: string
  rows: PriceListItem[]
  categories: string[]
  ruleClients: string[]
  year: number
  baseYear: number
  onChanged: () => void | Promise<void>
}) {
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(cat)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // The synthetic "Other" bucket holds items with NO stored category (null), so
  // there's no single string to rename — move those out per-item instead.
  const canRename = cat !== OTHER

  async function saveRename() {
    const clean = newName.trim()
    if (!clean || clean === cat) {
      setRenaming(false)
      return
    }
    if (ruleClients.length) {
      const ok = window.confirm(
        `"${cat}" has a client pricing rule (${ruleClients.join(', ')}). ` +
          `Renaming it to "${clean}" will move that rule too so it keeps applying. Continue?`,
      )
      if (!ok) return
    }
    setSaving(true)
    setErr(null)
    try {
      await renameCategory(cat, clean)
      setRenaming(false)
      await onChanged()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="pricecat-head">
        <h2>{cat}</h2>
        {canRename && !renaming && (
          <button type="button" className="btn-ghost" onClick={() => { setNewName(cat); setRenaming(true) }}>
            Rename
          </button>
        )}
      </div>
      {ruleClients.length > 0 && (
        <p className="label">Client pricing rule keys off this category ({ruleClients.join(', ')}).</p>
      )}
      {renaming && (
        <div className="logcard logcard-editing">
          <label className="filter">
            <span className="label">Rename category</span>
            <input type="text" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} />
          </label>
          {err && <p className="error-text">{err}</p>}
          <div className="edit-actions">
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveRename()}>
              {saving ? 'Renaming…' : 'Save name'}
            </button>
            <button type="button" className="btn-ghost" disabled={saving} onClick={() => setRenaming(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="lines">
        {rows.map((it) => (
          // Key by year so switching the year toggle resets any open edit row.
          <PriceRow key={`${it.id}-${year}`} item={it} categories={categories} year={year} baseYear={baseYear} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function PriceRow({
  item,
  categories,
  year,
  baseYear,
  onChanged,
}: {
  item: PriceListItem
  categories: string[]
  year: number
  baseYear: number
  onChanged: () => void | Promise<void>
}) {
  const viewingNext = year > baseYear
  const shownRate = rateForYear(item, year, baseYear)
  // The other year's rate + whether it actually differs (for the muted hint).
  const otherYear = viewingNext ? baseYear : baseYear + 1
  const otherRate = rateForYear(item, otherYear, baseYear)
  const differs = otherRate !== shownRate
  const nextInherits = item.rate_next_year == null // next year currently = current

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [unit, setUnit] = useState(item.unit)
  const [rate, setRate] = useState(String(shownRate))
  // Category picker: '' = none, an existing category, or NEW_CAT (+ type one).
  const [catSel, setCatSel] = useState(item.category ?? '')
  const [newCat, setNewCat] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function resolveCategory(): string | null {
    if (catSel === NEW_CAT) return newCat.trim() || null
    return catSel || null
  }

  async function save() {
    setSaving(true)
    setErr(null)
    // Name / unit / category are shared across years; the rate maps to the year
    // being edited — default_rate for the base year, rate_next_year for next.
    const patch: PriceItemPatch = {
      name: name.trim() || item.name,
      unit,
      category: resolveCategory(),
    }
    if (viewingNext) patch.rate_next_year = Number(rate) || 0
    else patch.default_rate = Number(rate) || 0
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

  // Reset next year's rate to "same as current" (clears the override).
  async function clearNextYear() {
    setSaving(true)
    setErr(null)
    try {
      await updatePriceItem(item.id, { rate_next_year: null })
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

  function startEditing() {
    setName(item.name)
    setUnit(item.unit)
    setRate(String(shownRate))
    setCatSel(item.category ?? '')
    setNewCat('')
    setEditing(true)
  }

  if (!editing) {
    return (
      <div className={`line ${item.active ? '' : 'line-inactive'}`}>
        <div className="line-top">
          <span className="line-desc">
            {item.name}{item.active ? '' : ' (inactive)'}
            {viewingNext && nextInherits && <span className="label"> · same as {baseYear}</span>}
          </span>
          <span className="num">{formatMoney(shownRate)}<span className="label"> /{item.unit}</span></span>
        </div>
        {differs && (
          <div className="line-top">
            <span className="label est-adj">↳ {otherYear}: {formatMoney(otherRate)}</span>
          </div>
        )}
        <div className="logcard-foot label">
          <button type="button" className="btn-ghost" onClick={startEditing}>Edit {year}</button>
          <button type="button" className="btn-ghost" onClick={() => void toggleActive()}>
            {item.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
    )
  }

  // Existing categories plus the item's own (in case it's inactive/unlisted).
  const catOptions = [...new Set([...categories, ...(item.category ? [item.category] : [])])].sort(
    (a, b) => a.localeCompare(b),
  )

  return (
    <div className="logcard logcard-editing">
      <label className="filter">
        <span className="label">Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="filter">
        <span className="label">Category</span>
        <select value={catSel} onChange={(e) => setCatSel(e.target.value)}>
          <option value="">— none (Other) —</option>
          {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value={NEW_CAT}>+ New category…</option>
        </select>
      </label>
      {catSel === NEW_CAT && (
        <label className="filter">
          <span className="label">New category name</span>
          <input type="text" value={newCat} autoFocus placeholder="e.g. Sawcutting" onChange={(e) => setNewCat(e.target.value)} />
        </label>
      )}
      <div className="edit-grid">
        <label className="filter">
          <span className="label">{year} rate</span>
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
      {viewingNext && (
        <p className="label">Editing {year} only — the {baseYear} rate ({formatMoney(rateForYear(item, baseYear, baseYear))}/{item.unit}) is unchanged.</p>
      )}
      {err && <p className="error-text">{err}</p>}
      <div className="edit-actions">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : `Save ${year}`}
        </button>
        {viewingNext && !nextInherits && (
          <button type="button" className="btn-ghost" disabled={saving} onClick={() => void clearNextYear()}>
            Reset to {baseYear}
          </button>
        )}
        <button type="button" className="btn-ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  )
}

function AddProduct({ categories, onAdded, onCancel }: { categories: string[]; onAdded: () => void | Promise<void>; onCancel: () => void }) {
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
        <input type="text" list="pricesheet-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Curb, Flatwork, Sidewalk" />
        <datalist id="pricesheet-categories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
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
