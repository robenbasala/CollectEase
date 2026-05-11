import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

function norm(s) {
  return String(s).trim();
}

/** Stable id fragment from property name (avoid collisions for typical names). */
function optSuffix(name, baseId) {
  const s = norm(name);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const tail = `${Math.abs(h)}-${s.length}`;
  return `${baseId}-opt-${tail}`;
}

export default function PropertyMultiSelect({ id, options, value, onChange, disabled, onOpenChange }) {
  const reactId = useId();
  const baseId = id || reactId.replace(/:/g, "");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const selectedSet = useMemo(() => new Set(value.map((v) => norm(v))), [value]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => norm(o).toLowerCase().includes(q));
  }, [options, search]);

  /** Outside close: use capture + click so checkbox toggles before dropdown steals focus / closes */
  useEffect(() => {
    function onDocClickCapture(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", onDocClickCapture, true);
    return () => document.removeEventListener("click", onDocClickCapture, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle(name) {
    const key = norm(name);
    const next = selectedSet.has(key)
      ? value.filter((v) => norm(v) !== key)
      : [...value, options.find((o) => norm(o) === key) ?? key];
    onChange(dedupePreserve(next));
  }

  function dedupePreserve(arr) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = norm(x);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  }

  function selectAllFiltered() {
    const seen = new Set(value.map(norm));
    const merged = [...value];
    for (const o of filtered) {
      const k = norm(o);
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(o);
      }
    }
    onChange(dedupePreserve(merged));
  }

  const summary =
    value.length === 0
      ? "Select…"
      : value.length === 1
        ? norm(value[0])
        : `${value.length} properties`;

  return (
    <div className={`property-multi-select${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        id={baseId}
        type="button"
        className="property-multi-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="property-multi-trigger-label" title={value.map(norm).join(", ")}>
          {summary}
        </span>
        <span className="property-multi-chevron" aria-hidden>
          <ChevronDown size={16} strokeWidth={2.25} />
        </span>
      </button>
      {open && (
        <div
          className="property-multi-panel"
          role="listbox"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            className="property-multi-search"
            type="search"
            autoFocus
            placeholder="Search properties…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          {filtered.length > 0 && (
            <button type="button" className="property-multi-select-all" onClick={selectAllFiltered}>
              Select all shown
            </button>
          )}
          <ul className="property-multi-list">
            {filtered.length === 0 && <li className="property-multi-empty">No match</li>}
            {filtered.map((name) => {
              const oid = optSuffix(name, baseId);
              const checked = selectedSet.has(norm(name));
              return (
                <li key={norm(name)} className="property-multi-item">
                  <div className="property-multi-item-row">
                    <input
                      id={oid}
                      type="checkbox"
                      className="property-multi-checkbox"
                      checked={checked}
                      onChange={() => toggle(name)}
                    />
                    <label htmlFor={oid} className="property-multi-item-label">
                      {name}
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
