import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Columns3, X } from "lucide-react";
import { api } from "../api/apiClient";
import { normalizeUnitDetailColumnPrefs } from "../constants/unitDetailColumns.js";
import { getActiveCompanyId } from "../config/company.js";
import Spinner from "../components/Spinner";
import UnitDetailsTable from "../components/UnitDetailsTable";
import UnitDetailColumnPrefsModal from "../components/UnitDetailColumnPrefsModal";
import PropertyMultiSelect from "../components/PropertyMultiSelect";

const ALERT_KEYS = new Set([
  "missingFollowUp",
  "pastDueFollowUp",
  "dueTodayFollowUp",
  "requiresLegal",
  "removeLegal"
]);
const DELINQ_KEYS = new Set([
  "zeroBalance",
  "lessThanOneMonth",
  "oneToUnderThreeMonths",
  "threePlusMonths",
  "inLegal"
]);

const SLICE_KEYS = ["collection", "alert", "delinq", "occupied"];

function buildEmailPreviewContextFromSettings(s) {
  const cd = s?.companyDisplayName != null ? String(s.companyDisplayName).trim() : "";
  const parts = cd.split(/\s+/).filter(Boolean);
  return {
    companyDisplayName: cd,
    senderName: parts[0] || "Team",
    replyEmail: String(import.meta.env.VITE_AR_CONTACT_EMAIL ?? "").trim(),
    senderPhone: String(import.meta.env.VITE_AR_CONTACT_PHONE ?? "").trim()
  };
}

const SLICE_CHIP_LABELS = {
  occupied: "Slice: Occupied",
  lt1: "Slice: < 1 mo vs rent",
  ge1: "Slice: ≥ 1 mo vs rent",
  missingFollowUp: "Slice: Missing follow up",
  pastDueFollowUp: "Slice: Past due follow up",
  dueTodayFollowUp: "Slice: Due today follow up",
  requiresLegal: "Slice: Requires legal",
  removeLegal: "Slice: Remove legal",
  zeroBalance: "Slice: Zero balance",
  lessThanOneMonth: "Slice: < 1 mo delinquent",
  oneToUnderThreeMonths: "Slice: 1–<3 mo",
  threePlusMonths: "Slice: 3+ mo",
  inLegal: "Slice: In legal"
};

function dedupeOrdered(names) {
  const seen = new Set();
  return names.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

function parseLegalPresets(raw) {
  if (raw == null || !String(raw).trim()) return [];
  return String(raw)
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function PropertyDetails() {
  const { propertyName } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const region = searchParams.get("region") || "";
  const companyId = getActiveCompanyId();
  const collectionParam = searchParams.get("collection");
  const collectionRaw = collectionParam === "lt1" || collectionParam === "ge1" ? collectionParam : "";
  const alertParam = searchParams.get("alert") || "";
  const delinqParam = searchParams.get("delinq") || "";
  const occupiedParam = searchParams.get("occupied");

  const collectionFilter = collectionRaw;
  const alertFilter =
    !collectionFilter && ALERT_KEYS.has(alertParam) ? alertParam : "";
  const delinqFilter =
    !collectionFilter && !alertFilter && DELINQ_KEYS.has(delinqParam) ? delinqParam : "";
  const occupiedOnly =
    !collectionFilter &&
    !alertFilter &&
    !delinqFilter &&
    (occupiedParam === "1" || occupiedParam === "true");

  const decodedProperty = propertyName ? decodeURIComponent(propertyName) : "";

  const selectedProperties = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const fromQuery = dedupeOrdered(
      params.getAll("properties").map((p) => String(p).trim()).filter(Boolean)
    );
    if (fromQuery.length > 0) return fromQuery;
    const dec = decodedProperty.trim();
    if (dec && dec !== "_") return [dec];
    return [];
  }, [location.search, decodedProperty]);

  const pathSegment = selectedProperties[0] || "_";

  const [summary, setSummary] = useState(null);
  const [nameFilter, setNameFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [legalStatus, setLegalStatus] = useState("");
  const [units, setUnits] = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [error, setError] = useState("");
  const [propertyDropdownOpen, setPropertyDropdownOpen] = useState(false);
  const [erpStaticLink, setErpStaticLink] = useState("");
  const [unitDetailColumnPrefs, setUnitDetailColumnPrefs] = useState(() => normalizeUnitDetailColumnPrefs({}));
  const [unitDetailPrefsOpen, setUnitDetailPrefsOpen] = useState(false);
  const [emailPreviewContext, setEmailPreviewContext] = useState(() => buildEmailPreviewContextFromSettings({}));
  const [legalPresets, setLegalPresets] = useState([]);
  const [unitsRefreshTick, setUnitsRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getAdminUnitDetailColumnPrefs();
        if (!cancelled) {
          setUnitDetailColumnPrefs(
            normalizeUnitDetailColumnPrefs({
              columnOrder: data.columnOrder,
              hidden: data.hidden
            })
          );
        }
      } catch {
        if (!cancelled) setUnitDetailColumnPrefs(normalizeUnitDetailColumnPrefs({}));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getAdminCompanySettings();
        const s = data?.settings;
        if (!cancelled && s) {
          const link = s.erpStaticLink ?? s.ErpStaticLink;
          setErpStaticLink(link != null ? String(link) : "");
          setEmailPreviewContext(buildEmailPreviewContextFromSettings(s));
          setLegalPresets(parseLegalPresets(s.defaultLegalStatusList ?? s.DefaultLegalStatusList));
        }
      } catch {
        /* optional */
      }
    })();
    function onCompanySettingsUpdated(e) {
      const s = e.detail;
      if (s?.erpStaticLink !== undefined) setErpStaticLink(s.erpStaticLink ?? "");
      if (s) setEmailPreviewContext(buildEmailPreviewContextFromSettings(s));
    }
    window.addEventListener("ct:company-settings-updated", onCompanySettingsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("ct:company-settings-updated", onCompanySettingsUpdated);
    };
  }, []);

  useEffect(() => {
    if (!region) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingSummary(true);
      setError("");
      try {
        const data = await api.getDashboardSummary(region);
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load properties");
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [region]);

  const propertyOptions = useMemo(() => {
    if (!summary) return [];
    const set = new Set();
    for (const p of summary.portfolios) {
      for (const row of p.properties) {
        const n = String(row.property ?? "").trim();
        if (n) set.add(n);
      }
    }
    return [...set].sort((a, b) => String(a).localeCompare(String(b)));
  }, [summary]);

  useEffect(() => {
    if (selectedProperties.length === 0) {
      setUnits([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingUnits(true);
      setError("");
      try {
        const slice =
          collectionFilter
            ? { collection: collectionFilter }
            : alertFilter
              ? { alert: alertFilter }
              : delinqFilter
                ? { delinq: delinqFilter }
                : occupiedOnly
                  ? { occupied: true }
                  : {};
        const multi = selectedProperties.length >= 2;
        const data = await api.getDashboardUnits({
          property: multi ? undefined : selectedProperties[0],
          properties: multi ? selectedProperties : undefined,
          name: nameFilter || undefined,
          unit: unitFilter || undefined,
          legalStatus: legalStatus || undefined,
          ...slice
        });
        if (!cancelled) {
          setUnits(data.units || []);
          if ("erpStaticLink" in data && data.erpStaticLink != null && String(data.erpStaticLink).trim() !== "") {
            setErpStaticLink(String(data.erpStaticLink).trim());
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load units");
      } finally {
        if (!cancelled) setLoadingUnits(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedProperties,
    nameFilter,
    unitFilter,
    legalStatus,
    location.search,
    collectionFilter,
    alertFilter,
    delinqFilter,
    occupiedOnly,
    unitsRefreshTick
  ]);

  const legalOptions = useMemo(() => {
    const s = new Set();
    for (const u of units) {
      if (u.legalStatus) s.add(u.legalStatus);
    }
    return [...s].sort((a, b) => String(a).localeCompare(String(b)));
  }, [units]);

  const legalStatusChoices = useMemo(() => {
    const s = new Set();
    for (const x of legalPresets) {
      if (x) s.add(String(x).trim());
    }
    for (const x of legalOptions) {
      if (x) s.add(String(x).trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [legalPresets, legalOptions]);

  const unitsGroupedByProperty = useMemo(() => {
    return selectedProperties.map((p) => {
      const name = String(p).trim();
      const rows = units.filter((u) => String(u.property ?? "").trim() === name);
      const totalBalance = rows.reduce((acc, u) => {
        const n = Number(u.balance);
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0);
      return { property: name, rows, totalBalance };
    });
  }, [units, selectedProperties]);

  const dashboardSliceValue = useMemo(() => {
    if (collectionFilter === "lt1" || collectionFilter === "ge1") return collectionFilter;
    if (alertFilter) return alertFilter;
    if (delinqFilter) return delinqFilter;
    if (occupiedOnly) return "occupied";
    return "all";
  }, [collectionFilter, alertFilter, delinqFilter, occupiedOnly]);

  function applyPropertiesToQuery(q, props) {
    q.delete("properties");
    props.forEach((p) => q.append("properties", p));
  }

  function navigateWithProperties(nextProps) {
    const trimmed = dedupeOrdered(nextProps.map((p) => String(p).trim()).filter(Boolean));
    const q = new URLSearchParams(location.search);
    if (!q.has("companyId")) q.set("companyId", String(companyId));
    applyPropertiesToQuery(q, trimmed);
    const seg = trimmed[0] || "_";
    navigate(`/property/${encodeURIComponent(seg)}?${q.toString()}`, { replace: true });
  }

  function onDashboardSliceChange(next) {
    const q = new URLSearchParams(location.search);
    if (!q.has("companyId")) q.set("companyId", String(companyId));
    SLICE_KEYS.forEach((k) => q.delete(k));
    if (!next || next === "all") {
      navigate(`/property/${encodeURIComponent(pathSegment)}?${q.toString()}`, { replace: true });
      return;
    }
    if (next === "lt1" || next === "ge1") q.set("collection", next);
    else if (next === "occupied") q.set("occupied", "1");
    else if (ALERT_KEYS.has(next)) q.set("alert", next);
    else if (DELINQ_KEYS.has(next)) q.set("delinq", next);
    navigate(`/property/${encodeURIComponent(pathSegment)}?${q.toString()}`, { replace: true });
  }

  function clearSliceFromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.has("companyId")) q.set("companyId", String(companyId));
    SLICE_KEYS.forEach((k) => q.delete(k));
    navigate(`/property/${encodeURIComponent(pathSegment)}?${q.toString()}`, { replace: true });
  }

  function clearAllSearchAndSlice() {
    setNameFilter("");
    setUnitFilter("");
    setLegalStatus("");
    clearSliceFromUrl();
  }

  const hasSliceChip = dashboardSliceValue !== "all";
  const hasSearchChips = Boolean(nameFilter.trim() || unitFilter.trim() || legalStatus);
  const showClearAllButton = hasSliceChip || hasSearchChips;

  const activeFilterChips = [];
  for (const p of selectedProperties) {
    activeFilterChips.push({
      key: `prop-${p}`,
      label: p,
      aria: `Remove property ${p}`,
      onClear: () => navigateWithProperties(selectedProperties.filter((x) => x !== p))
    });
  }
  if (nameFilter.trim()) {
    activeFilterChips.push({
      key: "name",
      label: `Name: ${nameFilter.trim()}`,
      aria: "Clear name search",
      onClear: () => setNameFilter("")
    });
  }
  if (unitFilter.trim()) {
    activeFilterChips.push({
      key: "unit",
      label: `Unit: ${unitFilter.trim()}`,
      aria: "Clear unit search",
      onClear: () => setUnitFilter("")
    });
  }
  if (legalStatus) {
    activeFilterChips.push({
      key: "legal",
      label: `Legal: ${legalStatus}`,
      aria: "Clear legal filter",
      onClear: () => setLegalStatus("")
    });
  }
  if (hasSliceChip) {
    activeFilterChips.push({
      key: "slice",
      label: SLICE_CHIP_LABELS[dashboardSliceValue] || `Slice: ${dashboardSliceValue}`,
      aria: "Clear dashboard slice",
      onClear: clearSliceFromUrl
    });
  }

  return (
    <div className="page">
      <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: "0.75rem" }}>
        <ArrowLeft size={18} />
        Back
      </button>

      <h1 className="page-title">Property details</h1>

      {!region && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <span className="text-warn">Missing region in URL.</span> Open this page from the dashboard or add{" "}
          <code>?region=YourRegion</code> to the query string.
        </div>
      )}

      <div className="property-detail-stack">
        <div
          className={`card property-detail-filters-card${propertyDropdownOpen ? " property-detail-filters-card--dropdown-open" : ""}`}
        >
          <div className="filters filters--detail-toolbar">
            <div className="field field--properties">
              <label htmlFor="prop-dropdown">Property</label>
              <PropertyMultiSelect
                id="prop-dropdown"
                options={propertyOptions}
                value={selectedProperties}
                onChange={navigateWithProperties}
                onOpenChange={setPropertyDropdownOpen}
                disabled={!region || loadingSummary}
              />
            </div>
            <div className="field field--text">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Search…"
              />
            </div>
            <div className="field field--text">
              <label htmlFor="unit">Unit</label>
              <input
                id="unit"
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                placeholder="Search…"
              />
            </div>
            <div className="field field--legal">
              <label htmlFor="ls">Legal</label>
              <select id="ls" value={legalStatus} onChange={(e) => setLegalStatus(e.target.value)}>
                <option value="">All</option>
                {legalOptions.map((ls) => (
                  <option key={ls} value={ls}>
                    {ls}
                  </option>
                ))}
              </select>
            </div>
            <div className="field field--slice">
              <label htmlFor="dashSlice">Slice</label>
              <select
                id="dashSlice"
                value={dashboardSliceValue}
                onChange={(e) => onDashboardSliceChange(e.target.value)}
              >
                <option value="all">All units</option>
                <option value="occupied">Occupied</option>
                <optgroup label="Collection">
                  <option value="lt1">&lt; 1 mo vs rent</option>
                  <option value="ge1">≥ 1 mo vs rent</option>
                </optgroup>
                <optgroup label="Alerts">
                  <option value="missingFollowUp">Missing FU</option>
                  <option value="pastDueFollowUp">Past due FU</option>
                  <option value="dueTodayFollowUp">Due today FU</option>
                  <option value="requiresLegal">Requires legal</option>
                  <option value="removeLegal">Remove legal</option>
                </optgroup>
                <optgroup label="Delinquent">
                  <option value="zeroBalance">Zero balance</option>
                  <option value="lessThanOneMonth">&lt; 1 mo</option>
                  <option value="oneToUnderThreeMonths">1–&lt;3 mo</option>
                  <option value="threePlusMonths">3+ mo</option>
                  <option value="inLegal">In legal</option>
                </optgroup>
              </select>
            </div>
          </div>

          {activeFilterChips.length > 0 && (
            <div className="property-detail-active-filters">
              <span className="property-detail-active-label">Active</span>
              {activeFilterChips.map((c) => (
                <span key={c.key} className="filter-active-chip">
                  <span className="filter-active-chip-text" title={c.label}>
                    {c.label}
                  </span>
                  <button
                    type="button"
                    className="filter-active-chip-clear"
                    aria-label={c.aria}
                    onClick={c.onClear}
                  >
                    <X size={14} strokeWidth={2.25} />
                  </button>
                </span>
              ))}
              {showClearAllButton ? (
                <button type="button" className="property-detail-clear-all" onClick={clearAllSearchAndSlice}>
                  Clear search & slice
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className="card property-detail-units-card">
          {region && !loadingSummary && selectedProperties.length === 0 && (
            <div className="unit-details-rowcount" role="status">
              <span className="text-muted">Select one or more properties to load units.</span>
            </div>
          )}

          <div className="card-body" style={{ padding: 0 }}>
            {loadingSummary ? (
              <Spinner />
            ) : selectedProperties.length === 0 ? null : loadingUnits ? (
              <Spinner />
            ) : (
              <div className="property-detail-units-stack">
                <div className="unit-detail-table-toolbar unit-detail-table-toolbar--stack">
                  <button
                    type="button"
                    className="unit-detail-columns-btn"
                    onClick={() => setUnitDetailPrefsOpen(true)}
                    title="Choose which columns to show and their order"
                  >
                    <span className="unit-detail-columns-btn__icon" aria-hidden>
                      <Columns3 size={17} strokeWidth={2.25} />
                    </span>
                    <span className="unit-detail-columns-btn__text">Columns</span>
                  </button>
                </div>
                <UnitDetailColumnPrefsModal
                  open={unitDetailPrefsOpen}
                  companyId={companyId}
                  initialPrefs={unitDetailColumnPrefs}
                  onClose={() => setUnitDetailPrefsOpen(false)}
                  onSaved={(next) => {
                    setUnitDetailColumnPrefs(
                      normalizeUnitDetailColumnPrefs({
                        columnOrder: next.columnOrder,
                        hidden: next.hidden
                      })
                    );
                    setUnitDetailPrefsOpen(false);
                  }}
                />
                {unitsGroupedByProperty.map((g) => (
                  <section key={g.property} className="property-detail-unit-block">
                    <UnitDetailsTable
                      units={g.rows}
                      erpStaticLink={erpStaticLink}
                      companyId={companyId}
                      columnPrefs={unitDetailColumnPrefs}
                      onColumnPrefsSaved={setUnitDetailColumnPrefs}
                      showColumnsControl={false}
                      blockCaption={{ propertyName: g.property, totalBalance: g.totalBalance }}
                      emailPreviewContext={emailPreviewContext}
                      legalStatusChoices={legalStatusChoices}
                      onUnitsRefresh={() => setUnitsRefreshTick((x) => x + 1)}
                    />
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: "1rem", color: "var(--color-danger)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
