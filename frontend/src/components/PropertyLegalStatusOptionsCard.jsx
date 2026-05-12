import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { api } from "../api/apiClient";

/**
 * Admin → Settings card to manage reusable legal-status preset lists.
 * Each property selects one preset through Properties.ListName.
 *
 * Rename and delete actions open frontend modals (no native browser confirms).
 */
function DialogShell({ titleId, title, onClose, onSubmit, children, submitLabel, submitDisabled, busy, variant = "primary" }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={variant === "danger" ? "btn btn-danger" : "btn btn-primary"}
            onClick={onSubmit}
            disabled={busy || submitDisabled}
          >
            {busy ? "…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PropertyLegalStatusOptionsCard({ onListsChanged }) {
  const [lists, setLists] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [options, setOptions] = useState([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [error, setError] = useState("");

  const [newListName, setNewListName] = useState("");
  const [addingList, setAddingList] = useState(false);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  /** Modal state: { kind: "rename-list" | "delete-list" | "rename-opt" | "delete-opt", target, value }. */
  const [dialog, setDialog] = useState(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    setError("");
    try {
      const data = await api.getAdminLegalStatusPresetLists();
      const next = Array.isArray(data.lists) ? data.lists : [];
      setLists(next);
      setSelectedId((cur) => {
        if (next.some((x) => String(x.id) === String(cur))) return cur;
        return next[0]?.id ? String(next[0].id) : "";
      });
      onListsChanged?.();
    } catch (e) {
      setError(e.message || "Failed to load preset lists");
    } finally {
      setLoadingLists(false);
    }
  }, [onListsChanged]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const loadOptions = useCallback(async () => {
    if (!selectedId) {
      setOptions([]);
      return;
    }
    setLoadingOpts(true);
    setError("");
    try {
      const data = await api.getAdminLegalStatusPresetOptions(Number(selectedId));
      setOptions(Array.isArray(data.options) ? data.options : []);
    } catch (e) {
      setError(e.message || "Failed to load options");
    } finally {
      setLoadingOpts(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const selectedListName = useMemo(() => {
    if (!selectedId) return "";
    const p = lists.find((x) => String(x.id) === String(selectedId));
    return p?.name || "";
  }, [lists, selectedId]);

  async function addList() {
    const value = newListName.trim();
    if (!value) return;
    setAddingList(true);
    setError("");
    try {
      const data = await api.postAdminLegalStatusPresetList(value);
      setNewListName("");
      await loadLists();
      const id = data?.list?.id;
      if (id) setSelectedId(String(id));
    } catch (e) {
      setError(e.message || "Could not add list");
    } finally {
      setAddingList(false);
    }
  }

  async function addOption() {
    const value = draft.trim();
    if (!value || !selectedId) return;
    setAdding(true);
    setError("");
    try {
      const next = Math.max(0, ...options.map((o) => Number(o.sortOrder) || 0)) + 10;
      await api.postAdminLegalStatusPresetOption(Number(selectedId), {
        status: value,
        sortOrder: next
      });
      setDraft("");
      await Promise.all([loadOptions(), loadLists()]);
    } catch (e) {
      setError(e.message || "Could not add status");
    } finally {
      setAdding(false);
    }
  }

  function openDialog(next) {
    setError("");
    setDialog(next);
  }

  function closeDialog() {
    if (dialogBusy) return;
    setDialog(null);
  }

  async function confirmDialog() {
    if (!dialog) return;
    setDialogBusy(true);
    setError("");
    try {
      if (dialog.kind === "rename-list") {
        const value = String(dialog.value || "").trim();
        if (!value) throw new Error("Name is required");
        await api.putAdminLegalStatusPresetList(dialog.target.id, { name: value });
        await loadLists();
      } else if (dialog.kind === "delete-list") {
        await api.deleteAdminLegalStatusPresetList(dialog.target.id);
        await loadLists();
      } else if (dialog.kind === "rename-opt") {
        const value = String(dialog.value || "").trim();
        if (!value) throw new Error("Status is required");
        await api.putAdminLegalStatusPresetOption(Number(selectedId), dialog.target.id, { status: value });
        await loadOptions();
      } else if (dialog.kind === "delete-opt") {
        await api.deleteAdminLegalStatusPresetOption(Number(selectedId), dialog.target.id);
        await Promise.all([loadOptions(), loadLists()]);
      }
      setDialog(null);
    } catch (e) {
      setError(e.message || "Operation failed");
    } finally {
      setDialogBusy(false);
    }
  }

  return (
    <section className="settings-panel-card settings-card-full prop-legal-options">
      <h2 className="settings-panel-title">
        <Scale size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: "0.4rem" }} />
        Legal status preset lists
      </h2>
      <p className="settings-panel-desc">
        Build reusable status lists here. Then select which list a property should load from
        Admin → Structure → Edit property.
      </p>

      <div className="settings-field-group">
        <div className="field">
          <label htmlFor="prop-legal-list-add">Add new preset list</label>
          <div className="prop-legal-options__add-row">
            <input
              id="prop-legal-list-add"
              type="text"
              placeholder="e.g. Eviction workflow"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              disabled={addingList}
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addList();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!newListName.trim() || addingList}
              onClick={() => void addList()}
            >
              <Plus size={16} strokeWidth={2.4} />
              {addingList ? "Adding…" : "Add list"}
            </button>
          </div>
        </div>
      </div>

      <div className="prop-legal-options__layout">
        <div className="prop-legal-options__col prop-legal-options__col--lists">
          <h3 className="prop-legal-options__subhead">Preset lists</h3>
          {loadingLists ? (
            <p className="text-muted">Loading…</p>
          ) : lists.length === 0 ? (
            <p className="text-muted">No preset lists yet.</p>
          ) : (
            <ul className="prop-legal-options__items">
              {lists.map((l) => {
                const active = String(selectedId) === String(l.id);
                return (
                  <li key={l.id} className={`prop-legal-options__item${active ? " is-active" : ""}`}>
                    <button
                      type="button"
                      className={`prop-legal-options__list-pick${active ? " is-active" : ""}`}
                      onClick={() => setSelectedId(String(l.id))}
                    >
                      <span className="prop-legal-options__item-name">{l.name}</span>
                      <span className="prop-legal-options__item-count">{l.optionCount || 0} statuses</span>
                    </button>
                    <div className="prop-legal-options__item-actions">
                      <button
                        type="button"
                        className="btn-icon prop-legal-options__icon"
                        title="Rename"
                        aria-label={`Rename ${l.name}`}
                        onClick={() => openDialog({ kind: "rename-list", target: l, value: l.name })}
                      >
                        <Pencil size={14} strokeWidth={2.25} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon prop-legal-options__icon prop-legal-options__icon--danger"
                        title="Delete"
                        aria-label={`Delete ${l.name}`}
                        onClick={() => openDialog({ kind: "delete-list", target: l })}
                      >
                        <Trash2 size={14} strokeWidth={2.25} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="prop-legal-options__col prop-legal-options__col--options">
          <h3 className="prop-legal-options__subhead">
            Statuses in {selectedListName || <em className="text-muted">— select a list —</em>}
          </h3>

          <div className="prop-legal-options__add-row">
            <input
              id="prop-legal-opt-add"
              type="text"
              placeholder="e.g. Filed for eviction"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!selectedId || adding}
              maxLength={200}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addOption();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!selectedId || !draft.trim() || adding}
              onClick={() => void addOption()}
            >
              <Plus size={16} strokeWidth={2.4} />
              {adding ? "Adding…" : "Add status"}
            </button>
          </div>

          <div className="prop-legal-options__list">
            {loadingOpts ? (
              <p className="text-muted">Loading…</p>
            ) : !selectedId ? (
              <p className="text-muted">Select a preset list to manage its statuses.</p>
            ) : options.length === 0 ? (
              <p className="text-muted">No statuses configured yet for {selectedListName}.</p>
            ) : (
              <ul className="prop-legal-options__items">
                {options.map((o) => (
                  <li key={o.id} className="prop-legal-options__item">
                    <span className="prop-legal-options__item-name">{o.status}</span>
                    <div className="prop-legal-options__item-actions">
                      <button
                        type="button"
                        className="btn-icon prop-legal-options__icon"
                        title="Rename"
                        aria-label={`Rename ${o.status}`}
                        onClick={() => openDialog({ kind: "rename-opt", target: o, value: o.status })}
                      >
                        <Pencil size={14} strokeWidth={2.25} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon prop-legal-options__icon prop-legal-options__icon--danger"
                        title="Delete"
                        aria-label={`Delete ${o.status}`}
                        onClick={() => openDialog({ kind: "delete-opt", target: o })}
                      >
                        <Trash2 size={14} strokeWidth={2.25} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <p className="prop-legal-options__err" role="alert">
          {error}
        </p>
      ) : null}

      {dialog?.kind === "rename-list" ? (
        <DialogShell
          titleId="rename-list-title"
          title={`Rename "${dialog.target.name}"`}
          onClose={closeDialog}
          onSubmit={confirmDialog}
          submitLabel="Save"
          submitDisabled={!String(dialog.value || "").trim()}
          busy={dialogBusy}
        >
          <div className="field">
            <label htmlFor="rename-list-input">List name</label>
            <input
              id="rename-list-input"
              type="text"
              value={dialog.value ?? ""}
              onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
              maxLength={100}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmDialog();
              }}
            />
          </div>
        </DialogShell>
      ) : null}

      {dialog?.kind === "rename-opt" ? (
        <DialogShell
          titleId="rename-opt-title"
          title={`Rename "${dialog.target.status}"`}
          onClose={closeDialog}
          onSubmit={confirmDialog}
          submitLabel="Save"
          submitDisabled={!String(dialog.value || "").trim()}
          busy={dialogBusy}
        >
          <div className="field">
            <label htmlFor="rename-opt-input">Status</label>
            <input
              id="rename-opt-input"
              type="text"
              value={dialog.value ?? ""}
              onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
              maxLength={200}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmDialog();
              }}
            />
          </div>
        </DialogShell>
      ) : null}

      {dialog?.kind === "delete-list" ? (
        <DialogShell
          titleId="del-list-title"
          title="Delete preset list?"
          onClose={closeDialog}
          onSubmit={confirmDialog}
          submitLabel="Delete"
          variant="danger"
          busy={dialogBusy}
        >
          <p className="prop-legal-options__dlg-text">
            Delete the preset list <strong>{dialog.target.name}</strong>?
          </p>
          <p className="prop-legal-options__dlg-text text-muted">
            If any property is currently using this list, the delete will be blocked. Switch those properties to
            a different list first.
          </p>
        </DialogShell>
      ) : null}

      {dialog?.kind === "delete-opt" ? (
        <DialogShell
          titleId="del-opt-title"
          title="Delete legal status?"
          onClose={closeDialog}
          onSubmit={confirmDialog}
          submitLabel="Delete"
          variant="danger"
          busy={dialogBusy}
        >
          <p className="prop-legal-options__dlg-text">
            Delete <strong>{dialog.target.status}</strong> from <strong>{selectedListName}</strong>?
          </p>
        </DialogShell>
      ) : null}
    </section>
  );
}
