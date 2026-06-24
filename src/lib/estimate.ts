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
  lineLabel: string | null // customer-facing tag for the line desc, e.g. "includes shading"
}

// Customer-facing label for a matched client rule. The rule's `note` is INTERNAL
// ("Noland requires grading beforehand"); on the estimate line + PDF Colton wants
// the baked-in add-on sold to the GC as "includes shading" (Noland's +$0.30 grading
// add-on). Derived from the rule so a future rule with no known label simply adds
// none rather than leaking the internal note onto the customer's line.
function ruleLineLabel(rule: ClientPriceRule): string | null {
  const n = (rule.note ?? '').toLowerCase()
  if (n.includes('grad') || n.includes('shad')) return 'includes shading'
  return null
}

export function seedRate(
  product: Pick<PriceListItem, 'category' | 'default_rate'>,
  clientRules: ClientPriceRule[],
): SeededRate {
  const base = Number(product.default_rate)
  if (!product.category) return { rate: base, adjustment: 0, note: null, lineLabel: null }

  const matched = clientRules.filter(
    (r) => r.active && r.category === product.category,
  )
  if (matched.length === 0) return { rate: base, adjustment: 0, note: null, lineLabel: null }

  const adjustment = matched.reduce((s, r) => s + Number(r.adjust_amount), 0)
  const noteText = matched
    .map((r) => r.note ?? `${r.adjust_amount >= 0 ? '+' : ''}${r.adjust_amount}/unit`)
    .join('; ')
  const labels = [...new Set(matched.map(ruleLineLabel).filter(Boolean) as string[])]
  return {
    rate: base + adjustment,
    adjustment,
    note: noteText,
    lineLabel: labels.length ? labels.join(', ') : null,
  }
}

// Next estimate number = max numeric existing + 1 (mirrors the bill-number logic).
export function nextEstimateNumber(existing: (string | null)[]): string {
  const nums = existing
    .map((n) => parseInt(n ?? '', 10))
    .filter((n) => !Number.isNaN(n))
  return String((nums.length ? Math.max(...nums) : 0) + 1)
}
