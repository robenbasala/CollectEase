import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { api } from "../api/apiClient";
import {
  UNIT_DETAIL_COLUMN_ALL_KEYS,
  UNIT_DETAIL_COLUMN_LABELS,
  normalizeUnitDetailColumnPrefs
} from "../constants/unitDetailColumns";

export default function UnitDetailColumnPrefsModal({ open, companyId, initialPrefs, onClose, onSaved }) {
  const [order, setOrder] = useState(UNIT_DETAIL_COLUMN_ALL_KEYS);
  const [hidden, setHidden] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const n = normalizeUnitDetailColumnPrefs(initialPrefs || {});
    setOrder(n.columnOrder);
    setHidden(new Set(n.hidden));
    setError("");
  }, [open, initialPrefs]);

  const withoutActions = order.filter((k) => k !== "actions");

  function moveAtDisplayIndex(displayIndex, dir) {
    const keys = order.filter((k) => k !== "actions");
    const j = displayIndex + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[displayIndex], keys[j]] = [keys[j], keys[displayIndex]];
    setOrder([...keys, "actions"]);
  }

  function toggleHidden(key) {
    if (key === "actions") return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function resetDefaults() {
    const n = normalizeUnitDetailColumnPrefs({});
    setOrder(n.columnOrder);
    setHidden(new Set());
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const data = await api.putAdminUnitDetailColumnPrefs({
        columnOrder: order,
        hidden: [...hidden]
      });
      onSaved({ columnOrder: data.columnOrder, hidden: data.hidden });
      onClose();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="unit-detail-prefs-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="unit-detail-prefs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unit-detail-prefs-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="unit-detail-prefs-modal-head">
          <h2 id="unit-detail-prefs-title">Unit detail columns</h2>
          <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p className="unit-detail-prefs-modal-desc">
          Visibility and column order are stored per company. Company ID <strong>{companyId ?? "—"}</strong>. Actions
          always stay last and stay visible.
        </p>
        {error ? (
          <div className="unit-detail-prefs-modal-error" role="alert">
            {error}
          </div>
        ) : null}
        <ul className="unit-detail-prefs-list">
          {withoutActions.map((key, idx) => (
            <li key={key} className="unit-detail-prefs-row">
              <label className="unit-detail-prefs-visible">
                <input
                  type="checkbox"
                  checked={!hidden.has(key)}
                  onChange={() => toggleHidden(key)}
                  aria-label={`Show ${UNIT_DETAIL_COLUMN_LABELS[key]}`}
                />
                <span>{UNIT_DETAIL_COLUMN_LABELS[key]}</span>
              </label>
              <div className="unit-detail-prefs-reorder">
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label="Move up"
                  disabled={idx === 0}
                  onClick={() => moveAtDisplayIndex(idx, -1)}
                >
                  <ChevronUp size={18} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label="Move down"
                  disabled={idx === withoutActions.length - 1}
                  onClick={() => moveAtDisplayIndex(idx, 1)}
                >
                  <ChevronDown size={18} />
                </button>
              </div>
            </li>
          ))}
          <li className="unit-detail-prefs-row unit-detail-prefs-row--locked">
            <span className="unit-detail-prefs-visible">
              <input type="checkbox" checked disabled aria-readonly />
              <span>{UNIT_DETAIL_COLUMN_LABELS.actions}</span>
            </span>
            <span className="text-muted" style={{ fontSize: "0.85rem" }}>
              Always on
            </span>
          </li>
        </ul>
        <div className="unit-detail-prefs-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={resetDefaults}>
            Reset to defaults
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
