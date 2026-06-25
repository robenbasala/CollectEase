function isBlankPhoneValue(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return !s || s.toLowerCase() === "null";
}

/** Resolve phone from a dashboard unit row (handles legacy / driver casing). */
export function phoneFromUnit(u) {
  if (!u || typeof u !== "object") return "";
  const candidates = [
    u.phone,
    u.Phone,
    u.PhomeNumber,
    u.phomeNumber,
    ...Object.keys(u)
      .filter((k) => {
        const n = k.toLowerCase().replace(/[\s_]/g, "");
        return n === "phone" || n === "phomenumber";
      })
      .map((k) => u[k])
  ];
  for (const v of candidates) {
    if (!isBlankPhoneValue(v)) return String(v).trim();
  }
  return "";
}

/** Remove label words (Phone, Mobile, etc.) and any other letters from a phone fragment. */
function stripPhoneLetters(text) {
  return String(text)
    .replace(/[a-zA-Z]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull 10- or 11-digit US groups out of a cleaned fragment (handles multiple numbers in one string). */
function extractDigitPhoneGroups(text) {
  const digits = String(text).replace(/\D/g, "");
  if (!digits) return [];
  const groups = [];
  let i = 0;
  while (i < digits.length) {
    const remaining = digits.length - i;
    if (remaining >= 11 && digits[i] === "1") {
      groups.push(digits.slice(i, i + 11));
      i += 11;
    } else if (remaining >= 10) {
      groups.push(digits.slice(i, i + 10));
      i += 10;
    } else if (remaining > 0 && groups.length === 0) {
      groups.push(digits.slice(i));
      i = digits.length;
    } else {
      break;
    }
  }
  return groups;
}

function phonePartsFromSegment(segment) {
  const cleaned = stripPhoneLetters(segment);
  if (!cleaned || cleaned.toLowerCase() === "null") return [];
  const groups = extractDigitPhoneGroups(cleaned);
  return groups.length > 0 ? groups : [cleaned];
}

/** Split a raw phone field into separate numbers (strips labels like Phone:/Mobile:). */
export function splitPhoneNumbers(raw) {
  if (isBlankPhoneValue(raw)) return [];
  const segments = String(raw)
    .trim()
    .split(/\r?\n+|[/;,|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const results = [];
  for (const seg of segments) {
    results.push(...phonePartsFromSegment(seg));
  }
  if (results.length === 0) {
    results.push(...phonePartsFromSegment(raw));
  }
  return results.filter((p) => p && String(p).toLowerCase() !== "null");
}

/** One formatted line per phone number (for table cells). */
export function formatPhoneLines(raw) {
  const parts = splitPhoneNumbers(raw);
  if (parts.length === 0) return [];
  const allDigits = parts.map((p) => p.replace(/\D/g, "")).filter(Boolean);
  const allUs =
    allDigits.length > 0 &&
    allDigits.every((d) => d.length === 10 || (d.length === 11 && d.startsWith("1")));
  if (allUs) {
    return allDigits.map((d) => formatUsPhone10Digits(d) || d);
  }
  return parts.map((p) => {
    const digits = p.replace(/\D/g, "");
    return formatUsPhone10Digits(digits) || p;
  });
}

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
  const lines = formatPhoneLines(raw);
  if (lines.length === 0) return "";
  return lines.join(" · ");
}

