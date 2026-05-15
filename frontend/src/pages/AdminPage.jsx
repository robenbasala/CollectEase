import { useCallback, useEffect, useState } from "react";
import { Building2, FolderKanban, GitBranch, LayoutGrid, MapPinned, Users } from "lucide-react";
import { Trash2, X } from "lucide-react";
import { api } from "../api/apiClient";
import CompanyDataflowsPanel from "../components/CompanyDataflowsPanel";
import AdminUsersPanel from "../components/AdminUsersPanel";
import PageHeader from "../components/PageHeader";
import PropertyLegalStatusOptionsCard from "../components/PropertyLegalStatusOptionsCard";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext.jsx";

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
  const { user, isSuperAdmin, effectiveCompanyId, canOpenAdmin, setEffectiveCompanyId } = useAuth();
  const workspaceCompanyId = isSuperAdmin ? effectiveCompanyId ?? user?.companyId ?? null : user?.companyId ?? null;

  const [activeTab, setActiveTab] = useState(() =>
    isSuperAdmin ? "companies" : canOpenAdmin ? "users" : "structure"
  );

  useEffect(() => {
    setActiveTab((prev) => {
      if (!isSuperAdmin && prev === "companies") return "users";
      if (!canOpenAdmin && (prev === "users" || prev === "dataflows")) return "structure";
      return prev;
    });
  }, [isSuperAdmin, canOpenAdmin]);

  const [companies, setCompanies] = useState([]);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [createCompanyBusy, setCreateCompanyBusy] = useState(false);
  const [createCompanyMsg, setCreateCompanyMsg] = useState("");

  const [regions, setRegions] = useState([]);
  const [portfolios, setPortfolios] = useState([]);
  const [properties, setProperties] = useState([]);
  const [propertyListNames, setPropertyListNames] = useState([]);

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

  const loadPropertyListNames = useCallback(async () => {
    const data = await api.getAdminPropertyListNames();
    setPropertyListNames(data.listNames || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        await Promise.all([loadRegions(), loadPropertyListNames()]);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load admin data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRegions, loadPropertyListNames]);

  useEffect(() => {
    if (!isSuperAdmin) {
      setCompanies([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.listCompanies();
        if (!cancelled) setCompanies(data.companies || []);
      } catch {
        if (!cancelled) setCompanies([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  async function createCompany() {
    const name = newCompanyName.trim();
    if (!name) {
      setCreateCompanyMsg("Enter a company name");
      return;
    }
    setCreateCompanyBusy(true);
    setCreateCompanyMsg("");
    try {
      await api.postCompany(name);
      setNewCompanyName("");
      const data = await api.listCompanies();
      setCompanies(data.companies || []);
      setCreateCompanyMsg("Company created.");
    } catch (e) {
      setCreateCompanyMsg(e.message || "Failed to create company");
    } finally {
      setCreateCompanyBusy(false);
    }
  }

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
      <PageHeader
        title="Admin"
        subtitle="Companies, users, legal status lists, and geographic structure for your workspace."
        backTo="/"
      />

      <div className="admin-page-tabs" role="tablist" aria-label="Admin sections">
        {isSuperAdmin ? (
          <button
            type="button"
            role="tab"
            id="admin-tab-companies"
            aria-selected={activeTab === "companies"}
            className={`admin-page-tab${activeTab === "companies" ? " admin-page-tab--active" : ""}`}
            onClick={() => setActiveTab("companies")}
          >
            Companies
          </button>
        ) : null}
        {canOpenAdmin ? (
          <button
            type="button"
            role="tab"
            id="admin-tab-users"
            aria-selected={activeTab === "users"}
            className={`admin-page-tab${activeTab === "users" ? " admin-page-tab--active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            Users &amp; invite
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          id="admin-tab-structure"
          aria-selected={activeTab === "structure"}
          className={`admin-page-tab${activeTab === "structure" ? " admin-page-tab--active" : ""}`}
          onClick={() => setActiveTab("structure")}
        >
          Regions, portfolios &amp; properties
        </button>
        <button
          type="button"
          role="tab"
          id="admin-tab-legal"
          aria-selected={activeTab === "legal"}
          className={`admin-page-tab${activeTab === "legal" ? " admin-page-tab--active" : ""}`}
          onClick={() => setActiveTab("legal")}
        >
          Legal status lists
        </button>
        {canOpenAdmin ? (
          <button
            type="button"
            role="tab"
            id="admin-tab-dataflows"
            aria-selected={activeTab === "dataflows"}
            className={`admin-page-tab${activeTab === "dataflows" ? " admin-page-tab--active" : ""}`}
            onClick={() => setActiveTab("dataflows")}
          >
            <GitBranch size={14} style={{ marginRight: "0.25rem", verticalAlign: "-0.1em" }} aria-hidden />
            Dataflows
          </button>
        ) : null}
      </div>

      {activeTab === "companies" && isSuperAdmin ? (
        <div
          className="admin-page-panel"
          role="tabpanel"
          aria-labelledby="admin-tab-companies"
          id="admin-panel-companies"
        >
          <div className="card" style={{ padding: "1rem", marginBottom: "1.25rem" }}>
            <h2 className="page-title" style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              Companies
            </h2>
            <p className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "0.9rem" }}>
              Create a company, then choose it in the navbar to manage regions and invite users for that tenant.
            </p>
            <div className="field" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 12rem" }}>
                <label htmlFor="new-co">New company name</label>
                <input
                  id="new-co"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="e.g. Acme HOA"
                />
              </div>
              <button type="button" className="btn btn-primary" disabled={createCompanyBusy} onClick={() => void createCompany()}>
                {createCompanyBusy ? "Creating…" : "Create company"}
              </button>
            </div>
            {createCompanyMsg ? (
              <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
                {createCompanyMsg}
              </p>
            ) : null}
          </div>

          <div className="card" style={{ padding: "1rem" }}>
            <h3 className="page-title" style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>
              All companies
            </h3>
            <p className="text-muted admin-company-gallery-hint">
              Click a card to set that company as your workspace (same as the company selector in the navbar).
            </p>
            {companies.length === 0 ? (
              <p className="text-muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                No companies loaded yet.
              </p>
            ) : (
              <div className="admin-company-gallery" role="list">
                {companies.map((c) => {
                  const navCompanyId = effectiveCompanyId ?? user?.companyId ?? null;
                  const selected =
                    isSuperAdmin && navCompanyId != null && Number(navCompanyId) === Number(c.id);
                  const uc = Number(c.userCount ?? 0);
                  const rc = Number(c.regionCount ?? 0);
                  const pc = Number(c.portfolioCount ?? 0);
                  const prc = Number(c.propertyCount ?? 0);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="listitem"
                      className={`admin-company-card${selected ? " admin-company-card--selected" : ""}`}
                      onClick={() => setEffectiveCompanyId(Number(c.id))}
                      title="Set as workspace company in the navbar"
                    >
                      <span className="admin-company-card__icon" aria-hidden>
                        <Building2 size={26} strokeWidth={2} />
                      </span>
                      <span className="admin-company-card__name">{c.name}</span>
                      <dl className="admin-company-card__stats">
                        <div className="admin-company-card__stat">
                          <dt>
                            <Users size={15} strokeWidth={2} aria-hidden />
                            <span>Users</span>
                          </dt>
                          <dd>{uc}</dd>
                        </div>
                        <div className="admin-company-card__stat">
                          <dt>
                            <MapPinned size={15} strokeWidth={2} aria-hidden />
                            <span>Regions</span>
                          </dt>
                          <dd>{rc}</dd>
                        </div>
                        <div className="admin-company-card__stat">
                          <dt>
                            <FolderKanban size={15} strokeWidth={2} aria-hidden />
                            <span>Portfolios</span>
                          </dt>
                          <dd>{pc}</dd>
                        </div>
                        <div className="admin-company-card__stat">
                          <dt>
                            <LayoutGrid size={15} strokeWidth={2} aria-hidden />
                            <span>Properties</span>
                          </dt>
                          <dd>{prc}</dd>
                        </div>
                      </dl>
                      {selected ? <span className="admin-company-card__badge">Current workspace</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "users" && canOpenAdmin ? (
        <div className="admin-page-panel" role="tabpanel" aria-labelledby="admin-tab-users" id="admin-panel-users">
          {workspaceCompanyId == null && isSuperAdmin ? (
            <div className="card" style={{ padding: "1rem", marginBottom: "1rem", color: "var(--color-danger)" }}>
              Select a workspace company in the navbar to load regions and manage users for that company.
            </div>
          ) : null}
          {workspaceCompanyId != null ? (
            <AdminUsersPanel
              isSuperAdmin={isSuperAdmin}
              workspaceCompanyId={workspaceCompanyId}
              companies={companies}
            />
          ) : !isSuperAdmin ? (
            <div className="card" style={{ padding: "1rem" }}>
              <p className="text-muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                Your account has no company assigned. Ask a super administrator to link your profile to a company.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "structure" ? (
        <div className="admin-page-panel" role="tabpanel" aria-labelledby="admin-tab-structure" id="admin-panel-structure">
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
        </div>
      ) : null}

      {activeTab === "legal" ? (
        <div
          className="admin-page-panel"
          role="tabpanel"
          aria-labelledby="admin-tab-legal"
          id="admin-panel-legal"
        >
          <PropertyLegalStatusOptionsCard onListsChanged={loadPropertyListNames} />
        </div>
      ) : null}

      {activeTab === "dataflows" && canOpenAdmin ? (
        <CompanyDataflowsPanel
          workspaceCompanyId={workspaceCompanyId}
          companies={companies}
          isSuperAdmin={isSuperAdmin}
        />
      ) : null}

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
            <label htmlFor="pln">Legal status preset list</label>
            <select id="pln" value={formListName} onChange={(e) => setFormListName(e.target.value)}>
              <option value="">— Default —</option>
              {propertyListNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
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
