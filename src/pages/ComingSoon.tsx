export function ComingSoon({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <div className="empty-card">
        <p className="label">Coming in Phase {phase}</p>
        <p>This tab isn't built yet. Phase 1 covers the home dashboard and job tracking.</p>
      </div>
    </div>
  )
}
