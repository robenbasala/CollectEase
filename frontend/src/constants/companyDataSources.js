export const COMPANY_DATA_SOURCES = [
  { value: "Yardi", label: "Yardi" },
  { value: "Appfolio", label: "Appfolio" },
  { value: "Landlord", label: "Landlord" }
];

const SOURCE_SET = new Set(COMPANY_DATA_SOURCES.map((x) => x.value));

export function companyDataSourceCardClass(dataSource) {
  const v = String(dataSource || "").trim();
  if (v === "Yardi") return "admin-company-card--yardi";
  if (v === "Appfolio") return "admin-company-card--appfolio";
  if (v === "Landlord") return "admin-company-card--landlord";
  return "";
}

export function companyDataSourceLabel(dataSource) {
  const v = String(dataSource || "").trim();
  return SOURCE_SET.has(v) ? v : null;
}

export function companyDataSourcePillClass(dataSource) {
  const v = String(dataSource || "").trim();
  if (v === "Yardi") return "admin-company-card__source-pill--yardi";
  if (v === "Appfolio") return "admin-company-card__source-pill--appfolio";
  if (v === "Landlord") return "admin-company-card__source-pill--landlord";
  return "admin-company-card__source-pill--unset";
}

export function companyDataSourceDisplayLabel(dataSource) {
  return companyDataSourceLabel(dataSource) || "Not set";
}
