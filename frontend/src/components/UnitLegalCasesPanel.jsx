import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Plus, RefreshCw, Scale, Trash2 } from "lucide-react";
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

function monthOrd(y, m) {
  return Number(y) * 12 + (Number(m) - 1);
}

/** FROM/TO stored on case; single month when end is null or same as start. */
function formatLegalCasePeriod(c) {
  const y1 = c.openYear;
  const m1 = c.openMonth;
  if (y1 == null || m1 == null) return "—";
  const from = formatYearMonth(y1, m1);
  const y2 = c.openEndYear;
  const m2 = c.openEndMonth;
  if (y2 == null || m2 == null) return from;
  if (monthOrd(y2, m2) === monthOrd(y1, m1)) return from;
  return `${from} - ${formatYearMonth(y2, m2)}`;
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

function ordToYm(ord) {
  const y = Math.floor(ord / 12);
  const m = (ord % 12) + 1;
  return { y, m };
}

/** Single line for summary: "May 2026" or "Dec 2025 - Jan 2026". */
function formatRangeSummary(fy, fm, ty, tm) {
  if (!Number.isInteger(fy) || !Number.isInteger(fm) || !Number.isInteger(ty) || !Number.isInteger(tm)) {
    return "—";
  }
  if (monthOrd(ty, tm) === monthOrd(fy, fm)) return formatYearMonth(fy, fm);
  return `${formatYearMonth(fy, fm)} - ${formatYearMonth(ty, tm)}`;
}

function isMonthInRange(y, m, fromY, fromM, toY, toM) {
  const o = monthOrd(y, m);
  return o >= monthOrd(fromY, fromM) && o <= monthOrd(toY, toM);
}

/**
 * Dual-year month grid (From–To). First click sets a single month; second click completes the range.
 */
function LegalCaseMonthRangeCalendar({
  isOpen,
  anchorRef,
  onClose,
  fromYear,
  fromMonth,
  toYear,
  toMonth,
  onApply,
  disabled
}) {
  const wrapRef = useRef(null);
  const [dock, setDock] = useState(null);
  const [leftYear, setLeftYear] = useState(() => Math.min(Number(fromYear), Number(toYear)));
  const [draftFrom, setDraftFrom] = useState({ y: Number(fromYear), m: Number(fromMonth) });
  const [draftTo, setDraftTo] = useState({ y: Number(toYear), m: Number(toMonth) });
  const [firstOrd, setFirstOrd] = useState(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setDock(null);
      return;
    }
    const el = anchorRef?.current;
    if (!el) return;
    function measure() {
      const r = el.getBoundingClientRect();
      const width = Math.max(Math.min(r.width, 720), 420);
      const margin = 8;
      let left = r.left;
      const maxLeft = window.innerWidth - width - margin;
      if (left > maxLeft) left = Math.max(margin, maxLeft);
      if (left < margin) left = margin;
      setDock({
        top: r.bottom + 6,
        left,
        width
      });
    }
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [isOpen, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;
    const fy = Number(fromYear);
    const fm = Number(fromMonth);
    const ty = Number(toYear);
    const tm = Number(toMonth);
    setDraftFrom({ y: fy, m: fm });
    setDraftTo({ y: ty, m: tm });
    setFirstOrd(null);
    setLeftYear(Math.min(fy, ty));
  }, [isOpen, fromYear, fromMonth, toYear, toMonth]);

  useEffect(() => {
    if (!isOpen) return;
    function onDocDown(e) {
      const t = e.target;
      if (wrapRef.current?.contains(t)) return;
      if (anchorRef?.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [isOpen, onClose, anchorRef]);

  function handleMonthClick(y, m) {
    const o = monthOrd(y, m);
    if (firstOrd === null) {
      setFirstOrd(o);
      setDraftFrom({ y, m });
      setDraftTo({ y, m });
      return;
    }
    const start = Math.min(firstOrd, o);
    const end = Math.max(firstOrd, o);
    const a = ordToYm(start);
    const b = ordToYm(end);
    setDraftFrom(a);
    setDraftTo(b);
    setFirstOrd(null);
  }

  function apply() {
    onApply(draftFrom.y, draftFrom.m, draftTo.y, draftTo.m);
    onClose();
  }

  if (!isOpen || !dock) return null;

  const y1 = leftYear;
  const y2 = leftYear + 1;

  const panel = (
    <div
      ref={wrapRef}
      className="ud-monthcal-portal"
      style={{
        position: "fixed",
        top: dock.top,
        left: dock.left,
        width: dock.width,
        zIndex: 10060,
        maxWidth: "min(98vw, 720px)"
      }}
    >
      <div className="ud-monthcal" role="dialog" aria-label="Select month range">
        <div className="ud-monthcal__chrome">
          <button
            type="button"
            className="ud-monthcal__nav"
            aria-label="Show earlier years"
            disabled={disabled || leftYear <= 1900}
            onClick={() => setLeftYear((y) => Math.max(1900, y - 1))}
          >
            <ChevronLeft size={17} strokeWidth={2.1} />
          </button>
          <div className="ud-monthcal__panes">
            <div className="ud-monthcal__pane">
              <div className="ud-monthcal__year-title">{y1}</div>
              <div className="ud-monthcal__grid">
                {MONTHS.map(({ value, label }) => (
                  <button
                    key={`${y1}-${value}`}
                    type="button"
                    disabled={disabled}
                    className={
                      isMonthInRange(y1, value, draftFrom.y, draftFrom.m, draftTo.y, draftTo.m)
                        ? "ud-monthcal__cell is-in-range"
                        : "ud-monthcal__cell"
                    }
                    onClick={() => handleMonthClick(y1, value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ud-monthcal__divider" aria-hidden />
            <div className="ud-monthcal__pane">
              <div className="ud-monthcal__year-title">{y2}</div>
              <div className="ud-monthcal__grid">
                {MONTHS.map(({ value, label }) => (
                  <button
                    key={`${y2}-${value}`}
                    type="button"
                    disabled={disabled}
                    className={
                      isMonthInRange(y2, value, draftFrom.y, draftFrom.m, draftTo.y, draftTo.m)
                        ? "ud-monthcal__cell is-in-range"
                        : "ud-monthcal__cell"
                    }
                    onClick={() => handleMonthClick(y2, value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ud-monthcal__nav"
            aria-label="Show later years"
            disabled={disabled || leftYear >= 9998}
            onClick={() => setLeftYear((y) => Math.min(9998, y + 1))}
          >
            <ChevronRight size={17} strokeWidth={2.1} />
          </button>
        </div>
        <div className="ud-monthcal__summary">
          <span className="ud-monthcal__summary-label">Selected range</span>
          <strong className="ud-monthcal__summary-value">
            {formatRangeSummary(draftFrom.y, draftFrom.m, draftTo.y, draftTo.m)}
          </strong>
        </div>
        <div className="ud-monthcal__footer">
          <button type="button" className="btn btn-ghost ud-monthcal__footer-cancel" onClick={onClose} disabled={disabled}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary ud-monthcal__footer-apply" onClick={apply} disabled={disabled}>
            Apply selection
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

export default function UnitLegalCasesPanel({ rowQuery, onUnitsRefresh }) {
  const [cases, setCases] = useState([]);
  const [statusOptions, setStatusOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const today = useMemo(() => new Date(), []);
  const [newOpen, setNewOpen] = useState(false);
  const [newFromYear, setNewFromYear] = useState(() => today.getFullYear());
  const [newFromMonth, setNewFromMonth] = useState(() => today.getMonth() + 1);
  const [newToYear, setNewToYear] = useState(() => today.getFullYear());
  const [newToMonth, setNewToMonth] = useState(() => today.getMonth() + 1);
  const [newNote, setNewNote] = useState("");
  const [newFollowUp, setNewFollowUp] = useState("");
  const [newCaseStatus, setNewCaseStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [monthRangePickerOpen, setMonthRangePickerOpen] = useState(false);
  const rangeTriggerRef = useRef(null);

  const [expandedId, setExpandedId] = useState(null);
  const [caseStatuses, setCaseStatuses] = useState({});
  const [loadingStatusFor, setLoadingStatusFor] = useState(null);
  const [addStatusValue, setAddStatusValue] = useState("");
  const [addStatusNote, setAddStatusNote] = useState("");
  const [addingStatus, setAddingStatus] = useState(false);
  const [closingId, setClosingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [followUpDraftByCase, setFollowUpDraftByCase] = useState({});
  const [savingFollowUpId, setSavingFollowUpId] = useState(null);

  /** "open" (default) | "closed" | "all" */
  const [caseFilter, setCaseFilter] = useState("open");

  const filteredCases = useMemo(() => {
    if (caseFilter === "all") return cases;
    if (caseFilter === "open") return cases.filter((c) => !c.isClosed);
    return cases.filter((c) => c.isClosed);
  }, [cases, caseFilter]);

  const newCaseStatusOptions = useMemo(() => {
    const set = new Set();
    for (const o of statusOptions) {
      if (o.status) set.add(String(o.status).trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [statusOptions]);

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

  useEffect(() => {
    if (!newOpen) setMonthRangePickerOpen(false);
  }, [newOpen]);

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
    const row = cases.find((x) => x.id === caseId);
    if (row) {
      setFollowUpDraftByCase((prev) => ({ ...prev, [caseId]: toDateInputValue(row.followUpAt) }));
    }
    if (!caseStatuses[caseId]) {
      void loadStatusesFor(caseId);
    }
  }

  function resetNewCase() {
    setNewOpen(false);
    const y = today.getFullYear();
    const mo = today.getMonth() + 1;
    setNewFromYear(y);
    setNewFromMonth(mo);
    setNewToYear(y);
    setNewToMonth(mo);
    setNewNote("");
    setNewFollowUp("");
    setNewCaseStatus("");
    setMonthRangePickerOpen(false);
  }

  async function createCase() {
    if (!rowQuery) return;
    const fy = Number(newFromYear);
    const fm = Number(newFromMonth);
    const ty = Number(newToYear);
    const tm = Number(newToMonth);
    if (!Number.isInteger(fy) || !Number.isInteger(fm) || !Number.isInteger(ty) || !Number.isInteger(tm)) {
      setErr("Enter valid years and months");
      return;
    }
    if (monthOrd(ty, tm) < monthOrd(fy, fm)) {
      setErr("“To” must be the same month or later than “From”.");
      return;
    }
    setCreating(true);
    setErr("");
    try {
      const acc = await getActiveMsAccount();
      const createdByName = (acc?.name || acc?.username || "").trim().slice(0, 256);
      const body = {
        ...rowQuery,
        openYear: fy,
        openMonth: fm,
        initialNote: newNote || null,
        followUpAt: fromDateInputValue(newFollowUp),
        ...(createdByName ? { createdByName } : {})
      };
      if (monthOrd(ty, tm) > monthOrd(fy, fm)) {
        body.openEndYear = ty;
        body.openEndMonth = tm;
      }
      const created = await api.postDashboardLegalCase(body);
      const caseId = created?.id ?? created?.caseId;
      const statusPick = String(newCaseStatus || "").trim();
      if (caseId && statusPick) {
        await api.postDashboardLegalCaseStatus(caseId, {
          status: statusPick,
          note: null,
          ...(createdByName ? { createdByName } : {})
        });
      }
      resetNewCase();
      await loadAll();
      onUnitsRefresh?.();
    } catch (e) {
      setErr(e.message || "Could not create case");
      await loadAll();
      onUnitsRefresh?.();
    } finally {
      setCreating(false);
    }
  }

  async function saveFollowUp(c) {
    if (c.isClosed) return;
    const rawDraft = followUpDraftByCase[c.id];
    const inputVal = rawDraft !== undefined ? rawDraft : toDateInputValue(c.followUpAt);
    const curDay = c.followUpAt ? toDateInputValue(c.followUpAt) : "";
    if (String(inputVal || "").trim() === String(curDay || "").trim()) {
      return;
    }
    setSavingFollowUpId(c.id);
    setErr("");
    try {
      const nextIso = fromDateInputValue(String(inputVal || "").trim());
      await api.patchDashboardLegalCase(c.id, { followUpAt: nextIso });
      setFollowUpDraftByCase((p) => ({ ...p, [c.id]: toDateInputValue(nextIso) }));
      await loadAll();
      onUnitsRefresh?.();
    } catch (e) {
      setErr(e.message || "Could not update follow-up date");
    } finally {
      setSavingFollowUpId(null);
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
          <div className="ud-cases__new-row ud-cases__new-row--2">
            <div className="ud-cases__field ud-cases__period-wrap">
              <span>From – To</span>
              <button
                ref={rangeTriggerRef}
                type="button"
                className="ud-cases__range-trigger"
                disabled={creating}
                aria-expanded={monthRangePickerOpen}
                aria-haspopup="dialog"
                onClick={() => setMonthRangePickerOpen((o) => !o)}
              >
                <span className="ud-cases__range-trigger-text">
                  {formatRangeSummary(newFromYear, newFromMonth, newToYear, newToMonth)}
                </span>
                <ChevronDown size={16} strokeWidth={2.25} aria-hidden className="ud-cases__range-trigger-chev" />
              </button>
              <LegalCaseMonthRangeCalendar
                isOpen={monthRangePickerOpen}
                anchorRef={rangeTriggerRef}
                onClose={() => setMonthRangePickerOpen(false)}
                fromYear={newFromYear}
                fromMonth={newFromMonth}
                toYear={newToYear}
                toMonth={newToMonth}
                disabled={creating}
                onApply={(fy, fm, ty, tm) => {
                  setNewFromYear(fy);
                  setNewFromMonth(fm);
                  setNewToYear(ty);
                  setNewToMonth(tm);
                }}
              />
            </div>
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
            <span>Legal status</span>
            <select
              value={newCaseStatus}
              onChange={(e) => setNewCaseStatus(e.target.value)}
              disabled={creating || newCaseStatusOptions.length === 0}
            >
              <option value="">
                {newCaseStatusOptions.length === 0 ? "No statuses configured for this property" : "— Optional —"}
              </option>
              {newCaseStatusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
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
              disabled={
                creating ||
                !newFromYear ||
                !newFromMonth ||
                !newToYear ||
                !newToMonth
              }
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
                      <span className="ud-cases__head-period">{formatLegalCasePeriod(c)}</span>
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

                      {!c.isClosed ? (
                        <div className="ud-cases__followup-edit">
                          <label className="ud-cases__field ud-cases__field--wide">
                            <span>Follow-up date</span>
                            <div className="ud-cases__followup-edit-row">
                              <input
                                type="date"
                                className="ud-cases__followup-date-input"
                                value={
                                  followUpDraftByCase[c.id] !== undefined
                                    ? followUpDraftByCase[c.id]
                                    : toDateInputValue(c.followUpAt)
                                }
                                onChange={(e) =>
                                  setFollowUpDraftByCase((prev) => ({
                                    ...prev,
                                    [c.id]: e.target.value
                                  }))
                                }
                                disabled={savingFollowUpId === c.id}
                              />
                              <button
                                type="button"
                                className="btn btn-primary ud-cases__followup-save"
                                disabled={savingFollowUpId === c.id}
                                onClick={() => void saveFollowUp(c)}
                              >
                                {savingFollowUpId === c.id ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </label>
                        </div>
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
