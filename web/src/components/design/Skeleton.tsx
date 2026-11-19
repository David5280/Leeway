// Placeholder rows while a list loads, shaped like the rows that will
// replace them, so nothing jumps when the data arrives.

export function SkeletonRows({ count = 6, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-row" aria-hidden="true">
          <span className="skeleton skeleton-circle" />
          <span className="skeleton-lines">
            {/* Varied widths read as text rather than a grid of bars. */}
            <span className="skeleton" style={{ width: `${55 - (index % 3) * 12}%` }} />
            <span className="skeleton skeleton-short" />
          </span>
          <span className="skeleton skeleton-amount" />
        </div>
      ))}
    </div>
  )
}
