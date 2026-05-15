/**
 * Normalize column labels for fuzzy matching (auto-map).
 * @param {string} name
 */
function normalizeColumnName(name) {
  let s = String(name ?? "")
    .trim()
    .toLowerCase();
  s = s.replace(/[\s_\-./]+/g, "");
  s = s.replace(/[^a-z0-9]/g, "");
  return s;
}

/**
 * @param {string} a
 * @param {string} b
 */
function normalizedEquals(a, b) {
  return normalizeColumnName(a) === normalizeColumnName(b);
}

/**
 * @param {string} needleNorm
 * @param {string} hayNorm
 */
function partialScore(needleNorm, hayNorm) {
  if (!needleNorm || !hayNorm) return 0;
  if (hayNorm.includes(needleNorm) || needleNorm.includes(hayNorm)) return 0.75;
  return 0;
}

/**
 * @param {{ name: string, dataType?: string|null }[]} sourceColumns
 * @param {{ column: string, dataType?: string|null }[]} destinationColumns
 * @returns {{ sourceColumn: string, destinationColumn: string, confidence: number, matchType: string }[]}
 */
function autoMapColumns(sourceColumns, destinationColumns) {
  const dest = (destinationColumns || []).map((d) => ({
    column: String(d.column || "").trim(),
    norm: normalizeColumnName(d.column)
  })).filter((d) => d.column);

  const usedDest = new Set();
  /** @type {{ sourceColumn: string, destinationColumn: string, confidence: number, matchType: string }[]} */
  const out = [];

  for (const sc of sourceColumns || []) {
    const sourceColumn = String(sc.name ?? "").trim();
    if (!sourceColumn) continue;
    const sn = normalizeColumnName(sourceColumn);
    let best = null;

    for (const d of dest) {
      if (usedDest.has(d.column)) continue;
      if (sn && sn === d.norm) {
        best = { destinationColumn: d.column, confidence: 1, matchType: "exact-normalized" };
        break;
      }
    }
    if (!best) {
      let bestScore = 0;
      let bestDest = null;
      for (const d of dest) {
        if (usedDest.has(d.column)) continue;
        const ps = partialScore(sn, d.norm);
        if (ps > bestScore) {
          bestScore = ps;
          bestDest = d.column;
        }
      }
      if (bestDest && bestScore >= 0.75) {
        best = { destinationColumn: bestDest, confidence: bestScore, matchType: "partial-normalized" };
      }
    }

    if (best) {
      usedDest.add(best.destinationColumn);
      out.push({
        sourceColumn,
        destinationColumn: best.destinationColumn,
        confidence: best.confidence,
        matchType: best.matchType
      });
    }
  }

  return out;
}

module.exports = {
  normalizeColumnName,
  normalizedEquals,
  autoMapColumns
};
