import { useNavigate } from "react-router-dom";
import { Wallet, AlertTriangle, Users } from "lucide-react";
import { getActiveCompanyId } from "../config/company.js";

/**
 * @param {object} [slice]
 * @param {"lt1"|"ge1"} [slice.collection]
 * @param {"missingFollowUp"|"pastDueFollowUp"|"dueTodayFollowUp"|"requiresLegal"|"removeLegal"} [slice.alert]
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
      <span className="collection-split-pct">{percent}%</span>
      <span className="collection-split-count">{count}</span>
    </button>
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

  function go(propertyName, slice) {
    navigate(buildPropertyUrl(region, propertyName, slice));
  }

  return (
    <article className="card">
      <div className="card-header">
        <h2 className="card-title">{portfolio.name}</h2>
        <span className="text-muted" style={{ fontSize: "0.85rem" }}>
          {portfolio.properties.length} propert{portfolio.properties.length === 1 ? "y" : "ies"}
        </span>
      </div>
      <div className="card-body">
        <div className="table-wrap table-wrap--report">
          <table className="data-table data-table-dashboard">
            <thead>
              <tr>
                <th rowSpan={2}>Property</th>
                <th rowSpan={2} className="th-occupied-units">
                  Occupied units
                </th>
                <th colSpan={2} className="th-collection-group">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                    <Wallet size={16} /> Collection
                  </span>
                </th>
                <th colSpan={5} className="th-alerts-group">
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
                <th className="th-collection-sub th-collection-sub--lt1">Less than 1 month</th>
                <th className="th-collection-sub th-collection-sub--ge1">1 month or more</th>
                <th className="th-alerts-sub">Missing follow up</th>
                <th className="th-alerts-sub">Past due follow up</th>
                <th className="th-alerts-sub">Due today follow up</th>
                <th className="th-alerts-sub">Requires legal</th>
                <th className="th-alerts-sub">Remove legal</th>
                <th className="th-delinquent-sub" title="Rent &gt; 0 and balance ≤ 0">
                  Zero Balance
                </th>
                <th className="th-delinquent-sub" title="Rent &gt; 0 and 0 &lt; Balance &lt; Rent">
                  Less Than a Month
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
                  <td colSpan={14}>
                    <div className="empty-state">No properties in this portfolio.</div>
                  </td>
                </tr>
              )}
              {portfolio.properties.map((p) => {
                const lt1 = p.collectionLessThanOneMonth ?? { count: 0, percent: 0 };
                const ge1 = p.collectionOneMonthOrMore ?? { count: 0, percent: 0 };
                const al = p.alerts ?? {};
                const missingFu = al.missingFollowUp ?? 0;
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
                        title="Occupied (Rent &gt; 0)"
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
                        title="Missing follow up"
                        onNavigate={() => go(p.property, { alert: "missingFollowUp" })}
                      >
                        {missingFu > 0 ? <span className="alert-count-hot">{missingFu}</span> : <span>0</span>}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Past due follow up"
                        onNavigate={() => go(p.property, { alert: "pastDueFollowUp" })}
                      >
                        {pastDue > 0 ? <span className="alert-count-hot">{pastDue}</span> : <span>0</span>}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Due today follow up"
                        onNavigate={() => go(p.property, { alert: "dueTodayFollowUp" })}
                      >
                        {dueToday > 0 ? <span className="alert-count-hot">{dueToday}</span> : <span>0</span>}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Requires legal"
                        onNavigate={() => go(p.property, { alert: "requiresLegal" })}
                      >
                        {reqLegal > 0 ? <span className="alert-count-hot">{reqLegal}</span> : <span>0</span>}
                      </DashboardCellButton>
                    </td>
                    <td className="td-alert-count">
                      <DashboardCellButton
                        className="tabular-nums"
                        title="Remove legal"
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
                        title="Less than a month (delinquent)"
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
