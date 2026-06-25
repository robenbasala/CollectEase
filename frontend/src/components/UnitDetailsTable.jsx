import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, ExternalLink, Mail } from "lucide-react";
import UnitDetailColumnPrefsModal from "./UnitDetailColumnPrefsModal";
import PaymentReminderEmailModal from "./PaymentReminderEmailModal";
import UnitDetailRowModal from "./UnitDetailRowModal";
import {
  normalizeUnitDetailColumnPrefs,
  UNIT_DETAIL_COLUMN_LABELS
} from "../constants/unitDetailColumns";
import LegalStatusCell from "./LegalStatusCell";
import { buildErpDeepLink, erpLinkIdFromUnit, hmypersonFromUnit, tenantCodeFromUnit } from "../lib/erpDeepLink";
import { dateDueTextClass } from "../lib/followUpDateStyle.js";
import { formatPhoneLines, formatProperName, phoneFromUnit } from "../lib/tenantDisplayFormat";

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

function getSortValue(u, key) {
  switch (key) {
    case "property":
      return u.property ?? "";
    case "unit":
      return u.unit ?? "";
    case "name":
      return u.name ?? "";
    case "tenantCode":
      return tenantCodeFromUnit(u);
    case "hmyperson":
      return hmypersonFromUnit(u);
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
      return `${u.legalStatus ?? ""}\t${Number(u.openLegalCaseCount) || 0}`;
    case "note":
      return u.note ?? "";
    case "nextFollowUp":
      if (!u.nextFollowUp) return null;
      const t = new Date(u.nextFollowUp).getTime();
      return Number.isNaN(t) ? null : t;
    case "tenantFollowUp":
      if (!u.tenantFollowUp) return null;
      const tf = new Date(u.tenantFollowUp).getTime();
      return Number.isNaN(tf) ? null : tf;
    case "lastPaymentDate":
      if (!u.lastPaymentDate) return null;
      const t2 = new Date(u.lastPaymentDate).getTime();
      return Number.isNaN(t2) ? null : t2;
    case "lastPaymentAmount": {
      const n = Number(u.lastPaymentAmount);
      return Number.isNaN(n) ? null : n;
    }
    case "phone":
      return phoneFromUnit(u);
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

/** Relative widths for table-layout: fixed (default column = 1). */
const UNIT_DETAIL_COL_WEIGHT = {
  unit: 0.7,
  name: 2,
  balance: 0.7,
  rent: 0.7,
  note: 2,
  actions: 0.7
};

function colKeysFromVisibleOrder(visibleOrder) {
  const keys = [];
  for (const key of visibleOrder) {
    if (key === "lastPayment") {
      keys.push("lastPaymentDate", "lastPaymentAmount");
    } else {
      keys.push(key);
    }
  }
  return keys;
}

function unitDetailColWeight(colKey) {
  return UNIT_DETAIL_COL_WEIGHT[colKey] ?? 1;
}

/** One <col> per body cell (lastPayment → date + amount). Keeps thead/tbody aligned with sticky headers. */
function buildTableColgroup(visibleOrder) {
  const keys = colKeysFromVisibleOrder(visibleOrder);
  const totalWeight = keys.reduce((sum, k) => sum + unitDetailColWeight(k), 0);
  const cols = keys.map((k) => {
    const pct = totalWeight > 0 ? (unitDetailColWeight(k) / totalWeight) * 100 : 100 / keys.length;
    return <col key={k} className={`col-${k}`} style={{ width: `${pct}%` }} />;
  });
  return <colgroup>{cols}</colgroup>;
}

function sameDetailRow(a, b) {
  if (!a || !b) return false;
  return (
    String(a.property ?? "").trim() === String(b.property ?? "").trim() &&
    String(a.unit ?? "").trim() === String(b.unit ?? "").trim() &&
    String(a.name ?? "").trim() === String(b.name ?? "").trim() &&
    tenantCodeFromUnit(a) === tenantCodeFromUnit(b)
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
        parts.push(<td key="n">{formatProperName(u.name ?? "") || "—"}</td>);
        break;
      case "tenantCode":
        parts.push(
          <td key="tc" className="unit-detail-tenant-code">
            {tenantCodeFromUnit(u) || "—"}
          </td>
        );
        break;
      case "hmyperson":
        parts.push(
          <td key="hp" className="unit-detail-hmyperson">
            {hmypersonFromUnit(u) || "—"}
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
        parts.push(
          <td key="md" className="unit-detail-md-cell tabular-nums">
            {u.monthsDelinquent ?? "—"}
          </td>
        );
        break;
      case "legalStatus":
        parts.push(
          <td key="ls" className="unit-detail-legal-status">
            <LegalStatusCell status={u.legalStatus} openCount={u.openLegalCaseCount} />
          </td>
        );
        break;
      case "note": {
        const noteText = String(u.note ?? "").trim();
        const noteAtRaw = u.noteAt ?? u.noteCreatedAt ?? u.NoteAt;
        const noteAt =
          noteAtRaw instanceof Date
            ? noteAtRaw
            : noteAtRaw
              ? new Date(noteAtRaw)
              : null;
        const noteAtValid = noteAt && !Number.isNaN(noteAt.getTime()) ? noteAt : null;
        parts.push(
          <td key="nt" className="unit-detail-note-cell" title={noteText || undefined}>
            {noteText ? (
              <span className="unit-detail-note-cell__inner">
                {noteAtValid ? (
                  <time className="unit-detail-note-date" dateTime={noteAtValid.toISOString()}>
                    {formatDate(noteAtValid)}
                  </time>
                ) : null}
                <span className="unit-detail-note-text">{noteText}</span>
              </span>
            ) : (
              "—"
            )}
          </td>
        );
        break;
      }
      case "nextFollowUp":
        parts.push(
          <td
            key="nf"
            className={`unit-detail-followup unit-detail-followup--system ${dateDueTextClass(u.nextFollowUp)}`}
            title="Next legal follow up (import / legal cases, read-only)"
          >
            {formatDate(u.nextFollowUp)}
          </td>
        );
        break;
      case "tenantFollowUp":
        parts.push(
          <td
            key="tf"
            className={`unit-detail-followup unit-detail-followup--tenant ${dateDueTextClass(u.tenantFollowUp)}`}
          >
            {formatDate(u.tenantFollowUp)}
          </td>
        );
        break;
      case "lastPayment":
        parts.push(
          <td key="lpd">{formatDate(u.lastPaymentDate)}</td>,
          <td key="lpa" className="money">
            {formatMoney(u.lastPaymentAmount)}
          </td>
        );
        break;
      case "phone": {
        const phoneLines = formatPhoneLines(phoneFromUnit(u));
        parts.push(
          <td key="ph" className="unit-detail-phone-cell">
            {phoneLines.length === 0 ? (
              "—"
            ) : (
              <div className="unit-detail-phone-stack">
                {phoneLines.map((line, i) => (
                  <span key={i} className="unit-detail-phone-line">
                    {line}
                  </span>
                ))}
              </div>
            )}
          </td>
        );
        break;
      }
      case "email":
        parts.push(
          <td key="em" className="unit-detail-email-cell">
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
        const erpHref = buildErpDeepLink(baseLink, erpLinkIdFromUnit(u));
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
                      : !String(erpLinkIdFromUnit(u)).trim()
                        ? "No Hmyperson / tenant code on this row"
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

function UnitDetailColumnsButton({ onClick }) {
  return (
    <button
      type="button"
      className="unit-detail-columns-btn"
      onClick={onClick}
      title="Choose which columns to show and their order"
    >
      <span className="unit-detail-columns-btn__icon" aria-hidden>
        <Columns3 size={17} strokeWidth={2.25} />
      </span>
      <span className="unit-detail-columns-btn__text">Columns</span>
    </button>
  );
}

function PropertyBlockHead({ blockCaption, blockRowCount }) {
  return (
    <div className="property-detail-unit-block__head">
      <h3 className="property-detail-unit-block__title">{blockCaption.propertyName}</h3>
      <div className="property-detail-unit-block__meta">
        <span className="property-detail-unit-block__count">
          {blockRowCount} {blockRowCount === 1 ? "row" : "rows"}
        </span>
        <span className="property-detail-unit-block__total money">
          Total balance: {formatMoney(blockCaption.totalBalance)}
        </span>
      </div>
    </div>
  );
}

export { UnitDetailColumnsButton };

export default function UnitDetailsTable({
  units,
  erpStaticLink,
  companyId,
  columnPrefs,
  onColumnPrefsSaved,
  showColumnsControl = true,
  onOpenColumnPrefs = null,
  blockCaption = null,
  emailPreviewContext = null,
  legalStatusChoices = [],
  onUnitsRefresh
}) {
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [paymentReminderUnit, setPaymentReminderUnit] = useState(null);
  const [detailModalUnit, setDetailModalUnit] = useState(null);
  const showColumnsButton = Boolean(onOpenColumnPrefs) || showColumnsControl;
  const handleOpenColumnPrefs = onOpenColumnPrefs ?? (() => setPrefsOpen(true));
  const renderColumnPrefsModal = showColumnsControl && !onOpenColumnPrefs;

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
  const tableColgroup = buildTableColgroup(visibleOrder);

  const headerRow = [];
  for (const key of visibleOrder) {
    if (key === "lastPayment") {
      headerRow.push(
        <th key="lp-d" className="th-last-payment-sub th-sortable th-col-lastPaymentDate">
          <SortHeaderButton
            label={UNIT_DETAIL_COLUMN_LABELS.lastPaymentDate}
            colKey="lastPaymentDate"
            {...sh("lastPaymentDate")}
            onSort={handleSort}
          />
        </th>,
        <th key="lp-a" className="th-last-payment-sub th-sortable th-col-lastPaymentAmount">
          <SortHeaderButton
            label={UNIT_DETAIL_COLUMN_LABELS.lastPaymentAmount}
            colKey="lastPaymentAmount"
            {...sh("lastPaymentAmount")}
            onSort={handleSort}
          />
        </th>
      );
    } else if (key === "actions") {
      headerRow.push(
        <th key="act" className="th-actions th-col-actions">
          {UNIT_DETAIL_COLUMN_LABELS.actions}
        </th>
      );
    } else {
      const label = UNIT_DETAIL_COLUMN_LABELS[key];
      headerRow.push(
        <th key={key} className={`th-sortable th-col-${key}`}>
          <SortHeaderButton label={label} colKey={key} {...sh(key)} onSort={handleSort} />
        </th>
      );
    }
  }

  /** Resolve row count: prefer the value the caller passes (matches the un-paginated dataset for this property
   *  block, even when other parts of the UI later slice it). Fall back to the live array length so this stays
   *  correct when the component is used standalone without a blockCaption. */
  const blockRowCount =
    blockCaption && Number.isFinite(Number(blockCaption.rowCount))
      ? Number(blockCaption.rowCount)
      : units.length;

  if (!units.length) {
    return (
      <Fragment>
        {blockCaption ? (
          <PropertyBlockHead blockCaption={blockCaption} blockRowCount={blockRowCount} />
        ) : null}
        <div className="empty-state">No units match the current filters.</div>
      </Fragment>
    );
  }

  return (
    <Fragment>
      {blockCaption ? (
        <PropertyBlockHead blockCaption={blockCaption} blockRowCount={blockRowCount} />
      ) : showColumnsButton ? (
        <div className="unit-detail-table-toolbar">
          <UnitDetailColumnsButton onClick={handleOpenColumnPrefs} />
        </div>
      ) : null}
      <div className="property-detail-unit-block__table">
        <div className="table-wrap table-wrap--report table-wrap--unit-detail">
          <table className="data-table data-table-unit-detail">
          {tableColgroup}
          <thead className="unit-detail-thead">
            <tr>{headerRow}</tr>
          </thead>
          <tbody>
            {sortedUnits.map((u, idx) => {
              const erpHref = buildErpDeepLink(baseLink, erpLinkIdFromUnit(u));
              const rowTooltip = erpHref
                ? erpHref
                : !baseLink.trim()
                  ? "Set ERP static link in Settings"
                  : !String(erpLinkIdFromUnit(u)).trim()
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
      </div>
      {renderColumnPrefsModal ? (
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
