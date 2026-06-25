import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, AlertTriangle, Users } from "lucide-react";
import { getActiveCompanyId } from "../config/company.js";

/**
 * @param {object} [slice]
 * @param {"lt1"|"ge1"} [slice.collection]
 * @param {"missingTenantFollowUp"|"pastDueTenantFollowUp"|"pastDueFollowUp"|"dueTodayFollowUp"|"requiresLegal"|"removeLegal"} [slice.alert]
 * @param {"zeroBalance"|"lessThanOneMonth"|"oneToUnderThreeMonths"|"threePlusMonths"|"inLegal"} [slice.delinq]
 * @param {boolean} [slice.occupied]
 */
function buildPropertyUrl(region, propertyName, slice = {}) {
  const q = new URLSearchParams({ region });
  q.set("companyId", String(getActiveCompanyId()));
  if (slice.collection === "lt1" || slice.collection === "ge1") q.set("collection", slice.collection);
  if (slice.alert) q.set("alert", slice.alert);
  if (slice.delinq) q.set("delinq", slice.delinq);
  if (slice.occupied) q.set("occupied", "1");
  return `/property/${encodeURIComponent(propertyName)}?${q.toString()}`;
}

function formatCollectionPercent(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n));
}

function CollectionSplitCell({ percent, count, variant, onNavigate }) {
  const cls = variant === "lt1" ? "collection-split collection-split--lt1" : "collection-split collection-split--ge1";
  return (
    <button
      type="button"
      className={`collection-split-btn ${cls}`}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate();
      }}
    >
      <span className="collection-split-pct">{formatCollectionPercent(percent)}%</span>
      <span className="collection-split-count">{count}</span>
    </button>
  );
}

function StackedAlertHeader({ subject, middle, label }) {
  return (
    <span className="th-alerts-sub-label">
      <span className="th-alerts-sub-label__subject">{subject}</span>
      {middle ? <span className="th-alerts-sub-label__middle">{middle}</span> : null}
      <span className="th-alerts-sub-label__detail">{label}</span>
    </span>
  );
}

function DashboardCellButton({ children, onNavigate, title, align = "center", className = "" }) {
  const start = align === "start" ? "dashboard-table-cell-btn--start" : "";
  return (
    <button
      type="button"
      className={["dashboard-table-cell-btn", start, className].filter(Boolean).join(" ")}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate();
      }}
    >
      {children}
    </button>
  );
}

export default function PortfolioSummaryCard({ region, portfolio }) {
  const navigate = useNavigate();
  const cardRef = useRef(null);
  const headRef = useRef(null);
  const theadRef = useRef(null);

  useEffect(() => {
    const card = cardRef.current;
    const head = headRef.current;
    const thead = theadRef.current;
    if (!card || !head || !thead) return;

    const syncStickyOffsets = () => {
      const headH = Math.ceil(head.getBoundingClientRect().height);
      card.style.setProperty("--portfolio-card-head-h", `${headH}px`);
    };

    syncStickyOffsets();
    const ro = new ResizeObserver(syncStickyOffsets);
    ro.observe(head);
    ro.observe(thead);
    window.addEventListener("resize", syncStickyOffsets);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncStickyOffsets);
    };
  }, [portfolio.name, portfolio.properties.length]);

  function go(propertyName, slice) {
    navigate(buildPropertyUrl(region, propertyName, slice));
  }

  return (
    <article ref={cardRef} className="card portfolio-summary-card">
      <div ref={headRef} className="card-header portfolio-summary-card__head">
        <h2 className="card-title">{portfolio.name}</h2>
        <span className="text-muted" style={{ fontSize: "0.85rem" }}>
          {portfolio.properties.length} propert{portfolio.properties.length === 1 ? "y" : "ies"}
        </span>
      </div>
      <div className="card-body">
        <div className="table-wrap table-wrap--report table-wrap--dashboard-portfolio">
          <table className="data-table data-table-dashboard">
            <colgroup>
              <col className="dash-col-property" />
              <col className="dash-col-occupied" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
              <col className="dash-col-metric" />
            </colgroup>
            <thead ref={theadRef} className="dashboard-portfolio-thead">
              <tr>
                <th rowSpan={2} className="th-dashboard-property">
                  Property
                </th>
                <th rowSpan={2} className="th-occupied-units">
                  Occupied units
                </th>
                <th colSpan={2} className="th-collection-group">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                    <Wallet size={16} /> Collection
                  </span>
                </th>
                <th colSpan={6} className="th-alerts-group">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                    <AlertTriangle size={16} /> Alerts
                  </span>
                </th>
                <th colSpan={5} className="th-delinquent-group">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                    <Users size={16} /> Number of Delinquent Tenants
                  </span>
                </th>
              </tr>
              <tr>
                <th className="th-collection-sub th-collection-sub--lt1">Under 1 Month</th>
                <th className="th-collection-sub th-collection-sub--ge1">1 Month +</th>
                <th
                  className="th-alerts-sub"
                  title="Rent &gt; 0, no tenant follow-up date, and balance meets Follow Up Alerts settings"
                >
                  <StackedAlertHeader subject="Tenant" middle="Missing" label="Follow-up" />
                </th>
                <th
                  className="th-alerts-sub"
                  title="Rent &gt; 0 and tenant follow-up date is before today"
                >
                  <StackedAlertHeader subject="Tenant" label="Past Due Follow-up" />
                </th>
                <th className="th-alerts-sub">
                  <StackedAlertHeader subject="Legal" label="Past Due Follow-up" />
                </th>
                <th className="th-alerts-sub">
                  <StackedAlertHeader subject="Legal" label="Due Today Follow-up" />
                </th>
                <th className="th-alerts-sub">Requires Legal</th>
                <th className="th-alerts-sub">Close Legal</th>
                <th className="th-delinquent-sub" title="Rent &gt; 0 and balance ≤ 0">
                  Zero Balance
                </th>
                <th className="th-delinquent-sub" title="Rent is 0, or rent &gt; 0 and 0 &lt; balance &lt; rent">
                  Under 1 Month
                </th>
                <th
                  className="th-delinquent-sub"
                  title="Rent &gt; 0 and Rent ≤ Balance &lt; 3× Rent (1 to under 3 months of rent)"
                >
                  1-2 Month
                </th>
                <th className="th-delinquent-sub" title="Rent &gt; 0 and Balance ≥ 3× Rent">
                  3+ Months
                </th>
                <th className="th-delinquent-sub" title="LegalStatus set and not Case Closed">
                  In Legal
                </th>
              </tr>
            </thead>
            <tbody>
              {portfolio.properties.length === 0 && (
                <tr>
                  <td colSpan={15}>
                    <div className="empty-state">No properties in this portfolio.</div>
                  </td>
                </tr>
              )}
              {portfolio.properties.map((p) => {
                const lt1 = p.collectionLessThanOneMonth ?? { count: 0, percent: 0 };
                const ge1 = p.collectionOneMonthOrMore ?? { count: 0, percent: 0 };
                const al = p.alerts ?? {};
                const missingTenantFu = al.missingTenantFollowUp ?? 0;
                const pastDueTenant = al.pastDueTenantFollowUp ?? 0;
                const pastDue = al.pastDueFollowUp ?? 0;
                const dueToday = al.dueTodayFollowUp ?? 0;
                const reqLegal = al.requiresLegal ?? 0;
                const removeLegal = al.removeLegal ?? 0;
                const db = p.delinquentBuckets ?? {};
                const dq0 = db.zeroBalance ?? 0;
                const dqlt = db.lessThanOneMonth ?? 0;
                const dq12 = db.oneToUnderThreeMonths ?? 0;
                const dq3p = db.threePlusMonths ?? 0;
                const dqLeg = db.inLegal ?? 0;
                return (
                  <tr key={p.property}>
                    <td>
                      <DashboardCellButton title="All units" align="start" onNavigate={() => go(p.property)}>
                        <strong>{p.property}</strong>
                      </DashboardCellButton>
                    </td>
                    <td className="td-occupied-units">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Occupied units"
                        onNavigate={() => go(p.property, { occupied: true })}
                      >
                        {p.occupiedUnits ?? 0}
                      </DashboardCellButton>
                    </td>
                    <td className="td-collection-split">
                      <CollectionSplitCell
                        variant="lt1"
                        percent={lt1.percent}
                        count={lt1.count}
                        onNavigate={() => go(p.property, { collection: "lt1" })}
                      />
                    </td>
                    <td className="td-collection-split">
                      <CollectionSplitCell
                        variant="ge1"
                        percent={ge1.percent}
                        count={ge1.count}
                        onNavigate={() => go(p.property, { collection: "ge1" })}
                      />
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Tenant Missing Follow-up"
                        onNavigate={() => go(p.property, { alert: "missingTenantFollowUp" })}
                      >
                        {missingTenantFu > 0 ? (
                          <span className="alert-count-hot">{missingTenantFu}</span>
                        ) : (
                          <span>0</span>
                        )}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Tenant Past Due Follow-up"
                        onNavigate={() => go(p.property, { alert: "pastDueTenantFollowUp" })}
                      >
                        {pastDueTenant > 0 ? (
                          <span className="alert-count-hot">{pastDueTenant}</span>
                        ) : (
                          <span>0</span>
                        )}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Legal Past Due Follow-up"
                        onNavigate={() => go(p.property, { alert: "pastDueFollowUp" })}
                      >
                        {pastDue > 0 ? <span className="alert-count-hot">{pastDue}</span> : <span>0</span>}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Legal Due Today Follow-up"
                        onNavigate={() => go(p.property, { alert: "dueTodayFollowUp" })}
                      >
                        {dueToday > 0 ? <span className="alert-count-hot">{dueToday}</span> : <span>0</span>}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Requires Legal"
                        onNavigate={() => go(p.property, { alert: "requiresLegal" })}
                      >
                        {reqLegal > 0 ? <span className="alert-count-hot">{reqLegal}</span> : <span>0</span>}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Close Legal"
                        onNavigate={() => go(p.property, { alert: "removeLegal" })}
                      >
                        {removeLegal > 0 ? <span className="alert-count-hot">{removeLegal}</span> : <span>0</span>}
                      </DashboardCellButton>
                    </td>
                    <td className="td-delinquent-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Zero balance"
                        onNavigate={() => go(p.property, { delinq: "zeroBalance" })}
                      >
                        {dq0}
                      </DashboardCellButton>
                    </td>
                    <td className="td-delinquent-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Under 1 Month (delinquent)"
                        onNavigate={() => go(p.property, { delinq: "lessThanOneMonth" })}
                      >
                        {dqlt > 0 ? <span className="delinquent-count-warn">{dqlt}</span> : dqlt}
                      </DashboardCellButton>
                    </td>
                    <td className="td-delinquent-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="1–&lt;3 months of rent"
                        onNavigate={() => go(p.property, { delinq: "oneToUnderThreeMonths" })}
                      >
                        {dq12 > 0 ? <span className="delinquent-count-warn">{dq12}</span> : dq12}
                      </DashboardCellButton>
                    </td>
                    <td className="td-delinquent-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="3+ months"
                        onNavigate={() => go(p.property, { delinq: "threePlusMonths" })}
                      >
                        {dq3p > 0 ? <span className="delinquent-count-hot">{dq3p}</span> : dq3p}
                      </DashboardCellButton>
                    </td>
                    <td className="td-delinquent-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="In legal"
                        onNavigate={() => go(p.property, { delinq: "inLegal" })}
                      >
                        {dqLeg > 0 ? <span className="delinquent-count-hot">{dqLeg}</span> : dqLeg}
                      </DashboardCellButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}
