// Order-insensitive, punctuation/inch-mark-proof name normalization — the
// TypeScript twin of the SQL gs_normalize_name() used by the daily-log sync.
// Two spellings that differ only by word order, punctuation, the inch mark, or
// the noise words in/inch normalize to the same string:
//   "6' Sidewalk"  -> "6 sidewalk"
//   'Sidewalk 6"'  -> "6 sidewalk"
//   'sidewalk 6'   -> "6 sidewalk"
export function normalizeName(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && t !== 'in' && t !== 'inch')
    .sort()
    .join(' ')
}

// Build a normalized-name → product_id lookup from the price list (first wins).
export function buildNameToProduct(priceList: { id: string; name: string }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const p of priceList) {
    const k = normalizeName(p.name)
    if (k && !m.has(k)) m.set(k, p.id)
  }
  return m
}

// Resolve a line to a product: use its explicit product_id, else fall back to
// matching its free-text description against the price list by normalized name.
// This is what lets an unlinked estimate line ("6' Sidewalk") reconcile with the
// logged/priced product ("Sidewalk 6\"") instead of showing as two separate items.
export function resolveProductId(
  productId: string | null | undefined,
  description: string | null | undefined,
  nameToProduct: Map<string, string>,
): string | null {
  if (productId) return productId
  if (!description) return null
  return nameToProduct.get(normalizeName(description)) ?? null
}
