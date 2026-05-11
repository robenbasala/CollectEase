module.exports = {
  companyId: "CompanyId",
  region: "Region",
  portfolio: "Portfolio",
  property: "PropertyName",
  unit: "Unit",
  name: "TenantName",
  /** Column on dbo.DataTbl (used as dt.[Rent] in unit queries) */
  rent: "Rent",
  balance: "Balance",
  legalStatus: "LegalStatus",
  nextFollowUp: "NextFollowUp",
  note: "Note",
  lastPaymentDate: "LastPaymentDate",
  lastPaymentAmount: "LastPaymentAmount",
  phone: "PhomeNumber",
  email: "Email",
  /** Concat with Settings ERP static link for deep-link; dbo.DataTbl.[TenantCode] */
  tenantCode: "TenantCode"
};
