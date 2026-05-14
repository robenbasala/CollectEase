/** Title case on whitespace-separated words (e.g. "landon freeman" → "Landon Freeman"). */
export function formatProperName(name) {
  if (name == null) return "";
  const s = String(name).trim();
  if (!s) return "";
  return s
    .split(/\s+/)
    .map((word) => {
      if (!word) return "";
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function formatUsPhone10Digits(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return formatUsPhone10Digits(d.slice(1));
  return null;
}

/**
 * Pretty-print phone(s). Multiple numbers separated by - / ; etc. become "(###) ###-#### · …".
 * A single formatted value like "(347) 853-4933" still works (digits collapsed then re-formatted).
 */
export function formatPhoneDisplay(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const bySep = s
    .split(/[-–—/;,|]+/)
    .map((p) => p.replace(/\D/g, ""))
    .filter(Boolean);
  const allUs =
    bySep.length > 0 &&
    bySep.every((d) => d.length === 10 || (d.length === 11 && d.startsWith("1")));
  if (allUs) {
    return bySep.map((d) => formatUsPhone10Digits(d) || d).join(" · ");
  }
  const digits = s.replace(/\D/g, "");
  return formatUsPhone10Digits(digits) || s;
}

