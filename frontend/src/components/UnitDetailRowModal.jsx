import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  ExternalLink,
  Highlighter,
  Mail,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  StickyNote,
  Trash2,
  X
} from "lucide-react";
import { api } from "../api/apiClient";
import { getActiveMsAccount } from "../microsoft/msGraphMail";
import UnitLegalCasesPanel from "./UnitLegalCasesPanel";

function tenantCodeFromUnit(u) {
  if (!u || typeof u !== "object") return "";
  for (const k of Object.keys(u)) {
    if (k.toLowerCase() === "tenantcode") {
      const v = u[k];
      return v == null ? "" : String(v).trim();
    }
  }
  return "";
}

function formatMoney(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(v);
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString();
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

function noteSourceOf(n) {
  return n && String(n.noteSource).toLowerCase() === "auto" ? "auto" : "manual";
}

function buildTenantDeepLink(staticPart, tenantCode) {
  if (!staticPart || typeof staticPart !== "string") return null;
  const base = staticPart.trim();
  if (!base || !tenantCode) return null;
  const code = String(tenantCode).trim();
  if (!code) return null;
  return `${base}${code}`;
}

export default function UnitDetailRowModal({
  open,
  unit,
  onClose,
  erpStaticLink,
  emailPreviewContext,
  onOpenPaymentReminder,
  onUnitsRefresh
}) {
  const [nextFollowInput, setNextFollowInput] = useState("");
  const [savingFollow, setSavingFollow] = useState(false);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [loadingSide, setLoadingSide] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEditNoteId, setSavingEditNoteId] = useState(null);
  const [deleteConfirmNote, setDeleteConfirmNote] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [noteFilter, setNoteFilter] = useState("all");

  const tc = useMemo(() => (unit ? tenantCodeFromUnit(unit) : ""), [unit]);

  const rowQuery = useMemo(() => {
    if (!unit) return null;
    return {
      property: String(unit.property ?? "").trim(),
      unit: String(unit.unit ?? "").trim(),
      name: String(unit.name ?? "").trim(),
      tenantCode: tc || undefined
    };
  }, [unit, tc]);

  const loadNotes = useCallback(async () => {
    if (!rowQuery?.property) return;
    setLoadingSide(true);
    setErr("");
    try {
      const n = await api.getDashboardUnitNotes(rowQuery);
      setNotes(
        (Array.isArray(n.notes) ? n.notes : []).map((x) => ({
          ...x,
          noteSource: noteSourceOf(x)
        }))
      );
    } catch (e) {
      setErr(e.message || "Failed to load notes");
    } finally {
      setLoadingSide(false);
    }
  }, [rowQuery]);

  useEffect(() => {
    if (!open || !unit) {
      setNoteDraft("");
      setEditingNoteId(null);
      setEditDraft("");
      setDeleteConfirmNote(null);
      setNoteFilter("all");
      setErr("");
      return;
    }
    setNextFollowInput(toDateInputValue(unit.nextFollowUp));
    void loadNotes();
  }, [open, unit, loadNotes]);

  const filteredNotes = useMemo(() => {
    if (noteFilter === "all") return notes;
    return notes.filter((x) => noteSourceOf(x) === noteFilter);
  }, [notes, noteFilter]);

  async function saveFollowUp() {
    if (!rowQuery) return;
    setSavingFollow(true);
    setErr("");
    try {
      const iso = fromDateInputValue(nextFollowInput);
      await api.patchDashboardUnitRow({
        ...rowQuery,
        nextFollowUp: iso
      });
      onUnitsRefresh?.();
    } catch (e) {
      setErr(e.message || "Save failed");
    } finally {
      setSavingFollow(false);
    }
  }

  async function saveNote() {
    const text = noteDraft.trim();
    if (!text || !rowQuery) return;
    setSavingNote(true);
    setErr("");
    try {
      const acc = await getActiveMsAccount();
      const createdByName = (acc?.name || acc?.username || "").trim().slice(0, 256);
      await api.postDashboardUnitNote({
        ...rowQuery,
        body: text,
        noteSource: "manual",
        isPinned: false,
        isHighlighted: false,
        ...(createdByName ? { createdByName } : {})
      });
      setNoteDraft("");
      await loadNotes();
      onUnitsRefresh?.();
    } catch (e) {
      setErr(e.message || "Could not save note");
    } finally {
      setSavingNote(false);
    }
  }

  function beginEditNote(n) {
    if (noteSourceOf(n) === "auto") return;
    setEditingNoteId(n.id);
    setEditDraft(n.body ?? "");
  }

  function cancelEditNote() {
    setEditingNoteId(null);
    setEditDraft("");
  }

  async function saveEditNote(noteId) {
    const text = editDraft.trim();
    if (!text) return;
    setSavingEditNoteId(noteId);
    setErr("");
    try {
      const data = await api.patchDashboardUnitNote(noteId, { body: text });
      const next = data.note;
      setNotes((prev) =>
        prev
          .map((x) => (x.id === next.id ? { ...x, ...next, noteSource: noteSourceOf(next) } : x))
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || String(b.createdAt).localeCompare(String(a.createdAt)))
      );
      cancelEditNote();
    } catch (e) {
      setErr(e.message || "Could not update note");
    } finally {
      setSavingEditNoteId(null);
    }
  }

  async function performDeleteNote(n) {
    setDeleteBusy(true);
    setErr("");
    try {
      await api.deleteDashboardUnitNote(n.id);
      setNotes((prev) => prev.filter((x) => x.id !== n.id));
      if (editingNoteId === n.id) cancelEditNote();
      setDeleteConfirmNote(null);
    } catch (e) {
      setErr(e.message || "Could not delete note");
    } finally {
      setDeleteBusy(false);
    }
  }

  function requestDeleteNote(n) {
    setDeleteConfirmNote(n);
  }

  async function toggleNotePin(note) {
    try {
      const data = await api.patchDashboardUnitNote(note.id, { isPinned: !note.isPinned });
      const next = data.note;
      setNotes((prev) =>
        prev
          .map((x) => (x.id === next.id ? { ...x, ...next, noteSource: noteSourceOf(next) } : x))
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || String(b.createdAt).localeCompare(String(a.createdAt)))
      );
    } catch (e) {
      setErr(e.message || "Update failed");
    }
  }

  async function toggleNoteHighlight(note) {
    try {
      const data = await api.patchDashboardUnitNote(note.id, { isHighlighted: !note.isHighlighted });
      const next = data.note;
      setNotes((prev) => prev.map((x) => (x.id === next.id ? { ...x, ...next, noteSource: noteSourceOf(next) } : x)));
    } catch (e) {
      setErr(e.message || "Update failed");
    }
  }

  if (!open || !unit) return null;

  const erpHref = buildTenantDeepLink(erpStaticLink, tc);
  const phone = unit.phone ?? unit.PhomeNumber ?? unit.phomeNumber ?? "";

  return (
    <div
      className="ud-row-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ud-row-modal" role="dialog" aria-modal="true" aria-labelledby="ud-row-modal-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ud-row-modal__top">
          <div>
            <h2 id="ud-row-modal-title" className="ud-row-modal__title">
              Unit workspace
            </h2>
            <p className="ud-row-modal__subtitle text-muted">
              {unit.property} · Unit {unit.unit || "—"}
            </p>
          </div>
          <button type="button" className="ud-row-modal__close btn-icon" aria-label="Close" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        {err ? (
          <p className="ud-row-modal__err" role="alert">
            {err}
          </p>
        ) : null}

        <div className="ud-row-modal__grid">
          <section className="ud-row-modal__panel ud-row-modal__panel--info">
            <h3 className="ud-row-modal__panel-title">Details</h3>
            <div className="ud-row-modal__fields">
              <div className="ud-row-modal__field">
                <label>Unit</label>
                <input readOnly value={unit.unit ?? ""} />
              </div>
              <div className="ud-row-modal__field">
                <label>Name</label>
                <input readOnly value={unit.name ?? ""} />
              </div>
              <div className="ud-row-modal__field">
                <label>Balance</label>
                <input readOnly value={formatMoney(unit.balance)} />
              </div>
              <div className="ud-row-modal__field">
                <label>Months delinquent</label>
                <input readOnly value={unit.monthsDelinquent ?? ""} />
              </div>
              <div className="ud-row-modal__field">
                <label>Last payment date</label>
                <input readOnly value={formatDate(unit.lastPaymentDate)} />
              </div>
              <div className="ud-row-modal__field">
                <label>Last payment amount</label>
                <input readOnly value={formatMoney(unit.lastPaymentAmount)} />
              </div>
              <div className="ud-row-modal__field ud-row-modal__field--wide">
                <label>Email</label>
                <input readOnly value={unit.email ?? ""} />
              </div>
              <div className="ud-row-modal__field ud-row-modal__field--wide">
                <label>Phone</label>
                <input readOnly value={phone || "—"} />
              </div>
            </div>

            <div className="ud-row-modal__divider">
              <span>Actions</span>
            </div>

            <div className="ud-row-modal__actions-block">
              <label className="ud-row-modal__inline-label">Next follow up</label>
              <div className="ud-row-modal__follow-row">
                <input
                  type="date"
                  className="ud-row-modal__date"
                  value={nextFollowInput}
                  onChange={(e) => setNextFollowInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary ud-row-modal__iconbtn"
                  disabled={savingFollow}
                  title="Save follow-up date"
                  onClick={() => void saveFollowUp()}
                >
                  <Calendar size={18} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost ud-row-modal__iconbtn"
                  title="Reset from row"
                  onClick={() => setNextFollowInput(toDateInputValue(unit.nextFollowUp))}
                >
                  <RefreshCw size={18} />
                </button>
              </div>
              <p className="ud-row-modal__hint text-muted">Saves to the dashboard table for this tenant.</p>

              <div className="ud-row-modal__current-legal">
                <span className="text-muted">Current legal status</span>
                <strong>{unit.legalStatus || "—"}</strong>
              </div>

              <div className="ud-row-modal__quick-btns">
                {unit.email || emailPreviewContext?.replyEmail ? (
                  <button
                    type="button"
                    className="btn btn-primary ud-row-modal__sq"
                    title="Payment reminder"
                    onClick={() => {
                      onOpenPaymentReminder?.(unit);
                    }}
                  >
                    <Mail size={20} />
                  </button>
                ) : null}
                {erpHref ? (
                  <a className="btn btn-primary ud-row-modal__sq" href={erpHref} target="_blank" rel="noopener noreferrer" title="Open in ERP">
                    <ExternalLink size={20} />
                  </a>
                ) : null}
              </div>
            </div>
          </section>

          <section className="ud-row-modal__panel ud-row-modal__panel--legal">
            <UnitLegalCasesPanel rowQuery={rowQuery} onUnitsRefresh={onUnitsRefresh} />
          </section>

          <section className="ud-row-modal__panel ud-row-modal__panel--notes">
            <h3 className="ud-row-modal__panel-title">
              <StickyNote size={18} aria-hidden />
              Notes
            </h3>
            <textarea
              className="ud-row-modal__note-input"
              rows={3}
              placeholder="Add note here…"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              maxLength={4000}
            />
            <button type="button" className="btn btn-primary ud-row-modal__fullbtn" disabled={savingNote || !noteDraft.trim()} onClick={() => void saveNote()}>
              {savingNote ? "Saving…" : "Save note"}
            </button>

            <div className="ud-row-modal__saved-notes-head">
              <h4 className="ud-row-modal__subhead ud-row-modal__subhead--notes">Saved notes</h4>
              <div className="ud-row-modal__note-filter-badges" role="group" aria-label="Filter notes by type">
                <button
                  type="button"
                  className={`ud-note-filter-badge${noteFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setNoteFilter("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`ud-note-filter-badge ud-note-filter-badge--auto${noteFilter === "auto" ? " is-active" : ""}`}
                  onClick={() => setNoteFilter("auto")}
                >
                  Auto
                </button>
                <button
                  type="button"
                  className={`ud-note-filter-badge ud-note-filter-badge--manual${noteFilter === "manual" ? " is-active" : ""}`}
                  onClick={() => setNoteFilter("manual")}
                >
                  Manual
                </button>
              </div>
            </div>
            <div className="ud-row-modal__scrollbox ud-row-modal__scrollbox--notes">
              {loadingSide ? (
                <p className="text-muted">Loading…</p>
              ) : notes.length === 0 ? (
                <p className="text-muted">No notes yet.</p>
              ) : filteredNotes.length === 0 ? (
                <p className="text-muted">No notes match this filter.</p>
              ) : (
                <ul className="ud-row-modal__notes">
                  {filteredNotes.map((n) => {
                    const isAuto = noteSourceOf(n) === "auto";
                    return (
                    <li
                      key={n.id}
                      className={`ud-row-modal__note${isAuto ? " ud-row-modal__note--auto" : ""}${n.isHighlighted ? " ud-row-modal__note--hi" : ""}${n.isPinned ? " ud-row-modal__note--pin" : ""}${editingNoteId === n.id ? " ud-row-modal__note--editing" : ""}`}
                    >
                      <div className="ud-row-modal__note-top">
                        <div className="ud-row-modal__note-meta">
                          <div className="ud-row-modal__note-meta-row">
                            <time className="text-muted">{formatDate(n.createdAt)}</time>
                            <span className={`ud-row-modal__note-kind-badge${isAuto ? " ud-row-modal__note-kind-badge--auto" : " ud-row-modal__note-kind-badge--manual"}`}>
                              {isAuto ? "Auto" : "Manual"}
                            </span>
                          </div>
                          {n.createdByName ? (
                            <span className="ud-row-modal__note-author" title="Author">
                              {n.createdByName}
                            </span>
                          ) : null}
                        </div>
                        <div className="ud-row-modal__note-actions">
                          {!isAuto ? (
                          <div className="ud-row-modal__note-tools ud-row-modal__note-tools--pinhi">
                            <button
                              type="button"
                              className={`ud-row-modal__note-toolbtn ud-row-modal__tool${n.isPinned ? " is-on" : ""}`}
                              title={n.isPinned ? "Unpin" : "Pin to top"}
                              disabled={editingNoteId === n.id}
                              onClick={() => void toggleNotePin(n)}
                            >
                              {n.isPinned ? <Pin size={14} strokeWidth={2.25} /> : <PinOff size={14} strokeWidth={2.25} />}
                            </button>
                            <button
                              type="button"
                              className={`ud-row-modal__note-toolbtn ud-row-modal__tool${n.isHighlighted ? " is-on" : ""}`}
                              title={n.isHighlighted ? "Remove highlight" : "Highlight"}
                              disabled={editingNoteId === n.id}
                              onClick={() => void toggleNoteHighlight(n)}
                            >
                              <Highlighter size={14} strokeWidth={2.25} />
                            </button>
                          </div>
                          ) : null}
                          <div className="ud-row-modal__note-tools ud-row-modal__note-tools--editdel">
                            {editingNoteId === n.id ? (
                              <>
                                <button
                                  type="button"
                                  className="ud-row-modal__note-textbtn"
                                  disabled={Boolean(savingEditNoteId)}
                                  onClick={() => cancelEditNote()}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="ud-row-modal__note-textbtn ud-row-modal__note-textbtn--primary"
                                  disabled={Boolean(savingEditNoteId) || !editDraft.trim()}
                                  onClick={() => void saveEditNote(n.id)}
                                >
                                  {savingEditNoteId === n.id ? "…" : "Save"}
                                </button>
                              </>
                            ) : (
                              <>
                                {!isAuto ? (
                                <>
                                <button
                                  type="button"
                                  className="ud-row-modal__note-toolbtn ud-row-modal__tool"
                                  title="Edit note"
                                  onClick={() => beginEditNote(n)}
                                >
                                  <Pencil size={14} strokeWidth={2.25} />
                                </button>
                                <button
                                  type="button"
                                  className="ud-row-modal__note-toolbtn ud-row-modal__note-toolbtn--danger ud-row-modal__tool"
                                  title="Delete note"
                                  onClick={() => requestDeleteNote(n)}
                                >
                                  <Trash2 size={14} strokeWidth={2.25} />
                                </button>
                                </>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {editingNoteId === n.id ? (
                        <textarea
                          className="ud-row-modal__note-edit-input"
                          rows={3}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          maxLength={4000}
                          aria-label="Edit note"
                        />
                      ) : (
                        <p className="ud-row-modal__note-body">{n.body}</p>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      {deleteConfirmNote ? (
        <div
          className="ud-row-modal-confirm-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteConfirmNote(null);
          }}
        >
          <div
            className="ud-row-modal-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ud-del-note-title"
            aria-describedby="ud-del-note-desc"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="ud-del-note-title" className="ud-row-modal-confirm__title">
              Delete this note?
            </h3>
            <p id="ud-del-note-desc" className="ud-row-modal-confirm__desc text-muted">
              This action cannot be undone.
            </p>
            <blockquote className="ud-row-modal-confirm__preview">
              {(deleteConfirmNote.body || "").trim().slice(0, 200)}
              {(deleteConfirmNote.body || "").length > 200 ? "…" : ""}
            </blockquote>
            <div className="ud-row-modal-confirm__actions">
              <button type="button" className="btn btn-ghost" disabled={deleteBusy} onClick={() => setDeleteConfirmNote(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary ud-row-modal-confirm__delete"
                disabled={deleteBusy}
                onClick={() => void performDeleteNote(deleteConfirmNote)}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
