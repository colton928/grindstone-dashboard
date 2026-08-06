import type { PriceListItem } from './types'
import { buildNameToProduct, resolveProductId } from './normalize'

// Structural inputs — both full row types and bulk-query rows satisfy these.
export type LoggedLike = {
  product_id: string | null
  quantity: number
  description?: string | null
  unit?: string | null
}
export type BilledLike = {
  product_id: string | null
  quantity: number
  rate: number
  amount: number | null
  description?: string | null
}
export type EstRateLike = { product_id: string | null; rate: number; description?: string | null }

// Billing math for a single job.
//
// We bill the LOGGED field work (clean, product-keyed), not the estimate. For
// each product: remaining = logged qty − already-billed qty. The per-unit rate
// resolves from the job's estimate (the locked bid rate) when that product was
// bid, otherwise from the price list. This naturally includes off-estimate
// "extras" (logged work with no estimate line) at their price-list rate.

export interface BillingLine {
  productId: string | null
  description: string
  unit: string | null
  loggedQty: number
  billedQty: number
  remainingQty: number
  rate: number
  billedAmount: number
  remainingAmount: number
}

export interface JobBilling {
  lines: BillingLine[]
  loggedValue: number
  billedValue: number
  remainingValue: number
  hasUnbilled: boolean // unbilled work with a known dollar value > 0
  hasUnbilledQty: boolean // any unbilled logged quantity, even if unpriced ($0 rate)
}

const EPS = 0.005

// A logged/billed line's grouping key: its product_id, or — for one-off /
// unmatched free-text lines with no product — a text key from the description,
// so the same one-off logged and billed reconcile against each other.
function keyOf(it: { product_id: string | null; description?: string | null }): string {
  return it.product_id ?? `txt:${(it.description ?? '').toLowerCase().trim()}`
}

interface QtyAgg {
  productId: string | null
  description: string | null
  unit: string | null
  qty: number
}

function aggregate(
  items: { product_id: string | null; quantity: number; description?: string | null; unit?: string | null }[],
): Map<string, QtyAgg> {
  const m = new Map<string, QtyAgg>()
  for (const it of items) {
    const k = keyOf(it)
    const prev = m.get(k)
    if (prev) {
      prev.qty += Number(it.quantity)
    } else {
      m.set(k, {
        productId: it.product_id ?? null,
        description: it.description ?? null,
        unit: it.unit ?? null,
        qty: Number(it.quantity),
      })
    }
  }
  return m
}

// product_id → locked estimate rate (first line wins if a product repeats).
export function buildEstimateRateMap(lines: EstRateLike[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const li of lines) {
    if (li.product_id && !m.has(li.product_id)) m.set(li.product_id, Number(li.rate))
  }
  return m
}

export function computeJobBilling(
  loggedItems: LoggedLike[],
  invoiceLines: BilledLike[],
  estimateLines: EstRateLike[],
  priceList: PriceListItem[],
): JobBilling {
  // Fold unlinked free-text lines onto their product by normalized name, so the
  // estimate's bid rate, the logged work, and any billed lines all reconcile on
  // one product_id (mirrors the job page). No-op for already-linked lines.
  const nameToProduct = buildNameToProduct(priceList)
  const resolve = <T extends { product_id: string | null; description?: string | null }>(
    arr: T[],
  ): T[] => arr.map((x) => ({ ...x, product_id: resolveProductId(x.product_id, x.description, nameToProduct) }))
  const loggedR = resolve(loggedItems)
  const invoiceR = resolve(invoiceLines)
  const estimateR = resolve(estimateLines)

  const logged = aggregate(loggedR)
  const billedAgg = aggregate(invoiceR)
  const estRate = buildEstimateRateMap(estimateR)
  const pName = new Map(priceList.map((p) => [p.id, p.name]))
  const pUnit = new Map(priceList.map((p) => [p.id, p.unit]))
  const pRate = new Map(priceList.map((p) => [p.id, Number(p.default_rate)]))

  // Actual billed dollars per key (historical truth), incl. matched lines.
  const billedAmtByKey = new Map<string, number>()
  let billedValue = 0
  for (const li of invoiceR) {
    const amt = li.amount != null ? Number(li.amount) : Number(li.quantity) * Number(li.rate)
    billedValue += amt
    const k = keyOf(li)
    billedAmtByKey.set(k, (billedAmtByKey.get(k) ?? 0) + amt)
  }

  const keys = new Set<string>([...logged.keys(), ...billedAgg.keys()])
  const lines: BillingLine[] = []
  let loggedValue = 0
  let remainingValue = 0
  let unbilledQty = 0

  for (const key of keys) {
    const la = logged.get(key)
    const ba = billedAgg.get(key)
    const productId = key.startsWith('txt:') ? null : key
    const loggedQty = la?.qty ?? 0
    const billedQty = ba?.qty ?? 0
    const remainingQty = Math.max(0, loggedQty - billedQty)
    unbilledQty += remainingQty
    // One-off / unmatched lines have no product → unpriced ($0) until Colton
    // sets a rate on the draft invoice line.
    const rate = productId ? estRate.get(productId) ?? pRate.get(productId) ?? 0 : 0
    const remainingAmount = remainingQty * rate
    loggedValue += loggedQty * rate
    remainingValue += remainingAmount
    lines.push({
      productId,
      description: productId
        ? pName.get(productId) ?? 'Logged work'
        : (la?.description ?? ba?.description) || 'One-off line',
      unit: productId ? pUnit.get(productId) ?? null : la?.unit ?? ba?.unit ?? null,
      loggedQty,
      billedQty,
      remainingQty,
      rate,
      billedAmount: billedAmtByKey.get(key) ?? 0,
      remainingAmount,
    })
  }

  // Unbilled first, then by remaining value desc, then name.
  lines.sort(
    (a, b) =>
      Number(b.remainingQty > EPS) - Number(a.remainingQty > EPS) ||
      b.remainingAmount - a.remainingAmount ||
      a.description.localeCompare(b.description),
  )

  return {
    lines,
    loggedValue,
    billedValue,
    remainingValue,
    hasUnbilled: remainingValue > EPS,
    hasUnbilledQty: unbilledQty > EPS,
  }
}
