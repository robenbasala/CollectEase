/** Must match backend `helpers/unitDetailColumnPrefs.js` keys and order (actions last). */
export const UNIT_DETAIL_COLUMN_ALL_KEYS = [
  "property",
  "unit",
  "name",
  "tenantCode",
  "balance",
  "rent",
  "monthsDelinquent",
  "legalStatus",
  "note",
  "nextFollowUp",
  "lastPayment",
  "phone",
  "email",
  "actions"
];

const KEY_SET = new Set(UNIT_DETAIL_COLUMN_ALL_KEYS);

export const UNIT_DETAIL_COLUMN_LABELS = {
  property: "Property",
  unit: "Unit",
  name: "Name",
  tenantCode: "Tenant code",
  balance: "Balance",
  rent: "Rent",
  monthsDelinquent: "Months delinquent",
  legalStatus: "Legal status",
  note: "Note",
  nextFollowUp: "Next follow up",
  lastPayment: "Last payment",
  phone: "Phone",
  email: "Email",
  actions: "Actions"
};

/** @param {unknown} input */
export function normalizeUnitDetailColumnPrefs(input) {
  const raw = input && typeof input === "object" ? input : {};
  const hidden = new Set();
  if (Array.isArray(raw.hidden)) {
    for (const h of raw.hidden) {
      const k = typeof h === "string" ? h.trim() : "";
      if (KEY_SET.has(k) && k !== "actions") hidden.add(k);
    }
  }
  let order = Array.isArray(raw.columnOrder)
    ? raw.columnOrder.map((x) => (typeof x === "string" ? x.trim() : "")).filter((k) => KEY_SET.has(k))
    : [];
  const seen = new Set();
  order = order.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const k of UNIT_DETAIL_COLUMN_ALL_KEYS) {
    if (!seen.has(k)) order.push(k);
  }
  order = order.filter((k) => k !== "actions");
  order.push("actions");
  return { columnOrder: order, hidden: [...hidden] };
}
