import { useRef, useState } from 'react'
import { formatMoney } from '../lib/progress'
import type { PriceListItem } from '../lib/types'

// A combobox for a line item's product/description. Type to search the price
// sheet, pick a match, add a new item to the price sheet, or just free-type a
// one-off. Shared by the Estimating and Billing editors — each supplies the
// three callbacks so its own line rules (client rates, defaults) still apply.
export function LineItemPicker({
  value,
  linked,
  priceList,
  onSelectProduct,
  onFreeText,
  onCreateNew,
}: {
  value: string
  linked: boolean // a price-sheet item is currently attached to this line
  priceList: PriceListItem[]
  onSelectProduct: (p: PriceListItem) => void
  onFreeText: (text: string) => void
  onCreateNew: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const blurTimer = useRef<number | undefined>(undefined)

  const q = value.trim().toLowerCase()
  const matches = (q
    ? priceList.filter((p) => p.name.toLowerCase().includes(q))
    : priceList
  ).slice(0, 8)
  const exact = priceList.some((p) => p.name.trim().toLowerCase() === q)
  const showCreate = q.length > 0 && !exact
  const rows = matches.length + (showCreate ? 1 : 0)

  const choose = (idx: number) => {
    if (showCreate && idx === matches.length) onCreateNew(value.trim())
    else if (matches[idx]) onSelectProduct(matches[idx])
    setOpen(false)
  }

  return (
    <div className="li-picker">
      <input
        type="text"
        className="li-picker-input"
        placeholder="Type to search price list, or enter a one-off…"
        value={value}
        onChange={(e) => {
          onFreeText(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => {
          setOpen(true)
          setActive(0)
        }}
        onBlur={() => {
          // Delay so a click on a suggestion registers before the menu closes.
          blurTimer.current = window.setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={(e) => {
          if (!open || rows === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, rows - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(active)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {linked && <span className="li-picker-badge">from price list</span>}
      {open && rows > 0 && (
        <ul className="li-picker-menu">
          {matches.map((p, idx) => (
            <li
              key={p.id}
              className={`li-picker-opt${idx === active ? ' is-active' : ''}`}
              // preventDefault keeps the input focused so onClick fires before blur
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(idx)}
            >
              <span className="li-picker-name">{p.name}</span>
              <span className="li-picker-rate num">
                {formatMoney(p.default_rate)}/{p.unit}
              </span>
            </li>
          ))}
          {showCreate && (
            <li
              className={`li-picker-opt li-picker-create${active === matches.length ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(matches.length)}
            >
              + Add “{value.trim()}” to price list
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
