import type { DailyLogItem, EstimateLineItem, PriceListItem } from './types'
import { buildNameToProduct, resolveProductId } from './normalize'

// Computes "built vs. bid" progress for a job.
//
// Estimate line items carry the locked bid (qty + rate). Field work is logged
// in daily_log_items by product_id. We join the two on product_id, which is why
// the import maps every estimate line to a price_list product where possible.
// Estimate lines are aggregated by product so duplicate lines (e.g. a curb line
// in the main scope and another in the "parking lot" section) sum correctly.

export interface LineProgress {
  key: string
  productId: string | null
  description: string
  unit: string | null
  rate: number
  estimatedQty: number
  estimatedAmount: number
  loggedQty: number
  remainingQty: number
  pct: number | null // null when there's no estimated qty to measure against
  overage: boolean
}

export interface ExtraLogged {
  key: string
  productId: string | null // null for one-off / unmatched free-text lines
  description: string
  unit: string | null
  loggedQty: number
}

export interface JobProgress {
  lines: LineProgress[]
  extras: ExtraLogged[] // logged work with no matching estimate line
  bidAmount: number
  builtAmount: number // capped at bid per line (no >100% inflation)
  overallPct: number | null
  hasEstimate: boolean
}

interface LoggedAgg {
  productId: string | null
  description: string | null
  unit: string | null
  qty: number
}

// Aggregate logged items by product_id, OR by their free-text description when
// there's no product (one-off / unmatched lines the sync now stores instead of
// dropping). A null-product line whose description names a known product folds
// onto that product (normalized-name match). Keyed so product lines and text
// lines never collide.
function aggregateLogged(
  items: DailyLogItem[],
  nameToProduct: Map<string, string>,
): Map<string, LoggedAgg> {
  const m = new Map<string, LoggedAgg>()
  for (const it of items) {
    const pid = resolveProductId(it.product_id, it.description, nameToProduct)
    const key = pid ?? `txt:${(it.description ?? '').toLowerCase().trim()}`
    const prev = m.get(key)
    if (prev) {
      prev.qty += Number(it.quantity)
    } else {
      m.set(key, {
        productId: pid,
        description: it.description ?? null,
        unit: it.unit ?? null,
        qty: Number(it.quantity),
      })
    }
  }
  return m
}

export function computeJobProgress(
  lineItems: EstimateLineItem[],
  loggedItems: DailyLogItem[],
  priceList: PriceListItem[] = [],
): JobProgress {
  const nameToProduct = buildNameToProduct(priceList)
  const loggedByKey = aggregateLogged(loggedItems, nameToProduct)
  const productName = new Map(priceList.map((p) => [p.id, p.name]))
  const productUnit = new Map(priceList.map((p) => [p.id, p.unit]))

  // Aggregate estimate lines by product (or by free-text description if no product).
  const groups = new Map<string, LineProgress>()
  let order = 0
  const orderOf = new Map<string, number>()

  for (const li of lineItems) {
    // Fold an unlinked free-text line (e.g. "6' Sidewalk") onto its product so
    // it reconciles with the logged/priced work ("Sidewalk 6\"").
    const pid = resolveProductId(li.product_id, li.description, nameToProduct)
    const key = pid ?? `text:${li.description ?? 'item'}:${order}`
    if (!orderOf.has(key)) orderOf.set(key, order++)
    const existing = groups.get(key)
    const desc = li.description ?? (pid ? productName.get(pid) : null) ?? 'Item'
    const qty = Number(li.quantity)
    const amount = Number(li.amount)
    if (existing) {
      existing.estimatedQty += qty
      existing.estimatedAmount += amount
    } else {
      groups.set(key, {
        key,
        productId: pid,
        description: desc,
        unit: li.unit ?? (pid ? productUnit.get(pid) ?? null : null),
        rate: Number(li.rate),
        estimatedQty: qty,
        estimatedAmount: amount,
        loggedQty: 0,
        remainingQty: 0,
        pct: null,
        overage: false,
      })
    }
  }

  const matchedProducts = new Set<string>()
  let bidAmount = 0
  let builtAmount = 0

  const lines = [...groups.values()]
  for (const line of lines) {
    if (line.productId) {
      matchedProducts.add(line.productId)
      line.loggedQty = loggedByKey.get(line.productId)?.qty ?? 0
    }
    line.remainingQty = line.estimatedQty - line.loggedQty
    line.pct = line.estimatedQty > 0 ? (line.loggedQty / line.estimatedQty) * 100 : null
    line.overage = line.pct != null && line.pct > 100.5
    bidAmount += line.estimatedAmount
    const cappedQty = Math.min(line.loggedQty, line.estimatedQty)
    builtAmount += cappedQty * line.rate
  }
  lines.sort((a, b) => (orderOf.get(a.key) ?? 0) - (orderOf.get(b.key) ?? 0))

  // Logged work that isn't on the estimate at all → "extras" to surface.
  // Includes one-off / unmatched free-text lines (no product_id).
  const extras: ExtraLogged[] = []
  for (const [key, agg] of loggedByKey) {
    if (agg.productId && matchedProducts.has(agg.productId)) continue
    extras.push({
      key,
      productId: agg.productId,
      description: agg.productId
        ? productName.get(agg.productId) ?? 'Logged work'
        : agg.description || 'One-off line',
      unit: agg.productId ? productUnit.get(agg.productId) ?? null : agg.unit,
      loggedQty: agg.qty,
    })
  }

  return {
    lines,
    extras,
    bidAmount,
    builtAmount,
    overallPct: bidAmount > 0 ? (builtAmount / bidAmount) * 100 : null,
    hasEstimate: lineItems.length > 0,
  }
}

export function formatQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function formatMoney(n: number): string {
  // Show exact cents when the amount has them (a $6.50 rate reads as $6.50, not
  // a rounded $7), but keep whole-dollar amounts clean (no trailing .00 on big
  // totals like $258,086).
  const hasCents = Math.round(n * 100) % 100 !== 0
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

export function formatPct(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(n)}%`
}

// Display a stored ISO date (YYYY-MM-DD, or a full timestamp) as MM-DD-YYYY —
// the one date format used everywhere in the app (logs, bills, estimates, PDFs).
// Storage stays ISO; this only changes what's shown.
export function formatDate(s: string | null | undefined): string {
  if (!s) return ''
  const iso = s.slice(0, 10)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[2]}-${m[3]}-${m[1]}` : iso
}
