import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, ExternalLink, Mail } from "lucide-react";
import UnitDetailColumnPrefsModal from "./UnitDetailColumnPrefsModal";
import PaymentReminderEmailModal from "./PaymentReminderEmailModal";
import UnitDetailRowModal from "./UnitDetailRowModal";
import {
  normalizeUnitDetailColumnPrefs,
  UNIT_DETAIL_COLUMN_LABELS
} from "../constants/unitDetailColumns";

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

function phoneValue(u) {
  return u.phone ?? u.PhomeNumber ?? u.phomeNumber ?? "";
}

function buildTenantDeepLink(staticPart, tenantCode) {
  if (!staticPart || typeof staticPart !== "string") return null;
  const base = staticPart.trim();
  if (!base) return null;
  if (tenantCode === undefined || tenantCode === null) return null;
  const code = String(tenantCode).trim();
  if (!code) return null;
  return `${base}${code}`;
}

function tenantCodeValue(u) {
  if (!u || typeof u !== "object") return "";
  for (const k of Object.keys(u)) {
    if (k.toLowerCase() === "tenantcode") {
      const v = u[k];
      return v == null ? "" : String(v).trim();
    }
  }
  return "";
}

function getSortValue(u, key) {
  switch (key) {
    case "property":
      return u.property ?? "";
    case "unit":
      return u.unit ?? "";
    case "name":
      return u.name ?? "";
    case "tenantCode":
      return tenantCodeValue(u);
    case "balance": {
      const n = Number(u.balance);
      return Number.isNaN(n) ? null : n;
    }
    case "rent": {
      const n = Number(u.rent);
      return Number.isNaN(n) ? null : n;
    }
    case "monthsDelinquent": {
      const raw = u.monthsDelinquent;
      if (raw === null || raw === undefined || raw === "") return null;
      const n = Number(raw);
      return Number.isNaN(n) ? String(raw) : n;
    }
    case "legalStatus":
      return u.legalStatus ?? "";
    case "nextFollowUp":
      if (!u.nextFollowUp) return null;
      const t = new Date(u.nextFollowUp).getTime();
      return Number.isNaN(t) ? null : t;
    case "lastPaymentDate":
      if (!u.lastPaymentDate) return null;
      const t2 = new Date(u.lastPaymentDate).getTime();
      return Number.isNaN(t2) ? null : t2;
    case "lastPaymentAmount": {
      const n = Number(u.lastPaymentAmount);
      return Number.isNaN(n) ? null : n;
    }
    case "phone":
      return phoneValue(u);
    case "email":
      return u.email ?? "";
    default:
      return "";
  }
}

function isEmptyForSort(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

function compareSortValues(va, vb) {
  const ea = isEmptyForSort(va);
  const eb = isEmptyForSort(vb);
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
}

function tieBreakKey(u) {
  return `${u.property ?? ""}\t${u.unit ?? ""}\t${u.name ?? ""}`;
}

function sameDetailRow(a, b) {
  if (!a || !b) return false;
  return (
    String(a.property ?? "").trim() === String(b.property ?? "").trim() &&
    String(a.unit ?? "").trim() === String(b.unit ?? "").trim() &&
    String(a.name ?? "").trim() === String(b.name ?? "").trim() &&
    tenantCodeValue(a) === tenantCodeValue(b)
  );
}

function SortHeaderButton({ label, colKey, active, dir, onSort }) {
  return (
    <button
      type="button"
      className={`unit-detail-sort-btn${active ? " is-active" : ""}`}
      onClick={() => onSort(colKey)}
      title={active ? `Sorted ${dir === "asc" ? "ascending" : "descending"} — click to reverse` : "Sort"}
    >
      <span className="unit-detail-sort-label">{label}</span>
      <span className="unit-detail-sort-icon" aria-hidden>
        {active ? (
          dir === "asc" ? (
            <ArrowUp size={14} strokeWidth={2.25} />
          ) : (
            <ArrowDown size={14} strokeWidth={2.25} />
          )
        ) : (
          <ArrowUpDown size={14} strokeWidth={2.25} />
        )}
      </span>
    </button>
  );
}

function renderBodyCells(u, visibleOrder, baseLink, openPaymentReminder, reminderReplyFallback) {
  const parts = [];
  for (const key of visibleOrder) {
    switch (key) {
      case "property":
        parts.push(<td key="p">{u.property ?? "—"}</td>);
        break;
      case "unit":
        parts.push(<td key="u">{u.unit ?? "—"}</td>);
        break;
      case "name":
        parts.push(<td key="n">{u.name ?? "—"}</td>);
        break;
      case "tenantCode":
        parts.push(
          <td key="tc" className="unit-detail-tenant-code">
            {tenantCodeValue(u) || "—"}
          </td>
        );
        break;
      case "balance":
        parts.push(
          <td key="b" className={`money ${Number(u.balance) > 0 ? "text-danger" : ""}`}>
            {formatMoney(u.balance)}
          </td>
        );
        break;
      case "rent":
        parts.push(
          <td key="r" className="money">
            {formatMoney(u.rent)}
          </td>
        );
        break;
      case "monthsDelinquent":
        parts.push(<td key="md">{u.monthsDelinquent ?? "—"}</td>);
        break;
      case "legalStatus":
        parts.push(<td key="ls">{u.legalStatus ?? "—"}</td>);
        break;
      case "nextFollowUp":
        parts.push(<td key="nf">{formatDate(u.nextFollowUp)}</td>);
        break;
      case "lastPayment":
        parts.push(
          <td key="lpd">{formatDate(u.lastPaymentDate)}</td>,
          <td key="lpa" className="money">
            {formatMoney(u.lastPaymentAmount)}
          </td>
        );
        break;
      case "phone":
        parts.push(<td key="ph">{phoneValue(u) || "—"}</td>);
        break;
      case "email":
        parts.push(
          <td key="em">
            {u.email ? (
              <button
                type="button"
                className="unit-detail-email-trigger"
                onClick={(e) => {
                  e.stopPropagation();
                  openPaymentReminder(u);
                }}
              >
                {u.email}
              </button>
            ) : reminderReplyFallback ? (
              <button
                type="button"
                className="unit-detail-email-trigger"
                title={`No tenant email — send to company contact (${reminderReplyFallback})`}
                onClick={(e) => {
                  e.stopPropagation();
                  openPaymentReminder(u);
                }}
              >
                Company contact
              </button>
            ) : (
              "—"
            )}
          </td>
        );
        break;
      case "actions": {
        const erpHref = buildTenantDeepLink(baseLink, tenantCodeValue(u));
        parts.push(
          <td key="ac">
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {(u.email || reminderReplyFallback) && (
                <button
                  type="button"
                  className="btn-icon"
                  title="Payment reminder preview"
                  aria-label="Payment reminder preview"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPaymentReminder(u);
                  }}
                >
                  <Mail size={16} />
                </button>
              )}
              {erpHref ? (
                <a
                  className="btn-icon"
                  href={erpHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={erpHref}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={16} />
                </a>
              ) : (
                <span
                  className="btn-icon btn-icon--muted"
                  title={
                    !baseLink.trim()
                      ? "Set ERP static link in Settings"
                      : !String(tenantCodeValue(u)).trim()
                        ? "No tenant code on this row"
                        : "Link unavailable"
                  }
                >
                  <ExternalLink size={16} />
                </span>
              )}
            </div>
          </td>
        );
        break;
      }
      default:
        break;
    }
  }
  return parts;
}

export default function UnitDetailsTable({
  units,
  erpStaticLink,
  companyId,
  columnPrefs,
  onColumnPrefsSaved,
  showColumnsControl = true,
  blockCaption = null,
  emailPreviewContext = null,
  legalStatusChoices = [],
  onUnitsRefresh
}) {
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [paymentReminderUnit, setPaymentReminderUnit] = useState(null);
  const [detailModalUnit, setDetailModalUnit] = useState(null);

  useEffect(() => {
    setDetailModalUnit((cur) => {
      if (!cur) return cur;
      const next = units.find((u) => sameDetailRow(u, cur));
      return next ?? cur;
    });
  }, [units]);

  const reminderReplyFallback = emailPreviewContext?.replyEmail
    ? String(emailPreviewContext.replyEmail).trim()
    : "";

  function openPaymentReminder(u) {
    const tenant = u?.email ? String(u.email).trim() : "";
    if (tenant || reminderReplyFallback) setPaymentReminderUnit(u);
  }

  function handleDataRowClick(e, u) {
    if (e.target.closest("a,button,input,select,textarea,label")) return;
    setDetailModalUnit(u);
  }

  const visibleOrder = useMemo(() => {
    const { columnOrder, hidden } = normalizeUnitDetailColumnPrefs(columnPrefs ?? {});
    const hid = new Set(hidden);
    return columnOrder.filter((k) => !hid.has(k));
  }, [columnPrefs]);

  const visibleKey = useMemo(() => visibleOrder.join("|"), [visibleOrder]);

  useEffect(() => {
    if (!sort.key) return;
    if (sort.key === "lastPaymentDate" || sort.key === "lastPaymentAmount") {
      if (!visibleOrder.includes("lastPayment")) setSort({ key: null, dir: "asc" });
      return;
    }
    if (!visibleOrder.includes(sort.key)) setSort({ key: null, dir: "asc" });
  }, [visibleKey, sort.key]);

  function handleSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  const sortedUnits = useMemo(() => {
    if (!sort.key) return units;
    const arr = [...units];
    arr.sort((a, b) => {
      const va = getSortValue(a, sort.key);
      const vb = getSortValue(b, sort.key);
      let c = compareSortValues(va, vb);
      if (sort.dir === "desc") c = -c;
      if (c !== 0) return c;
      return tieBreakKey(a).localeCompare(tieBreakKey(b));
    });
    return arr;
  }, [units, sort]);

  const sh = (key) => ({
    active: sort.key === key,
    dir: sort.dir
  });

  const baseLink = typeof erpStaticLink === "string" ? erpStaticLink : "";
  const hasLastPayment = visibleOrder.includes("lastPayment");
  const headerRowSpan = hasLastPayment ? 2 : 1;

  const headerRow1 = [];
  const headerRow2 = [];
  for (const key of visibleOrder) {
    if (key === "lastPayment") {
      headerRow1.push(
        <th key="lp-h" colSpan={2} className="th-last-payment-group">
          {UNIT_DETAIL_COLUMN_LABELS.lastPayment}
        </th>
      );
      headerRow2.push(
        <th key="lp-d" className="th-last-payment-sub th-sortable">
          <SortHeaderButton
            label="Date"
            colKey="lastPaymentDate"
            {...sh("lastPaymentDate")}
            onSort={handleSort}
          />
        </th>,
        <th key="lp-a" className="th-last-payment-sub th-sortable">
          <SortHeaderButton
            label="Amount"
            colKey="lastPaymentAmount"
            {...sh("lastPaymentAmount")}
            onSort={handleSort}
          />
        </th>
      );
    } else if (key === "actions") {
      headerRow1.push(
        <th key="act" rowSpan={headerRowSpan} className="th-actions">
          {UNIT_DETAIL_COLUMN_LABELS.actions}
        </th>
      );
    } else {
      const label = UNIT_DETAIL_COLUMN_LABELS[key];
      headerRow1.push(
        <th key={key} rowSpan={headerRowSpan} className="th-sortable">
          <SortHeaderButton label={label} colKey={key} {...sh(key)} onSort={handleSort} />
        </th>
      );
    }
  }

  if (!units.length) {
    return (
      <Fragment>
        {blockCaption ? (
          <div className="property-detail-unit-block__head">
            <h3 className="property-detail-unit-block__title">{blockCaption.propertyName}</h3>
            <div className="property-detail-unit-block__meta">
              <span className="property-detail-unit-block__total money">
                Total balance: {formatMoney(blockCaption.totalBalance)}
              </span>
            </div>
          </div>
        ) : null}
        <div className="empty-state">No units match the current filters.</div>
      </Fragment>
    );
  }

  return (
    <Fragment>
      {blockCaption ? (
        <div className="property-detail-unit-block__head">
          <h3 className="property-detail-unit-block__title">{blockCaption.propertyName}</h3>
          <div className="property-detail-unit-block__meta">
            <span className="property-detail-unit-block__total money">
              Total balance: {formatMoney(blockCaption.totalBalance)}
            </span>
          </div>
        </div>
      ) : null}
      {showColumnsControl ? (
        <div className="unit-detail-table-toolbar">
          <button
            type="button"
            className="unit-detail-columns-btn"
            onClick={() => setPrefsOpen(true)}
            title="Choose which columns to show and their order"
          >
            <span className="unit-detail-columns-btn__icon" aria-hidden>
              <Columns3 size={17} strokeWidth={2.25} />
            </span>
            <span className="unit-detail-columns-btn__text">Columns</span>
          </button>
        </div>
      ) : null}
      <div className="table-wrap table-wrap--report">
        <table className="data-table data-table-unit-detail">
          <thead>
            <tr>{headerRow1}</tr>
            {hasLastPayment ? <tr>{headerRow2}</tr> : null}
          </thead>
          <tbody>
            {sortedUnits.map((u, idx) => {
              const erpHref = buildTenantDeepLink(baseLink, tenantCodeValue(u));
              const rowTooltip = erpHref
                ? erpHref
                : !baseLink.trim()
                  ? "Set ERP static link in Settings"
                  : !String(tenantCodeValue(u)).trim()
                    ? "No tenant code on this row"
                    : undefined;
              return (
                <tr
                  key={`${u.property ?? ""}-${u.unit}-${u.name}-${idx}`}
                  className="unit-detail-data-row"
                  title={rowTooltip ? `${rowTooltip} — Click row for details` : "Click row for details"}
                  onClick={(e) => handleDataRowClick(e, u)}
                >
                  {renderBodyCells(u, visibleOrder, baseLink, openPaymentReminder, reminderReplyFallback)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showColumnsControl ? (
        <UnitDetailColumnPrefsModal
          open={prefsOpen}
          companyId={companyId}
          initialPrefs={columnPrefs ?? {}}
          onClose={() => setPrefsOpen(false)}
          onSaved={(next) => onColumnPrefsSaved?.(next)}
        />
      ) : null}
      <UnitDetailRowModal
        open={Boolean(detailModalUnit)}
        unit={detailModalUnit}
        onClose={() => setDetailModalUnit(null)}
        legalStatusChoices={legalStatusChoices}
        erpStaticLink={baseLink}
        emailPreviewContext={emailPreviewContext}
        onOpenPaymentReminder={(u) => {
          setDetailModalUnit(null);
          openPaymentReminder(u);
        }}
        onUnitsRefresh={onUnitsRefresh}
      />
      <PaymentReminderEmailModal
        open={Boolean(paymentReminderUnit)}
        unit={paymentReminderUnit}
        context={emailPreviewContext ?? {}}
        onClose={() => setPaymentReminderUnit(null)}
      />
    </Fragment>
  );
}
