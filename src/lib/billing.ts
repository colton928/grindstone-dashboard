import type { PriceListItem } from './types'

// Structural inputs — both full row types and bulk-query rows satisfy these.
export type LoggedLike = { product_id: string | null; quantity: number }
export type BilledLike = {
  product_id: string | null
  quantity: number
  rate: number
  amount: number | null
}
export type EstRateLike = { product_id: string | null; rate: number }

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
  hasUnbilled: boolean
}

const EPS = 0.005

function sumByProduct<T extends { product_id: string | null; quantity: number }>(
  items: T[],
): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    if (!it.product_id) continue
    m.set(it.product_id, (m.get(it.product_id) ?? 0) + Number(it.quantity))
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
  const logged = sumByProduct(loggedItems)
  const billedQtyByProduct = sumByProduct(invoiceLines)
  const estRate = buildEstimateRateMap(estimateLines)
  const pName = new Map(priceList.map((p) => [p.id, p.name]))
  const pUnit = new Map(priceList.map((p) => [p.id, p.unit]))
  const pRate = new Map(priceList.map((p) => [p.id, Number(p.default_rate)]))

  // Actual billed dollars per product (historical truth), incl. matched lines.
  const billedAmtByProduct = new Map<string, number>()
  let billedValue = 0
  for (const li of invoiceLines) {
    const amt = li.amount != null ? Number(li.amount) : Number(li.quantity) * Number(li.rate)
    billedValue += amt
    if (li.product_id) {
      billedAmtByProduct.set(li.product_id, (billedAmtByProduct.get(li.product_id) ?? 0) + amt)
    }
  }

  const productIds = new Set<string>([...logged.keys(), ...billedQtyByProduct.keys()])
  const lines: BillingLine[] = []
  let loggedValue = 0
  let remainingValue = 0

  for (const pid of productIds) {
    const loggedQty = logged.get(pid) ?? 0
    const billedQty = billedQtyByProduct.get(pid) ?? 0
    const remainingQty = Math.max(0, loggedQty - billedQty)
    const rate = estRate.get(pid) ?? pRate.get(pid) ?? 0
    const remainingAmount = remainingQty * rate
    loggedValue += loggedQty * rate
    remainingValue += remainingAmount
    lines.push({
      productId: pid,
      description: pName.get(pid) ?? 'Logged work',
      unit: pUnit.get(pid) ?? null,
      loggedQty,
      billedQty,
      remainingQty,
      rate,
      billedAmount: billedAmtByProduct.get(pid) ?? 0,
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
  }
}
