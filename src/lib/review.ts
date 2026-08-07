// Single source of truth for "does this daily report need review?" — used by
// both the Logs list (which shows the Mark-reviewed button) and the tab badge
// count. They MUST agree, or the badge counts rows the list can't clear.
// A report needs review when it carries a non-blank note or issue and hasn't
// been marked reviewed. Whitespace-only text does NOT count.
export function logNeedsReview(l: {
  reviewed_at: string | null
  notes: string | null
  issues_delays: string | null
}): boolean {
  return (
    !l.reviewed_at &&
    !!((l.notes && l.notes.trim()) || (l.issues_delays && l.issues_delays.trim()))
  )
}
