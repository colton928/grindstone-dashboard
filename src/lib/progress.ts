import type { DailyLogItem, EstimateLineItem, PriceListItem } from './types'

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
  productId: string
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

function sumLoggedByProduct(items: DailyLogItem[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    if (!it.product_id) continue
    m.set(it.product_id, (m.get(it.product_id) ?? 0) + Number(it.quantity))
  }
  return m
}

export function computeJobProgress(
  lineItems: EstimateLineItem[],
  loggedItems: DailyLogItem[],
  priceList: PriceListItem[] = [],
): JobProgress {
  const loggedByProduct = sumLoggedByProduct(loggedItems)
  const productName = new Map(priceList.map((p) => [p.id, p.name]))
  const productUnit = new Map(priceList.map((p) => [p.id, p.unit]))

  // Aggregate estimate lines by product (or by free-text description if no product).
  const groups = new Map<string, LineProgress>()
  let order = 0
  const orderOf = new Map<string, number>()

  for (const li of lineItems) {
    const key = li.product_id ?? `text:${li.description ?? 'item'}:${order}`
    if (!orderOf.has(key)) orderOf.set(key, order++)
    const existing = groups.get(key)
    const desc = li.description ?? (li.product_id ? productName.get(li.product_id) : null) ?? 'Item'
    const qty = Number(li.quantity)
    const amount = Number(li.amount)
    if (existing) {
      existing.estimatedQty += qty
      existing.estimatedAmount += amount
    } else {
      groups.set(key, {
        key,
        productId: li.product_id,
        description: desc,
        unit: li.unit ?? (li.product_id ? productUnit.get(li.product_id) ?? null : null),
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
      line.loggedQty = loggedByProduct.get(line.productId) ?? 0
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
  const extras: ExtraLogged[] = []
  for (const [pid, qty] of loggedByProduct) {
    if (matchedProducts.has(pid)) continue
    extras.push({
      productId: pid,
      description: productName.get(pid) ?? 'Logged work',
      unit: productUnit.get(pid) ?? null,
      loggedQty: qty,
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
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

export function formatPct(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(n)}%`
}
