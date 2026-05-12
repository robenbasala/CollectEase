import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, RefreshCw, Scale, Trash2 } from "lucide-react";
import { api } from "../api/apiClient";
import { getActiveMsAccount } from "../microsoft/msGraphMail";

const MONTHS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" }
];

function formatYearMonth(y, m) {
  const mm = Number(m);
  const idx = Number.isInteger(mm) && mm >= 1 && mm <= 12 ? mm - 1 : null;
  const label = idx == null ? "—" : MONTHS[idx].label;
  return `${label} ${y ?? "—"}`;
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString();
}

function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function toDateInputValue(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromDateInputValue(s) {
  if (!s || !String(s).trim()) return null;
  const dt = new Date(`${s}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export default function UnitLegalCasesPanel({ rowQuery, onUnitsRefresh }) {
  const [cases, setCases] = useState([]);
  const [statusOptions, setStatusOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const today = useMemo(() => new Date(), []);
  const [newOpen, setNewOpen] = useState(false);
  const [newYear, setNewYear] = useState(() => today.getFullYear());
  const [newMonth, setNewMonth] = useState(() => today.getMonth() + 1);
  const [newNote, setNewNote] = useState("");
  const [newFollowUp, setNewFollowUp] = useState("");
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState(null);
  const [caseStatuses, setCaseStatuses] = useState({});
  const [loadingStatusFor, setLoadingStatusFor] = useState(null);
  const [addStatusValue, setAddStatusValue] = useState("");
  const [addStatusNote, setAddStatusNote] = useState("");
  const [addingStatus, setAddingStatus] = useState(false);
  const [closingId, setClosingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  /** "open" (default) | "closed" | "all" */
  const [caseFilter, setCaseFilter] = useState("open");

  const filteredCases = useMemo(() => {
    if (caseFilter === "all") return cases;
    if (caseFilter === "open") return cases.filter((c) => !c.isClosed);
    return cases.filter((c) => c.isClosed);
  }, [cases, caseFilter]);

  const loadAll = useCallback(async () => {
    if (!rowQuery?.property) return;
    setLoading(true);
    setErr("");
    try {
      const [cs, opts] = await Promise.all([
        api.getDashboardLegalCases(rowQuery),
        api.getDashboardPropertyLegalStatusOptions(rowQuery.property)
      ]);
      setCases(Array.isArray(cs.cases) ? cs.cases : []);
      setStatusOptions(Array.isArray(opts.options) ? opts.options : []);
    } catch (e) {
      setErr(e.message || "Failed to load cases");
    } finally {
      setLoading(false);
    }
  }, [rowQuery]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function loadStatusesFor(caseId) {
    setLoadingStatusFor(caseId);
    try {
      const data = await api.getDashboardLegalCaseStatuses(caseId);
      setCaseStatuses((prev) => ({
        ...prev,
        [caseId]: Array.isArray(data.statuses) ? data.statuses : []
      }));
    } catch (e) {
      setErr(e.message || "Failed to load case history");
    } finally {
      setLoadingStatusFor(null);
    }
  }

  function toggleExpanded(caseId) {
    if (expandedId === caseId) {
      setExpandedId(null);
      setAddStatusValue("");
      setAddStatusNote("");
      return;
    }
    setExpandedId(caseId);
    setAddStatusValue("");
    setAddStatusNote("");
    if (!caseStatuses[caseId]) {
      void loadStatusesFor(caseId);
    }
  }

  function resetNewCase() {
    setNewOpen(false);
    setNewYear(today.getFullYear());
    setNewMonth(today.getMonth() + 1);
    setNewNote("");
    setNewFollowUp("");
  }

  async function createCase() {
    if (!rowQuery) return;
    setCreating(true);
    setErr("");
    try {
      const acc = await getActiveMsAccount();
      const createdByName = (acc?.name || acc?.username || "").trim().slice(0, 256);
      await api.postDashboardLegalCase({
        ...rowQuery,
        openYear: Number(newYear),
        openMonth: Number(newMonth),
        initialNote: newNote || null,
        followUpAt: fromDateInputValue(newFollowUp),
        ...(createdByName ? { createdByName } : {})
      });
      resetNewCase();
      await loadAll();
      onUnitsRefresh?.();
    } catch (e) {
      setErr(e.message || "Could not create case");
    } finally {
      setCreating(false);
    }
  }

  async function toggleCaseClosed(c) {
    setClosingId(c.id);
    setErr("");
    try {
      await api.patchDashboardLegalCase(c.id, { isClosed: !c.isClosed });
      await loadAll();
      onUnitsRefresh?.();
    } catch (e) {
      setErr(e.message || "Could not update case");
    } finally {
      setClosingId(null);
    }
  }

  async function deleteCase(c) {
    if (!window.confirm("Delete this case and all of its status history?")) return;
    setDeletingId(c.id);
    setErr("");
    try {
      await api.deleteDashboardLegalCase(c.id);
      setExpandedId((cur) => (cur === c.id ? null : cur));
      await loadAll();
      onUnitsRefresh?.();
    } catch (e) {
      setErr(e.message || "Could not delete case");
    } finally {
      setDeletingId(null);
    }
  }

  async function addStatusToCase(c) {
    const status = String(addStatusValue || "").trim();
    if (!status) {
      setErr("Pick a status to log");
      return;
    }
    setAddingStatus(true);
    setErr("");
    try {
      const acc = await getActiveMsAccount();
      const createdByName = (acc?.name || acc?.username || "").trim().slice(0, 256);
      await api.postDashboardLegalCaseStatus(c.id, {
        status,
        note: addStatusNote || null,
        ...(createdByName ? { createdByName } : {})
      });
      setAddStatusValue("");
      setAddStatusNote("");
      await Promise.all([loadStatusesFor(c.id), loadAll()]);
      setExpandedId(null);
      onUnitsRefresh?.();
    } catch (e) {
      setErr(e.message || "Could not log status");
    } finally {
      setAddingStatus(false);
    }
  }

  /** Merge case's latest-saved status with property options so a missing or legacy status
   *  still shows in the dropdown when the admin reopens the picker. */
  function optionsForCase(c) {
    const set = new Set();
    for (const o of statusOptions) {
      if (o.status) set.add(String(o.status).trim());
    }
    const latest = String(c?.latestStatus ?? "").trim();
    if (latest) set.add(latest);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  return (
    <div className="ud-cases">
      <div className="ud-cases__head">
        <h3 className="ud-row-modal__panel-title">
          <Scale size={18} aria-hidden />
          Legal cases
        </h3>
        <button
          type="button"
          className="btn btn-primary ud-cases__new-btn"
          onClick={() => setNewOpen((v) => !v)}
          aria-expanded={newOpen}
        >
          <Plus size={16} strokeWidth={2.5} />
          {newOpen ? "Cancel" : "Open new case"}
        </button>
      </div>

      {err ? (
        <p className="ud-row-modal__err" role="alert">
          {err}
        </p>
      ) : null}

      {newOpen ? (
        <div className="ud-cases__new-form">
          <div className="ud-cases__new-row">
            <label className="ud-cases__field">
              <span>Year</span>
              <input
                type="number"
                inputMode="numeric"
                min={1900}
                max={9999}
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
              />
            </label>
            <label className="ud-cases__field">
              <span>Month</span>
              <select value={newMonth} onChange={(e) => setNewMonth(Number(e.target.value))}>
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ud-cases__field">
              <span>Follow-up date</span>
              <input
                type="date"
                value={newFollowUp}
                onChange={(e) => setNewFollowUp(e.target.value)}
              />
            </label>
          </div>
          <label className="ud-cases__field ud-cases__field--wide">
            <span>Note</span>
            <textarea
              rows={2}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Reason / initial details (optional)"
              maxLength={4000}
            />
          </label>
          <div className="ud-cases__new-actions">
            <button type="button" className="btn btn-ghost" onClick={resetNewCase} disabled={creating}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={creating || !newYear || !newMonth}
              onClick={() => void createCase()}
            >
              {creating ? "Adding…" : "Add case"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="ud-cases__list-head">
        <h4 className="ud-row-modal__subhead">Cases</h4>
        <div className="ud-cases__filter" role="group" aria-label="Filter cases">
          <button
            type="button"
            className={`ud-cases-filter-badge ud-cases-filter-badge--open${caseFilter === "open" ? " is-active" : ""}`}
            onClick={() => setCaseFilter("open")}
          >
            Open
          </button>
          <button
            type="button"
            className={`ud-cases-filter-badge ud-cases-filter-badge--closed${caseFilter === "closed" ? " is-active" : ""}`}
            onClick={() => setCaseFilter("closed")}
          >
            Closed
          </button>
          <button
            type="button"
            className={`ud-cases-filter-badge${caseFilter === "all" ? " is-active" : ""}`}
            onClick={() => setCaseFilter("all")}
          >
            All
          </button>
        </div>
        <button
          type="button"
          className="ud-cases__refresh"
          onClick={() => void loadAll()}
          aria-label="Refresh cases"
          title="Refresh"
          disabled={loading}
        >
          <RefreshCw size={14} strokeWidth={2.25} />
        </button>
      </div>

      <div className="ud-row-modal__scrollbox ud-cases__list-scroll">
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : filteredCases.length === 0 ? (
          <p className="text-muted">
            {cases.length === 0
              ? "No cases yet for this tenant."
              : caseFilter === "open"
                ? "No open cases."
                : caseFilter === "closed"
                  ? "No closed cases."
                  : "No cases."}
          </p>
        ) : (
          <ul className="ud-cases__list">
            {filteredCases.map((c) => {
              const expanded = expandedId === c.id;
              const statuses = caseStatuses[c.id] || [];
              const options = optionsForCase(c);
              return (
                <li
                  key={c.id}
                  className={`ud-cases__item${c.isClosed ? " ud-cases__item--closed" : " ud-cases__item--open"}${expanded ? " is-expanded" : ""}`}
                >
                  <button
                    type="button"
                    className="ud-cases__item-head"
                    onClick={() => toggleExpanded(c.id)}
                    aria-expanded={expanded}
                  >
                    <span className="ud-cases__chev" aria-hidden>
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <span className="ud-cases__head-main">
                      <span className="ud-cases__head-period">{formatYearMonth(c.openYear, c.openMonth)}</span>
                      <span className="ud-cases__head-status">
                        {c.latestStatus ? c.latestStatus : <em className="text-muted">No status yet</em>}
                      </span>
                    </span>
                    <span className="ud-cases__head-meta">
                      {c.followUpAt ? (
                        <span className="ud-cases__followup" title="Follow-up">
                          ⏰ {formatDate(c.followUpAt)}
                        </span>
                      ) : null}
                      <span
                        className={`ud-cases__badge${c.isClosed ? " ud-cases__badge--closed" : " ud-cases__badge--open"}`}
                      >
                        {c.isClosed ? "Closed" : "Open"}
                      </span>
                    </span>
                  </button>

                  {expanded ? (
                    <div className="ud-cases__body">
                      {c.initialNote ? (
                        <p className="ud-cases__initial-note">{c.initialNote}</p>
                      ) : null}

                      <div className="ud-cases__add-status">
                        <div className="ud-cases__add-row">
                          <select
                            value={addStatusValue}
                            onChange={(e) => setAddStatusValue(e.target.value)}
                            disabled={addingStatus || c.isClosed}
                          >
                            <option value="">— Pick status —</option>
                            {options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={addingStatus || !addStatusValue || c.isClosed}
                            onClick={() => void addStatusToCase(c)}
                            title={c.isClosed ? "Reopen the case to log new status" : "Log status"}
                          >
                            {addingStatus ? "…" : "Log status"}
                          </button>
                        </div>
                        <textarea
                          className="ud-cases__add-note"
                          rows={2}
                          placeholder="Optional note for this status entry"
                          value={addStatusNote}
                          onChange={(e) => setAddStatusNote(e.target.value)}
                          maxLength={4000}
                          disabled={addingStatus || c.isClosed}
                        />
                      </div>

                      {loadingStatusFor === c.id ? (
                        <p className="text-muted">Loading…</p>
                      ) : statuses.length === 0 ? null : (
                        <ul className="ud-cases__history">
                          {statuses.map((s) => (
                            <li key={s.id} className="ud-cases__history-item">
                              <div className="ud-cases__history-top">
                                <strong>{s.status}</strong>
                                <time className="text-muted">{formatDateTime(s.changedAt)}</time>
                              </div>
                              {s.note ? <p className="ud-cases__history-note">{s.note}</p> : null}
                              {s.createdByName ? (
                                <span className="ud-cases__history-author text-muted">{s.createdByName}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="ud-cases__case-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={closingId === c.id}
                          onClick={() => void toggleCaseClosed(c)}
                        >
                          {closingId === c.id
                            ? "…"
                            : c.isClosed
                              ? (
                                <>
                                  <RefreshCw size={14} /> Reopen case
                                </>
                              )
                              : (
                                <>
                                  <Check size={14} /> Close case
                                </>
                              )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost ud-cases__delete"
                          disabled={deletingId === c.id}
                          onClick={() => void deleteCase(c)}
                          title="Delete case"
                        >
                          {deletingId === c.id ? "…" : (
                            <>
                              <Trash2 size={14} /> Delete
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
