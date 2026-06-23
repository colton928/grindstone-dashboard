import type { ClientPriceRule, PriceListItem } from './types'

// The price list is a STARTING POINT, not the price (context.md). When seeding an
// estimate line from a price-list product, we add any active client price rules
// whose category matches the product's category (e.g. Noland: +$0.30/unit on
// Flatwork / Sidewalk / Drive Approach because they require grading first).
// The result is editable per line — once saved, the estimate locks its own rates.

export interface SeededRate {
  rate: number
  adjustment: number // total adjustment applied (0 if none)
  note: string | null // why it differs from the price list, for adjustment_note
}

export function seedRate(
  product: Pick<PriceListItem, 'category' | 'default_rate'>,
  clientRules: ClientPriceRule[],
): SeededRate {
  const base = Number(product.default_rate)
  if (!product.category) return { rate: base, adjustment: 0, note: null }

  const matched = clientRules.filter(
    (r) => r.active && r.category === product.category,
  )
  if (matched.length === 0) return { rate: base, adjustment: 0, note: null }

  const adjustment = matched.reduce((s, r) => s + Number(r.adjust_amount), 0)
  const noteText = matched
    .map((r) => r.note ?? `${r.adjust_amount >= 0 ? '+' : ''}${r.adjust_amount}/unit`)
    .join('; ')
  return { rate: base + adjustment, adjustment, note: noteText }
}

// Next estimate number = max numeric existing + 1 (mirrors the bill-number logic).
export function nextEstimateNumber(existing: (string | null)[]): string {
  const nums = existing
    .map((n) => parseInt(n ?? '', 10))
    .filter((n) => !Number.isNaN(n))
  return String((nums.length ? Math.max(...nums) : 0) + 1)
}
