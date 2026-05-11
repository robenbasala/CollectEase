import { useCallback, useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { api } from "../api/apiClient";
import AdminPanel from "../components/AdminPanel";
import Spinner from "../components/Spinner";

function Modal({ title, children, onClose, onSave, saveLabel = "Save" }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ pending, onCancel, onConfirm, deleting }) {
  if (!pending) return null;
  const name = pending.item?.name?.trim() ? pending.item.name : "(unnamed)";

  return (
    <div className="modal-backdrop modal-backdrop-delete-glass" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal modal-confirm-delete modal-confirm-delete-glass"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
      >
        <div className="delete-confirm-glass-inner">
          <p id="delete-confirm-title" className="delete-confirm-q">
            Are you sure you want to delete this item?
          </p>
          <p className="delete-confirm-name">{name}</p>
          <div className="modal-actions delete-confirm-actions">
            <button type="button" className="btn btn-delete-no" onClick={onCancel} disabled={deleting}>
              <X size={18} strokeWidth={2} aria-hidden />
              No
            </button>
            <button type="button" className="btn btn-delete-yes" onClick={onConfirm} disabled={deleting}>
              <Trash2 size={18} strokeWidth={2} aria-hidden />
              {deleting ? "Deleting…" : "Yes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [regions, setRegions] = useState([]);
  const [portfolios, setPortfolios] = useState([]);
  const [properties, setProperties] = useState([]);

  const [regionId, setRegionId] = useState(null);
  const [portfolioId, setPortfolioId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [modal, setModal] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [formName, setFormName] = useState("");
  const [formListName, setFormListName] = useState("");
  const [formRegionId, setFormRegionId] = useState(null);
  const [formPortfolioId, setFormPortfolioId] = useState(null);

  const loadRegions = useCallback(async () => {
    const data = await api.getAdminRegions();
    setRegions(data.regions || []);
  }, []);

  const loadPortfolios = useCallback(async (rid) => {
    const data = await api.getAdminPortfolios(rid);
    setPortfolios(data.portfolios || []);
  }, []);

  const loadProperties = useCallback(async (pid) => {
    const data = await api.getAdminProperties(pid);
    setProperties(data.properties || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        await loadRegions();
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load admin data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRegions]);

  useEffect(() => {
    if (!regionId) {
      setPortfolios([]);
      setPortfolioId(null);
      setProperties([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadPortfolios(regionId);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load portfolios");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [regionId, loadPortfolios]);

  useEffect(() => {
    if (!portfolioId) {
      setProperties([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadProperties(portfolioId);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load properties");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portfolioId, loadProperties]);

  function openRegionModal(mode, item) {
    setFormName(item?.name || "");
    setModal({ type: "region", mode, item });
  }

  function openPortfolioModal(mode, item) {
    if (!regionId && mode === "create") return;
    setFormName(item?.name || "");
    setFormRegionId(item?.regionId ?? regionId);
    setModal({ type: "portfolio", mode, item });
  }

  function openPropertyModal(mode, item) {
    if (!portfolioId && mode === "create") return;
    setFormName(item?.name || "");
    setFormListName(item?.listName ?? "");
    setFormPortfolioId(item?.portfolioId ?? portfolioId);
    setModal({ type: "property", mode, item });
  }

  async function saveModal() {
    try {
      if (modal.type === "region") {
        if (modal.mode === "create") await api.postAdminRegion(formName);
        else await api.putAdminRegion(modal.item.id, formName);
        await loadRegions();
      }
      if (modal.type === "portfolio") {
        const rid = formRegionId;
        if (modal.mode === "create") await api.postAdminPortfolio(rid, formName);
        else await api.putAdminPortfolio(modal.item.id, { name: formName, regionId: rid });
        if (regionId) await loadPortfolios(regionId);
      }
      if (modal.type === "property") {
        const pid = formPortfolioId;
        if (modal.mode === "create") await api.postAdminProperty(pid, formName, formListName || null);
        else
          await api.putAdminProperty(modal.item.id, {
            name: formName,
            listName: formListName || null,
            portfolioId: pid
          });
        if (portfolioId) await loadProperties(portfolioId);
      }
      setModal(null);
    } catch (e) {
      setError(e.message || "Save failed");
    }
  }

  function askDelete(type, item) {
    setPendingDelete({ type, item });
  }

  async function executeDelete() {
    if (!pendingDelete) return;
    const { type, item } = pendingDelete;
    setDeleteLoading(true);
    setError("");
    try {
      if (type === "region") {
        await api.deleteAdminRegion(item.id);
        if (regionId === item.id) {
          setRegionId(null);
          setPortfolioId(null);
        }
        await loadRegions();
      }
      if (type === "portfolio") {
        await api.deleteAdminPortfolio(item.id);
        if (portfolioId === item.id) {
          setPortfolioId(null);
        }
        if (regionId) await loadPortfolios(regionId);
      }
      if (type === "property") {
        await api.deleteAdminProperty(item.id);
        if (portfolioId) await loadProperties(portfolioId);
      }
      setPendingDelete(null);
    } catch (e) {
      setPendingDelete(null);
      setError(e.message || "Delete failed");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Admin</h1>
      <p className="page-sub">Manage Regions, Portfolios, and Properties (SQL Server admin tables).</p>

      {loading && <Spinner />}
      {error && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1rem", color: "var(--color-danger)" }}>
          {error}
        </div>
      )}

      {!loading && (
        <div className="admin-grid">
          <AdminPanel
            title="Regions"
            items={regions}
            selectedId={regionId}
            onSelect={setRegionId}
            onAdd={() => openRegionModal("create")}
            onEdit={(item) => openRegionModal("edit", item)}
            onDelete={(item) => askDelete("region", item)}
            emptyText="No regions yet. Add one to get started."
          />
          <AdminPanel
            title="Portfolios"
            items={portfolios}
            selectedId={portfolioId}
            onSelect={setPortfolioId}
            onAdd={() => openPortfolioModal("create")}
            onEdit={(item) => openPortfolioModal("edit", item)}
            onDelete={(item) => askDelete("portfolio", item)}
            emptyText={regionId ? "No portfolios for this region." : "Select a region first."}
            disabled={!regionId}
          />
          <AdminPanel
            title="Properties"
            items={properties}
            selectedId={null}
            onSelect={() => {}}
            onAdd={() => openPropertyModal("create")}
            onEdit={(item) => openPropertyModal("edit", item)}
            onDelete={(item) => askDelete("property", item)}
            emptyText={portfolioId ? "No properties for this portfolio." : "Select a portfolio first."}
            disabled={!portfolioId}
          />
        </div>
      )}

      {modal?.type === "region" && (
        <Modal
          title={modal.mode === "create" ? "Add region" : "Edit region"}
          onClose={() => setModal(null)}
          onSave={saveModal}
        >
          <div className="field">
            <label htmlFor="rn">Name</label>
            <input id="rn" value={formName} onChange={(e) => setFormName(e.target.value)} />
          </div>
        </Modal>
      )}

      {modal?.type === "portfolio" && (
        <Modal
          title={modal.mode === "create" ? "Add portfolio" : "Edit portfolio"}
          onClose={() => setModal(null)}
          onSave={saveModal}
        >
          <div className="field">
            <label htmlFor="pr">Region</label>
            <select
              id="pr"
              value={formRegionId ?? ""}
              onChange={(e) => setFormRegionId(Number(e.target.value))}
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pn">Name</label>
            <input id="pn" value={formName} onChange={(e) => setFormName(e.target.value)} />
          </div>
        </Modal>
      )}

      {modal?.type === "property" && (
        <Modal
          title={modal.mode === "create" ? "Add property" : "Edit property"}
          onClose={() => setModal(null)}
          onSave={saveModal}
        >
          <div className="field">
            <label htmlFor="pp">Portfolio</label>
            <select
              id="pp"
              value={formPortfolioId ?? ""}
              onChange={(e) => setFormPortfolioId(Number(e.target.value))}
            >
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pfn">Name</label>
            <input id="pfn" value={formName} onChange={(e) => setFormName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pln">List name (optional)</label>
            <input id="pln" value={formListName} onChange={(e) => setFormListName(e.target.value)} />
          </div>
        </Modal>
      )}

      <DeleteConfirmModal
        pending={pendingDelete}
        onCancel={() => !deleteLoading && setPendingDelete(null)}
        onConfirm={executeDelete}
        deleting={deleteLoading}
      />
    </div>
  );
}
