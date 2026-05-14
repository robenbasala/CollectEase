/**
 * Legal status label with open-case count in a badge below (dashboard / modal).
 */
export default function LegalStatusCell({ status, openCount, compact = false }) {
  const s = String(status ?? "").trim();
  const n = Number(openCount);
  const c = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  const showDash = !s && c === 0;
  const badgeLabel = c === 1 ? `${c} open case` : `${c} open cases`;

  return (
    <div className={`ud-legal-status-cell${compact ? " ud-legal-status-cell--compact" : ""}`}>
      <span className="ud-legal-status-cell__text">{showDash ? "—" : s || "\u00a0"}</span>
      {c > 0 ? (
        <span className="ud-legal-status-cell__badge" aria-label={badgeLabel}>
          {badgeLabel}
        </span>
      ) : null}
    </div>
  );
}
