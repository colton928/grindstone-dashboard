export function ProgressBar({ pct, overage }: { pct: number | null; overage?: boolean }) {
  const clamped = pct == null ? 0 : Math.max(0, Math.min(pct, 100))
  return (
    <div className="bar" role="progressbar" aria-valuenow={pct ?? undefined}>
      <div
        className={`bar-fill${overage ? ' bar-fill-over' : ''}${pct == null ? ' bar-fill-none' : ''}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
