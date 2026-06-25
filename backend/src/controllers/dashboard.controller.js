const { sql, query } = require("../db");
const col = require("../helpers/columnMap");
const {
  readCompanyContext,
  intersectRequestedProperties,
  dataTblPropertyScopeSql,
  propertiesTableScopeSql,
  memberCanAccessProperty
} = require("../helpers/companyContext");
const {
  normalizeUnitDetailColumnPrefs,
  parsePrefsJson
} = require("../helpers/unitDetailColumnPrefs");

function q(name) {
  return `[${col[name]}]`;
}

const CC = q("companyId");
const PR = q("property");
const U = q("unit");
const N = q("name");
const RT = q("rent");
const B = q("balance");
const LS = q("legalStatus");
const NF = q("nextFollowUp");
const TF = q("tenantFollowUp");
const LPD = q("lastPaymentDate");
const LPA = q("lastPaymentAmount");
const PH = q("phone");
const EM = q("email");
const TC = q("tenantCode");
const HP = q("hmyperson");
/** Row balance/rent as DECIMAL with 0 fallback — avoids NULL in comparisons (SUM was silently dropping rows). */
const DT_BAL = `ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0)`;
const DT_RENT = `ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0)`;

/** Collection / delinquent "Under 1 Month": zero rent, or positive rent with balance below one month. */
const COLLECTION_LT1_PRED = `${DT_RENT} <= 0 OR (${DT_RENT} > 0 AND ${DT_BAL} < ${DT_RENT})`;
const COLLECTION_LT1 = `(${COLLECTION_LT1_PRED})`;
const COLLECTION_GE1 = `(${DT_RENT} > 0 AND ${DT_BAL} >= ${DT_RENT})`;
const DELINQ_LT1_PRED = `${DT_RENT} <= 0 OR (${DT_RENT} > 0 AND ${DT_BAL} > 0 AND ${DT_BAL} < ${DT_RENT})`;
const DELINQ_LT1 = `(${DELINQ_LT1_PRED})`;

function nextFollowUpToMillis(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const d = new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** Share of total as percent with one decimal (avoids misleading 100% when count < total). */
function percentOf(part, total) {
  if (!total) return 0;
  return Math.round((1000 * part) / total) / 10;
}

function pickNum(row, ...names) {
  if (!row || typeof row !== "object") return 0;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) {
      const v = row[name];
      if (v !== undefined && v !== null && v !== "") {
        const n = Number(v);
        if (!Number.isNaN(n)) return n;
      }
    }
  }
  const keys = Object.keys(row);
  for (const name of names) {
    const nl = name.toLowerCase();
    const k = keys.find((x) => x.toLowerCase() === nl);
    if (k !== undefined) {
      const v = row[k];
      if (v !== undefined && v !== null && v !== "") {
        const n = Number(v);
        if (!Number.isNaN(n)) return n;
      }
    }
  }
  return 0;
}

const MD_EXPR = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,2)), 0) = 0 THEN 0
  ELSE ROUND(
    ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,2)), 0) / NULLIF(TRY_CAST(dt.${RT} AS DECIMAL(18,2)), 0),
    0
  )
END`;

/** NextFollowUp blank on DataTbl only (legacy) */
const NF_BLANK = `(dt.${NF} IS NULL OR LTRIM(RTRIM(CAST(dt.${NF} AS NVARCHAR(400)))) = N'')`;

/** TenantFollowUp has a saved date on DataTbl. */
const TF_HAS_VALUE = `(dt.${TF} IS NOT NULL AND TRY_CONVERT(DATETIME2, dt.${TF}) IS NOT NULL)`;

/** TenantFollowUp blank — no date stored on DataTbl. */
const TF_BLANK = `NOT (${TF_HAS_VALUE})`;

/** Join open legal cases for portfolio/unit alert aggregates (requires @companyId). */
const LEGAL_CASE_JOINS = `
    LEFT JOIN (
      SELECT PropertyName, Unit, TenantName, MIN(FollowUpAt) AS MinLegalFollowUp
      FROM dbo.UnitLegalCase
      WHERE CompanyId = @companyId AND IsClosed = 0 AND FollowUpAt IS NOT NULL
      GROUP BY PropertyName, Unit, TenantName
    ) lc_fu ON LTRIM(RTRIM(CAST(lc_fu.PropertyName AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(dt.${PR} AS NVARCHAR(400))))
      AND LTRIM(RTRIM(CAST(lc_fu.Unit AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(dt.${U} AS NVARCHAR(400))))
      AND LTRIM(RTRIM(CAST(lc_fu.TenantName AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(dt.${N} AS NVARCHAR(400))))
    LEFT JOIN (
      SELECT PropertyName, Unit, TenantName, LatestStatus
      FROM (
        SELECT lc.PropertyName, lc.Unit, lc.TenantName, lcs.Status AS LatestStatus,
          ROW_NUMBER() OVER (
            PARTITION BY lc.PropertyName, lc.Unit, lc.TenantName
            ORDER BY lc.CreatedAt DESC, lc.Id DESC
          ) AS rn
        FROM dbo.UnitLegalCase lc
        OUTER APPLY (
          SELECT TOP 1 Status FROM dbo.UnitLegalCaseStatus
          WHERE CaseId = lc.Id ORDER BY ChangedAt DESC, Id DESC
        ) lcs
        WHERE lc.CompanyId = @companyId AND lc.IsClosed = 0
      ) x WHERE x.rn = 1
    ) lc_st ON LTRIM(RTRIM(CAST(lc_st.PropertyName AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(dt.${PR} AS NVARCHAR(400))))
      AND LTRIM(RTRIM(CAST(lc_st.Unit AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(dt.${U} AS NVARCHAR(400))))
      AND LTRIM(RTRIM(CAST(lc_st.TenantName AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(dt.${N} AS NVARCHAR(400))))`;

/** Earliest of DataTbl NextFollowUp and open-case FollowUpAt (matches unit list overlay). */
const EFFECTIVE_FOLLOWUP_DATE = `(
  CASE
    WHEN TRY_CONVERT(DATE, dt.${NF}) IS NULL THEN TRY_CONVERT(DATE, lc_fu.MinLegalFollowUp)
    WHEN TRY_CONVERT(DATE, lc_fu.MinLegalFollowUp) IS NULL THEN TRY_CONVERT(DATE, dt.${NF})
    WHEN TRY_CONVERT(DATE, dt.${NF}) <= TRY_CONVERT(DATE, lc_fu.MinLegalFollowUp)
      THEN TRY_CONVERT(DATE, dt.${NF})
    ELSE TRY_CONVERT(DATE, lc_fu.MinLegalFollowUp)
  END
)`;

const EFFECTIVE_NF_BLANK = `(${EFFECTIVE_FOLLOWUP_DATE} IS NULL)`;

/** Legal status for alerts: latest open case status when present, else DataTbl. */
const EFFECTIVE_LS_EXPR = `CASE
  WHEN lc_st.LatestStatus IS NOT NULL AND LTRIM(RTRIM(lc_st.LatestStatus)) <> N''
  THEN LTRIM(RTRIM(lc_st.LatestStatus))
  ELSE NULLIF(LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))), N'')
END`;

/** Balance/rent thresholds from CompanyCollectionSettings — tenant follow-up required when met. */
const TENANT_FOLLOWUP_THRESHOLD = `(
  (
    ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0) > ISNULL(TRY_CAST(cs.FollowupAmount AS DECIMAL(18,4)), 0)
    AND DAY(GETDATE()) > ISNULL(TRY_CAST(cs.FollowupDays AS INT), 9999)
  )
  OR (
    ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0)
      >= ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0)
         * ISNULL(TRY_CAST(cs.FollowupMonths AS DECIMAL(18,4)), 0)
  )
)`;

/**
 * Missing tenant follow-up — rent &gt; 0, balance &gt; 0, no TenantFollowUp date on DataTbl,
 * and balance meets Follow Up Alerts thresholds (CompanyCollectionSettings).
 */
const MISSING_TENANT_FOLLOWUP_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND ${DT_BAL} > 0
    AND ${TF_BLANK}
    AND ${TENANT_FOLLOWUP_THRESHOLD}
  THEN 1 ELSE 0
END`;

/** Past due tenant follow-up — Rent>0, TenantFollowUp date before today. */
const PAST_DUE_TENANT_FOLLOWUP_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND ${TF_HAS_VALUE}
    AND TRY_CONVERT(DATE, dt.${TF}) < CAST(GETDATE() AS DATE)
  THEN 1 ELSE 0
END`;

/** Past due follow up — Rent>0, effective next follow-up before today. */
const PAST_DUE_FOLLOWUP_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND NOT (${EFFECTIVE_NF_BLANK})
    AND ${EFFECTIVE_FOLLOWUP_DATE} < CAST(GETDATE() AS DATE)
  THEN 1 ELSE 0
END`;

/** Due today follow up — Rent>0, effective next follow-up is today. */
const DUE_TODAY_FOLLOWUP_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND NOT (${EFFECTIVE_NF_BLANK})
    AND ${EFFECTIVE_FOLLOWUP_DATE} = CAST(GETDATE() AS DATE)
  THEN 1 ELSE 0
END`;

/** Effective legal status blank or "Case Closed" (eligible for requires-legal alert). */
const LEGAL_STATUS_OPEN_FOR_ESCALATION = `(
  ${EFFECTIVE_LS_EXPR} IS NULL OR ${EFFECTIVE_LS_EXPR} = N'Case Closed'
)`;

/**
 * Requires legal — Power Apps: Rent>0, balance/day or balance≥rent×months thresholds from settings,
 * and (IsBlank(LegalStatus) || LegalStatus = "Case Closed").
 */
const REQUIRES_LEGAL_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND (
      (
        ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0) > ISNULL(TRY_CAST(cs.LegalAlertAmount AS DECIMAL(18,4)), 0)
        AND DAY(GETDATE()) > ISNULL(TRY_CAST(cs.LegalAlertDays AS INT), 9999)
      )
      OR (
        ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0)
          >= ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0)
             * ISNULL(TRY_CAST(cs.LegalAlertMonths AS DECIMAL(18,4)), 0)
      )
    )
    AND ${LEGAL_STATUS_OPEN_FOR_ESCALATION}
  THEN 1 ELSE 0
END`;

/** Remove legal — Balance<=0, effective legal status set and not Case Closed. */
const LEGAL_STATUS_NOT_BLANK = `(${EFFECTIVE_LS_EXPR} IS NOT NULL AND ${EFFECTIVE_LS_EXPR} <> N'')`;
const REMOVE_LEGAL_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0) <= 0
    AND ${LEGAL_STATUS_NOT_BLANK}
    AND ${EFFECTIVE_LS_EXPR} <> N'Case Closed'
  THEN 1 ELSE 0
END`;

/**
 * Delinquent tenant buckets (Power Apps "Number of Delinquent Tenants" style).
 * Zero balance: Balance <= 0 (any row; matches large PA counts even when Rent is blank).
 * Other bands: Rent > 0; middle column [Rent, 3×Rent); 3+ uses >= 3×Rent.
 */
const DLQ_ZERO_BALANCE = `CASE WHEN ${DT_BAL} <= 0 THEN 1 ELSE 0 END`;

const DLQ_LESS_THAN_ONE_MONTH = `CASE
  WHEN ${DELINQ_LT1_PRED}
  THEN 1 ELSE 0 END`;

const DLQ_ONE_TO_UNDER_THREE_MONTHS = `CASE
  WHEN ${DT_RENT} > 0 AND ${DT_BAL} >= ${DT_RENT} AND ${DT_BAL} < 3 * ${DT_RENT}
  THEN 1 ELSE 0 END`;

const DLQ_THREE_PLUS_MONTHS = `CASE
  WHEN ${DT_RENT} > 0 AND ${DT_BAL} >= 3 * ${DT_RENT}
  THEN 1 ELSE 0 END`;

const DLQ_IN_LEGAL = `CASE
  WHEN ${LEGAL_STATUS_NOT_BLANK}
    AND ${EFFECTIVE_LS_EXPR} <> N'Case Closed'
  THEN 1 ELSE 0 END`;

/** Legacy alert SQL when legal-case tables are not migrated yet. */
const LEGAL_STATUS_OPEN_LEGACY = `(
  dt.${LS} IS NULL
  OR LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) = N''
  OR LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) = N'Case Closed'
)`;

const LEGAL_STATUS_NOT_BLANK_LEGACY = `NOT (
  dt.${LS} IS NULL OR LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) = N''
)`;

const PAST_DUE_FOLLOWUP_LEGACY = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND NOT (${NF_BLANK})
    AND TRY_CONVERT(DATE, dt.${NF}) IS NOT NULL
    AND TRY_CONVERT(DATE, dt.${NF}) < CAST(GETDATE() AS DATE)
  THEN 1 ELSE 0
END`;

const DUE_TODAY_FOLLOWUP_LEGACY = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND NOT (${NF_BLANK})
    AND TRY_CONVERT(DATE, dt.${NF}) IS NOT NULL
    AND TRY_CONVERT(DATE, dt.${NF}) = CAST(GETDATE() AS DATE)
  THEN 1 ELSE 0
END`;

const REQUIRES_LEGAL_LEGACY = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND (
      (
        ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0) > ISNULL(TRY_CAST(cs.LegalAlertAmount AS DECIMAL(18,4)), 0)
        AND DAY(GETDATE()) > ISNULL(TRY_CAST(cs.LegalAlertDays AS INT), 9999)
      )
      OR (
        ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0)
          >= ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0)
             * ISNULL(TRY_CAST(cs.LegalAlertMonths AS DECIMAL(18,4)), 0)
      )
    )
    AND ${LEGAL_STATUS_OPEN_LEGACY}
  THEN 1 ELSE 0
END`;

const REMOVE_LEGAL_LEGACY = `CASE
  WHEN ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0) <= 0
    AND ${LEGAL_STATUS_NOT_BLANK_LEGACY}
    AND LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) <> N'Case Closed'
  THEN 1 ELSE 0
END`;

const DLQ_IN_LEGAL_LEGACY = `CASE
  WHEN ${LEGAL_STATUS_NOT_BLANK_LEGACY}
    AND LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) <> N'Case Closed'
  THEN 1 ELSE 0 END`;

function isMissingDbSchemaError(e) {
  const msg = String(e?.message || "");
  return /Invalid object name/i.test(msg) || /Invalid column name/i.test(msg);
}

function buildSummarySql(propScope, { legalCases, tenantFollowUp }) {
  const joins = legalCases ? LEGAL_CASE_JOINS : "";
  const missingCase = tenantFollowUp ? MISSING_TENANT_FOLLOWUP_CASE : "0";
  const pastDueTenant = tenantFollowUp ? PAST_DUE_TENANT_FOLLOWUP_CASE : "0";
  const pastDue = legalCases ? PAST_DUE_FOLLOWUP_CASE : PAST_DUE_FOLLOWUP_LEGACY;
  const dueToday = legalCases ? DUE_TODAY_FOLLOWUP_CASE : DUE_TODAY_FOLLOWUP_LEGACY;
  const requiresLegal = legalCases ? REQUIRES_LEGAL_CASE : REQUIRES_LEGAL_LEGACY;
  const removeLegal = legalCases ? REMOVE_LEGAL_CASE : REMOVE_LEGAL_LEGACY;
  const inLegal = legalCases ? DLQ_IN_LEGAL : DLQ_IN_LEGAL_LEGACY;
  return `
    SELECT
      po.Name AS portfolio,
      dt.${PR} AS property,
      SUM(ISNULL(CAST(dt.${B} AS DECIMAL(18,2)), 0)) AS collection,
      SUM(${missingCase}) AS alertsMissingTenantFollowUp,
      SUM(${pastDueTenant}) AS alertsPastDueTenantFollowUp,
      SUM(${pastDue}) AS alertsPastDueFollowUp,
      SUM(${dueToday}) AS alertsDueTodayFollowUp,
      SUM(${requiresLegal}) AS alertsRequiresLegal,
      SUM(${removeLegal}) AS alertsRemoveLegal,
      SUM(${DLQ_ZERO_BALANCE}) AS dq0,
      SUM(${DLQ_LESS_THAN_ONE_MONTH}) AS dqLt1,
      SUM(${DLQ_ONE_TO_UNDER_THREE_MONTHS}) AS dqMid,
      SUM(${DLQ_THREE_PLUS_MONTHS}) AS dq3p,
      SUM(${inLegal}) AS dqLeg,
      MAX(ISNULL(occ.occupiedUnits, 0)) AS occupiedUnits,
      SUM(CASE WHEN ${COLLECTION_LT1_PRED} THEN 1 ELSE 0 END) AS collectionLt1Count,
      SUM(
        CASE
          WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
            AND ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0)
              >= TRY_CAST(dt.${RT} AS DECIMAL(18,4))
          THEN 1 ELSE 0 END
      ) AS collectionGe1Count
    FROM DataTbl dt
    INNER JOIN dbo.Properties pr ON pr.CompanyId = dt.${CC}
      AND CAST(pr.Name AS NVARCHAR(400)) = CAST(dt.${PR} AS NVARCHAR(400))
    INNER JOIN dbo.Portfolios po ON po.Id = pr.PortfolioId AND po.CompanyId = dt.${CC}
    INNER JOIN dbo.Regions reg ON reg.Id = po.RegionId AND reg.CompanyId = dt.${CC}
    LEFT JOIN (
      SELECT
        d_occ.${CC} AS occCompanyId,
        LTRIM(RTRIM(CAST(d_occ.${PR} AS NVARCHAR(400)))) AS occPropNorm,
        COUNT_BIG(1) AS occupiedUnits
      FROM DataTbl d_occ
      WHERE d_occ.${CC} = @companyId
      GROUP BY d_occ.${CC}, LTRIM(RTRIM(CAST(d_occ.${PR} AS NVARCHAR(400))))
    ) occ ON occ.occCompanyId = dt.${CC}
      AND occ.occPropNorm = LTRIM(RTRIM(CAST(dt.${PR} AS NVARCHAR(400))))
    LEFT JOIN dbo.CompanyCollectionSettings cs ON cs.CompanyId = dt.${CC}
    ${joins}
    WHERE dt.${CC} = @companyId
      AND reg.Name = @region
      AND dt.${PR} IS NOT NULL
      ${propScope}
    GROUP BY po.Name, dt.${PR}
    HAVING po.Name IS NOT NULL AND dt.${PR} IS NOT NULL
    ORDER BY po.Name, dt.${PR}
  `;
}

async function getRegions(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const inputs = { companyId: { type: sql.Int, value: ctx.companyId } };
  let text;
  if (ctx.role === "super_admin" || ctx.role === "company_admin") {
    text = `
    SELECT Name AS value
    FROM dbo.Regions
    WHERE CompanyId = @companyId
      AND Name IS NOT NULL AND LTRIM(RTRIM(CAST(Name AS NVARCHAR(400)))) <> N''
    ORDER BY Name`;
  } else {
    text = `
    SELECT DISTINCT r.Name AS value
    FROM dbo.Regions r
    INNER JOIN dbo.Portfolios p ON p.RegionId = r.Id AND p.CompanyId = r.CompanyId
    INNER JOIN dbo.Properties pr ON pr.PortfolioId = p.Id AND pr.CompanyId = r.CompanyId
    WHERE r.CompanyId = @companyId
      AND r.Name IS NOT NULL AND LTRIM(RTRIM(CAST(r.Name AS NVARCHAR(400)))) <> N''
      ${propertiesTableScopeSql(ctx, inputs, "pr", "srPr")}
    ORDER BY r.Name`;
  }
  const result = await query(text, inputs);
  res.json({ regions: result.recordset.map((r) => r.value) });
}

async function getPortfolios(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;

  const region = req.query.region;
  if (!region) {
    return res.status(400).json({ error: "region is required" });
  }
  const inputs = {
    companyId: { type: sql.Int, value: ctx.companyId },
    region: { type: sql.NVarChar(400), value: region }
  };
  let text;
  if (ctx.role === "super_admin" || ctx.role === "company_admin") {
    text = `
    SELECT DISTINCT p.Name AS value
    FROM dbo.Portfolios p
    INNER JOIN dbo.Regions r ON r.Id = p.RegionId AND r.CompanyId = @companyId
    WHERE p.CompanyId = @companyId
      AND r.Name = @region
      AND p.Name IS NOT NULL AND LTRIM(RTRIM(CAST(p.Name AS NVARCHAR(400)))) <> N''
    ORDER BY value`;
  } else {
    text = `
    SELECT DISTINCT p.Name AS value
    FROM dbo.Portfolios p
    INNER JOIN dbo.Regions r ON r.Id = p.RegionId AND r.CompanyId = @companyId
    INNER JOIN dbo.Properties pr ON pr.PortfolioId = p.Id AND pr.CompanyId = @companyId
    WHERE p.CompanyId = @companyId
      AND r.Name = @region
      AND p.Name IS NOT NULL AND LTRIM(RTRIM(CAST(p.Name AS NVARCHAR(400)))) <> N''
      ${propertiesTableScopeSql(ctx, inputs, "pr", "spPr")}
    ORDER BY value`;
  }
  const result = await query(text, inputs);
  res.json({ portfolios: result.recordset.map((r) => r.value) });
}

async function getProperties(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;

  const region = req.query.region;
  const portfolio = req.query.portfolio;
  if (!region || !portfolio) {
    return res.status(400).json({ error: "region and portfolio are required" });
  }
  const inputs = {
    companyId: { type: sql.Int, value: ctx.companyId },
    region: { type: sql.NVarChar(400), value: region },
    portfolio: { type: sql.NVarChar(400), value: portfolio }
  };
  const scope =
    ctx.role === "super_admin" || ctx.role === "company_admin"
      ? ""
      : propertiesTableScopeSql(ctx, inputs, "pr", "gpPr");
  const text = `
    SELECT DISTINCT pr.Name AS value
    FROM dbo.Properties pr
    INNER JOIN dbo.Portfolios p ON p.Id = pr.PortfolioId AND p.CompanyId = @companyId
    INNER JOIN dbo.Regions r ON r.Id = p.RegionId AND r.CompanyId = @companyId
    WHERE pr.CompanyId = @companyId
      AND r.Name = @region
      AND p.Name = @portfolio
      AND pr.Name IS NOT NULL AND LTRIM(RTRIM(CAST(pr.Name AS NVARCHAR(400)))) <> N''
      ${scope}
    ORDER BY value
  `;
  const result = await query(text, inputs);
  res.json({ properties: result.recordset.map((r) => r.value) });
}

async function getSummary(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;

  const region = req.query.region;
  if (!region) {
    return res.status(400).json({ error: "region is required" });
  }
  const inputs = {
    companyId: { type: sql.Int, value: ctx.companyId },
    region: { type: sql.NVarChar(400), value: region }
  };
  const propScope = dataTblPropertyScopeSql(ctx, inputs);
  const summaryAttempts = [
    { legalCases: true, tenantFollowUp: true },
    { legalCases: false, tenantFollowUp: true },
    { legalCases: false, tenantFollowUp: false }
  ];
  let result;
  let lastErr;
  for (const opts of summaryAttempts) {
    try {
      result = await query(buildSummarySql(propScope, opts), inputs);
      break;
    } catch (e) {
      lastErr = e;
      if (!isMissingDbSchemaError(e)) throw e;
    }
  }
  if (!result) throw lastErr || new Error("Dashboard summary query failed");
  const byPortfolio = new Map();
  for (const row of result.recordset) {
    const key = row.portfolio;
    if (!byPortfolio.has(key)) byPortfolio.set(key, []);
    const occupied =
      Number(row.occupiedUnits ?? row.occupiedunits) || 0;
    const lt1 =
      Number(
        row.collectionLt1Count ??
          row.collectionlt1count ??
          row.CollectionLt1Count
      ) || 0;
    const ge1 =
      Number(
        row.collectionGe1Count ??
          row.collectionge1count ??
          row.CollectionGe1Count
      ) || 0;
    const denom = occupied > 0 ? occupied : lt1 + ge1;
    const lt1Pct = percentOf(lt1, denom);
    const ge1Pct = percentOf(ge1, denom);
    const missingTenantFu =
      Number(
        row.alertsMissingTenantFollowUp ??
          row.alertsmissingtenantfollowup ??
          row.AlertsMissingTenantFollowUp
      ) || 0;
    const pastDueTenantFu =
      Number(
        row.alertsPastDueTenantFollowUp ??
          row.alertspastduetenantfollowup ??
          row.AlertsPastDueTenantFollowUp
      ) || 0;
    const pastDueFu =
      Number(
        row.alertsPastDueFollowUp ??
          row.alertspastduefollowup ??
          row.AlertsPastDueFollowUp
      ) || 0;
    const dueTodayFu =
      Number(
        row.alertsDueTodayFollowUp ??
          row.alertsduetodayfollowup ??
          row.AlertsDueTodayFollowUp
      ) || 0;
    const requiresLegalN =
      Number(
        row.alertsRequiresLegal ??
          row.alertsrequireslegal ??
          row.AlertsRequiresLegal
      ) || 0;
    const removeLegalN =
      Number(
        row.alertsRemoveLegal ?? row.alertsremovelegal ?? row.AlertsRemoveLegal
      ) || 0;
    const dz = pickNum(
      row,
      "dq0",
      "DQ0",
      "delinquentZeroBalance",
      "DelinquentZeroBalance"
    );
    const dlt = pickNum(
      row,
      "dqLt1",
      "DQLT1",
      "delinquentLessThanOneMonth",
      "DelinquentLessThanOneMonth"
    );
    const d13 = pickNum(
      row,
      "dqMid",
      "DQMID",
      "delinquentOneToUnderThreeMonths",
      "DelinquentOneToUnderThreeMonths"
    );
    const d3p = pickNum(
      row,
      "dq3p",
      "DQ3P",
      "delinquentThreePlusMonths",
      "DelinquentThreePlusMonths"
    );
    const dleg = pickNum(row, "dqLeg", "DQLEG", "delinquentInLegal", "DelinquentInLegal");
    byPortfolio.get(key).push({
      property: row.property,
      collection: Number(row.collection) || 0,
      occupiedUnits: occupied,
      collectionLessThanOneMonth: { count: lt1, percent: lt1Pct },
      collectionOneMonthOrMore: { count: ge1, percent: ge1Pct },
      alerts: {
        missingTenantFollowUp: missingTenantFu,
        pastDueTenantFollowUp: pastDueTenantFu,
        pastDueFollowUp: pastDueFu,
        dueTodayFollowUp: dueTodayFu,
        requiresLegal: requiresLegalN,
        removeLegal: removeLegalN
      },
      delinquentBuckets: {
        zeroBalance: dz,
        lessThanOneMonth: dlt,
        /** UI label "1-2 Month": balance ≥ 1× rent and < 3× rent */
        oneToUnderThreeMonths: d13,
        threePlusMonths: d3p,
        inLegal: dleg
      }
    });
  }
  const portfolios = [...byPortfolio.entries()].map(([name, properties]) => ({
    name,
    properties
  }));
  res.json({ portfolios });
}

const UNIT_ALERT_FILTERS = new Set([
  "missingTenantFollowUp",
  "missingFollowUp",
  "pastDueTenantFollowUp",
  "pastDueFollowUp",
  "dueTodayFollowUp",
  "requiresLegal",
  "removeLegal"
]);

const UNIT_DELINQ_FILTERS = new Set([
  "zeroBalance",
  "lessThanOneMonth",
  "oneToUnderThreeMonths",
  "threePlusMonths",
  "inLegal"
]);

const MAX_UNITS_PROPERTIES = 50;

function dedupePropertyNames(names) {
  const seen = new Set();
  const out = [];
  for (const p of names) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Express often parses repeated keys (?properties=a&properties=b) incorrectly (scalar / last-only).
 * Reading the raw query string preserves every `properties` value (same as browser URLSearchParams).
 */
function getAllPropertiesFromRawQuery(req) {
  try {
    const u = req.originalUrl || req.url || "";
    const qi = u.indexOf("?");
    if (qi < 0) return [];
    return new URLSearchParams(u.slice(qi + 1))
      .getAll("properties")
      .map((p) => String(p).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parsePropertiesList(req) {
  const fromRepeated = dedupePropertyNames(getAllPropertiesFromRawQuery(req));
  if (fromRepeated.length > 0) return fromRepeated;

  const single = req.query.property != null ? String(req.query.property).trim() : "";
  const multi = req.query.properties;
  if (multi != null) {
    const arr = Array.isArray(multi) ? multi : [multi];
    const parsed = dedupePropertyNames(arr.map((p) => String(p).trim()).filter(Boolean));
    if (parsed.length > 0) return parsed;
  }
  if (single) return [single];
  return [];
}

function buildUnitsQueryText(
  opts,
  {
    inPlaceholders,
    nameSearch,
    unitSearch,
    legalStatus,
    collection,
    alert,
    delinq
  }
) {
  const { legalCases, tenantFollowUp } = opts;
  const joins = legalCases ? LEGAL_CASE_JOINS : "";
  const tfSelect = tenantFollowUp
    ? `dt.${TF} AS tenantFollowUp,`
    : `CAST(NULL AS DATETIME2) AS tenantFollowUp,`;
  const pastDue = legalCases ? PAST_DUE_FOLLOWUP_CASE : PAST_DUE_FOLLOWUP_LEGACY;
  const dueToday = legalCases ? DUE_TODAY_FOLLOWUP_CASE : DUE_TODAY_FOLLOWUP_LEGACY;
  const requiresLegal = legalCases ? REQUIRES_LEGAL_CASE : REQUIRES_LEGAL_LEGACY;
  const removeLegal = legalCases ? REMOVE_LEGAL_CASE : REMOVE_LEGAL_LEGACY;
  const inLegalFilter = legalCases
    ? `${LEGAL_STATUS_NOT_BLANK} AND ${EFFECTIVE_LS_EXPR} <> N'Case Closed'`
    : `${LEGAL_STATUS_NOT_BLANK_LEGACY}
      AND LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) <> N'Case Closed'`;

  let text = `
    SELECT
      dt.${PR} AS property,
      dt.${U} AS unit,
      dt.${N} AS name,
      dt.${B} AS balance,
      dt.${RT} AS rent,
      ${MD_EXPR} AS monthsDelinquent,
      dt.${LS} AS legalStatus,
      dt.${NF} AS nextFollowUp,
      ${tfSelect}
      dt.${LPD} AS lastPaymentDate,
      dt.${LPA} AS lastPaymentAmount,
      dt.${PH} AS phone,
      dt.${EM} AS email,
      NULLIF(LTRIM(RTRIM(CAST(dt.[TenantCode] AS NVARCHAR(400)))), N'') AS tenantCode,
      NULLIF(LTRIM(RTRIM(CAST(dt.${HP} AS NVARCHAR(400)))), N'') AS hmyperson,
      (SELECT TOP 1 CAST(csErp.ErpStaticLink AS NVARCHAR(2000))
       FROM dbo.CompanyCollectionSettings csErp
       WHERE csErp.CompanyId = @companyId) AS companyErpStaticLink
    FROM dbo.DataTbl dt
    LEFT JOIN dbo.CompanyCollectionSettings cs ON cs.CompanyId = dt.${CC}
    ${joins}
    WHERE dt.${CC} = @companyId AND dt.${PR} IN (${inPlaceholders})
  `;

  if (nameSearch) {
    text += ` AND CAST(dt.${N} AS NVARCHAR(400)) LIKE @namePat`;
  }
  if (unitSearch) {
    text += ` AND CAST(dt.${U} AS NVARCHAR(400)) LIKE @unitPat`;
  }
  if (legalStatus) {
    text += ` AND dt.${LS} = @legalStatus`;
  }

  if (collection === "lt1") {
    text += ` AND ${COLLECTION_LT1}`;
  } else if (collection === "ge1") {
    text += ` AND ${COLLECTION_GE1}`;
  } else if ((alert === "missingTenantFollowUp" || alert === "missingFollowUp") && tenantFollowUp) {
    text += ` AND (${MISSING_TENANT_FOLLOWUP_CASE}) = 1`;
  } else if (alert === "pastDueTenantFollowUp" && tenantFollowUp) {
    text += ` AND (${PAST_DUE_TENANT_FOLLOWUP_CASE}) = 1`;
  } else if (alert === "pastDueFollowUp") {
    text += ` AND (${pastDue}) = 1`;
  } else if (alert === "dueTodayFollowUp") {
    text += ` AND (${dueToday}) = 1`;
  } else if (alert === "requiresLegal") {
    text += ` AND (${requiresLegal}) = 1`;
  } else if (alert === "removeLegal") {
    text += ` AND (${removeLegal}) = 1`;
  } else if (delinq === "zeroBalance") {
    text += ` AND ${DT_BAL} <= 0`;
  } else if (delinq === "lessThanOneMonth") {
    text += ` AND ${DELINQ_LT1}`;
  } else if (delinq === "oneToUnderThreeMonths") {
    text += ` AND ${DT_RENT} > 0 AND ${DT_BAL} >= ${DT_RENT} AND ${DT_BAL} < 3 * ${DT_RENT}`;
  } else if (delinq === "threePlusMonths") {
    text += ` AND ${DT_RENT} > 0 AND ${DT_BAL} >= 3 * ${DT_RENT}`;
  } else if (delinq === "inLegal") {
    text += ` AND ${inLegalFilter}`;
  }

  text += ` ORDER BY dt.${PR}, dt.${U}, dt.${N}`;
  return text;
}

async function getUnits(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;

  const propertyNames = parsePropertiesList(req);
  if (propertyNames.length === 0) {
    return res.status(400).json({ error: "property or properties is required" });
  }
  if (propertyNames.length > MAX_UNITS_PROPERTIES) {
    return res.status(400).json({ error: `At most ${MAX_UNITS_PROPERTIES} properties per request` });
  }
  const companyId = ctx.companyId;
  const allowed = intersectRequestedProperties(ctx, propertyNames);
  if (allowed.length === 0) {
    return res.status(403).json({ error: "No access to the requested properties." });
  }
  const nameSearch = req.query.name ? String(req.query.name).trim() : "";
  const unitSearch = req.query.unit ? String(req.query.unit).trim() : "";
  const legalStatus = req.query.legalStatus ? String(req.query.legalStatus).trim() : "";
  const collectionRaw = req.query.collection ? String(req.query.collection).trim().toLowerCase() : "";
  const collection =
    collectionRaw === "lt1" || collectionRaw === "ge1" ? collectionRaw : "";
  const alertRaw = req.query.alert ? String(req.query.alert).trim() : "";
  const alert = UNIT_ALERT_FILTERS.has(alertRaw) ? alertRaw : "";
  const delinqRaw = req.query.delinq ? String(req.query.delinq).trim() : "";
  const delinq = UNIT_DELINQ_FILTERS.has(delinqRaw) ? delinqRaw : "";

  const inPlaceholders = allowed.map((_, i) => `@prop${i}`).join(", ");
  const inputs = { companyId: { type: sql.Int, value: companyId } };
  allowed.forEach((name, i) => {
    inputs[`prop${i}`] = { type: sql.NVarChar(400), value: name };
  });
  if (nameSearch) {
    inputs.namePat = { type: sql.NVarChar(400), value: `%${nameSearch}%` };
  }
  if (unitSearch) {
    inputs.unitPat = { type: sql.NVarChar(400), value: `%${unitSearch}%` };
  }
  if (legalStatus) {
    inputs.legalStatus = { type: sql.NVarChar(400), value: legalStatus };
  }

  const filterCtx = {
    inPlaceholders,
    nameSearch,
    unitSearch,
    legalStatus,
    collection,
    alert,
    delinq
  };
  const unitAttempts = [
    { legalCases: true, tenantFollowUp: true },
    { legalCases: false, tenantFollowUp: true },
    { legalCases: false, tenantFollowUp: false }
  ];
  let result;
  let lastErr;
  for (const opts of unitAttempts) {
    try {
      const text = buildUnitsQueryText(opts, filterCtx);
      result = await query(text, inputs);
      break;
    } catch (e) {
      lastErr = e;
      if (!isMissingDbSchemaError(e)) throw e;
    }
  }
  if (!result) throw lastErr || new Error("Units query failed");
  const rows = result.recordset || [];

  function pickCompanyErpStaticLink(row) {
    if (!row || typeof row !== "object") return null;
    const direct = row.companyErpStaticLink ?? row.CompanyErpStaticLink;
    if (direct != null && String(direct).trim() !== "") return String(direct).trim();
    const k = Object.keys(row).find((x) => x.toLowerCase() === "companyerpstaticlink");
    if (k !== undefined && row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
    return null;
  }

  let erpStaticLink = pickCompanyErpStaticLink(rows[0]) || null;
  const units = rows.map((row) => {
    const copy = { ...row };
    for (const key of Object.keys(copy)) {
      if (key.toLowerCase() === "companyerpstaticlink") delete copy[key];
    }
    const tcKey = Object.keys(copy).find((x) => x.toLowerCase() === "tenantcode");
    if (tcKey !== undefined) {
      const v = copy[tcKey];
      copy.tenantCode = v == null || v === "" ? null : String(v).trim();
      for (const key of Object.keys(copy)) {
        if (key.toLowerCase() === "tenantcode" && key !== "tenantCode") delete copy[key];
      }
    }
    const hpKey = Object.keys(copy).find((x) => x.toLowerCase().replace(/[\s_]/g, "") === "hmyperson");
    if (hpKey !== undefined) {
      const v = copy[hpKey];
      copy.hmyperson = v == null || v === "" ? null : String(v).trim();
      for (const key of Object.keys(copy)) {
        if (key.toLowerCase().replace(/[\s_]/g, "") === "hmyperson" && key !== "hmyperson") delete copy[key];
      }
    }
    const tfKey = Object.keys(copy).find((x) => x.toLowerCase().replace(/[\s_]/g, "") === "tenantfollowup");
    if (tfKey !== undefined) {
      const v = copy[tfKey];
      if (v instanceof Date) copy.tenantFollowUp = v.toISOString();
      else copy.tenantFollowUp = v == null || v === "" ? null : v;
      for (const key of Object.keys(copy)) {
        if (key.toLowerCase().replace(/[\s_]/g, "") === "tenantfollowup" && key !== "tenantFollowUp") {
          delete copy[key];
        }
      }
    }
    const phoneKey = Object.keys(copy).find(
      (x) =>
        x.toLowerCase().replace(/[\s_]/g, "") === "phone" ||
        x.toLowerCase().replace(/[\s_]/g, "") === "phomenumber"
    );
    if (phoneKey !== undefined) {
      const v = copy[phoneKey];
      copy.phone = v == null || v === "" ? null : String(v).trim();
      for (const key of Object.keys(copy)) {
        const norm = key.toLowerCase().replace(/[\s_]/g, "");
        if ((norm === "phone" || norm === "phomenumber") && key !== "phone") delete copy[key];
      }
    }
    return copy;
  });

  if (!erpStaticLink) {
    try {
      const erpRes = await query(
        `SELECT ErpStaticLink AS erpStaticLink FROM dbo.CompanyCollectionSettings WHERE CompanyId = @companyId`,
        { companyId: { type: sql.Int, value: companyId } }
      );
      const row = erpRes.recordset[0];
      const raw = row
        ? row.erpStaticLink ?? row.ErpStaticLink ?? row.erpstaticlink
        : null;
      if (raw != null && String(raw).trim() !== "") erpStaticLink = String(raw).trim();
    } catch {
      /* optional: table/column missing */
    }
  }

  /** Overlay: each row's legalStatus is replaced with the latest status from the latest OPEN
   *  legal case for that tenant identity. Rows with no open case have legalStatus cleared so the
   *  column reflects the case-management state, not stale legacy DataTbl values.
   *  Silently skipped when the new tables don't exist. */
  if (units.length > 0) {
    try {
      const overlayInputs = { companyId: { type: sql.Int, value: companyId } };
      allowed.forEach((name, i) => {
        overlayInputs[`overlayProp${i}`] = { type: sql.NVarChar(400), value: name };
      });
      const overlayPlaceholders = allowed.map((_, i) => `@overlayProp${i}`).join(", ");
      const overlayRes = await query(
        `SELECT PropertyName, Unit, TenantName, LatestStatus
         FROM (
           SELECT lc.PropertyName, lc.Unit, lc.TenantName, lcs.Status AS LatestStatus,
                  ROW_NUMBER() OVER (
                    PARTITION BY lc.PropertyName, lc.Unit, lc.TenantName
                    ORDER BY lc.CreatedAt DESC, lc.Id DESC
                  ) AS rn
           FROM dbo.UnitLegalCase lc
           OUTER APPLY (
             SELECT TOP 1 Status FROM dbo.UnitLegalCaseStatus
             WHERE CaseId = lc.Id ORDER BY ChangedAt DESC, Id DESC
           ) lcs
           WHERE lc.CompanyId = @companyId
             AND lc.IsClosed = 0
             AND lc.PropertyName IN (${overlayPlaceholders})
         ) a
         WHERE a.rn = 1`,
        overlayInputs
      );
      const key = (p, u, n) =>
        `${String(p ?? "").trim().toLowerCase()}|${String(u ?? "").trim().toLowerCase()}|${String(n ?? "").trim().toLowerCase()}`;
      const overlayMap = new Map();
      for (const r of overlayRes.recordset || []) {
        const k = key(r.PropertyName, r.Unit, r.TenantName);
        const ls = r.LatestStatus == null ? "" : String(r.LatestStatus).trim();
        overlayMap.set(k, ls);
      }
      for (const u of units) {
        const k = key(u.property, u.unit, u.name);
        u.legalStatus = overlayMap.has(k) ? overlayMap.get(k) : "";
      }
    } catch (e) {
      if (!/Invalid object name/i.test(String(e?.message || ""))) throw e;
      /* tables not yet migrated; just keep the legacy legalStatus values */
    }
  }

  /** Open legal case count per tenant (for Legal Status column). Silently skipped if table missing. */
  for (const u of units) {
    u.openLegalCaseCount = 0;
  }
  if (units.length > 0) {
    try {
      const cntInputs = { companyId: { type: sql.Int, value: companyId } };
      allowed.forEach((name, i) => {
        cntInputs[`cntProp${i}`] = { type: sql.NVarChar(400), value: name };
      });
      const cntPlaceholders = allowed.map((_, i) => `@cntProp${i}`).join(", ");
      const cntRes = await query(
        `SELECT PropertyName, Unit, TenantName, TenantCode, COUNT(*) AS OpenCaseCount
         FROM dbo.UnitLegalCase
         WHERE CompanyId = @companyId
           AND IsClosed = 0
           AND PropertyName IN (${cntPlaceholders})
         GROUP BY PropertyName, Unit, TenantName, TenantCode`,
        cntInputs
      );
      const idKey = (p, u, n) =>
        `${String(p ?? "").trim().toLowerCase()}|${String(u ?? "").trim().toLowerCase()}|${String(n ?? "").trim().toLowerCase()}`;
      function idKeyTenant(p, u, n, tc) {
        const base = idKey(p, u, n);
        const t =
          tc == null || String(tc).trim() === ""
            ? "__NULL__"
            : String(tc).trim().toLowerCase();
        return `${base}|${t}`;
      }
      const countMap = new Map();
      for (const r of cntRes.recordset || []) {
        const k = idKeyTenant(r.PropertyName, r.Unit, r.TenantName, r.TenantCode);
        countMap.set(k, Number(r.OpenCaseCount ?? r.opencasecount ?? 0) || 0);
      }
      for (const u of units) {
        const k = idKeyTenant(u.property, u.unit, u.name, u.tenantCode);
        u.openLegalCaseCount = countMap.get(k) ?? 0;
      }
    } catch (e) {
      if (!/Invalid object name/i.test(String(e?.message || ""))) throw e;
    }
  }

  /** Overlay: `nextFollowUp` shown is the earliest of (a) DataTbl NextFollowUp (unit workspace /
   *  schedule) and (b) MIN(FollowUpAt) on open legal cases for that tenant, so dashboard dates
   *  and legal-case dates both surface. */
  if (units.length > 0) {
    try {
      const fuInputs = { companyId: { type: sql.Int, value: companyId } };
      allowed.forEach((name, i) => {
        fuInputs[`fuProp${i}`] = { type: sql.NVarChar(400), value: name };
      });
      const fuPlaceholders = allowed.map((_, i) => `@fuProp${i}`).join(", ");
      const fuRes = await query(
        `SELECT PropertyName, Unit, TenantName, MIN(FollowUpAt) AS NextFollowUp
         FROM dbo.UnitLegalCase
         WHERE CompanyId = @companyId
           AND IsClosed = 0
           AND FollowUpAt IS NOT NULL
           AND PropertyName IN (${fuPlaceholders})
         GROUP BY PropertyName, Unit, TenantName`,
        fuInputs
      );
      const key = (p, u, n) =>
        `${String(p ?? "").trim().toLowerCase()}|${String(u ?? "").trim().toLowerCase()}|${String(n ?? "").trim().toLowerCase()}`;
      const fuMap = new Map();
      for (const r of fuRes.recordset || []) {
        const k = key(r.PropertyName, r.Unit, r.TenantName);
        const iso = r.NextFollowUp instanceof Date
          ? r.NextFollowUp.toISOString()
          : (r.NextFollowUp ?? null);
        if (iso) fuMap.set(k, iso);
      }
      for (const u of units) {
        const k = key(u.property, u.unit, u.name);
        const legalIso = fuMap.get(k);
        const dtMs = nextFollowUpToMillis(u.nextFollowUp);
        const legalMs = legalIso ? nextFollowUpToMillis(legalIso) : null;
        const candidates = [];
        if (dtMs != null) candidates.push(dtMs);
        if (legalMs != null) candidates.push(legalMs);
        if (candidates.length === 0) {
          u.nextFollowUp = null;
        } else {
          u.nextFollowUp = new Date(Math.min(...candidates)).toISOString();
        }
      }
    } catch (e) {
      if (!/Invalid object name/i.test(String(e?.message || ""))) throw e;
      /* legal cases table not yet migrated; keep legacy nextFollowUp values */
    }
  }

  /** Overlay: each row's `note` is the latest manual UnitDetailNote body for that tenant identity.
   *  Auto notes (e.g. email-send logs) are intentionally ignored here. Silently skipped if the
   *  notes table doesn't exist. */
  if (units.length > 0) {
    try {
      const noteInputs = { companyId: { type: sql.Int, value: companyId } };
      allowed.forEach((name, i) => {
        noteInputs[`noteProp${i}`] = { type: sql.NVarChar(400), value: name };
      });
      const notePlaceholders = allowed.map((_, i) => `@noteProp${i}`).join(", ");
      const noteRes = await query(
        `SELECT PropertyName, Unit, TenantName, Body, CreatedAt
         FROM (
           SELECT n.PropertyName, n.Unit, n.TenantName, n.Body, n.CreatedAt,
                  ROW_NUMBER() OVER (
                    PARTITION BY n.PropertyName, n.Unit, n.TenantName
                    ORDER BY n.CreatedAt DESC, n.Id DESC
                  ) AS rn
           FROM dbo.UnitDetailNote n
           WHERE n.CompanyId = @companyId
             AND n.PropertyName IN (${notePlaceholders})
             AND LOWER(CAST(ISNULL(n.NoteSource, N'manual') AS NVARCHAR(16))) = N'manual'
         ) a
         WHERE a.rn = 1`,
        noteInputs
      );
      const key = (p, u, n) =>
        `${String(p ?? "").trim().toLowerCase()}|${String(u ?? "").trim().toLowerCase()}|${String(n ?? "").trim().toLowerCase()}`;
      const noteMap = new Map();
      for (const r of noteRes.recordset || []) {
        const k = key(r.PropertyName, r.Unit, r.TenantName);
        const body = r.Body == null ? "" : String(r.Body);
        const rawAt = r.CreatedAt ?? r.createdAt;
        const createdAt =
          rawAt instanceof Date
            ? rawAt.toISOString()
            : rawAt == null || rawAt === ""
              ? null
              : String(rawAt);
        noteMap.set(k, { body, createdAt });
      }
      for (const u of units) {
        const k = key(u.property, u.unit, u.name);
        if (noteMap.has(k)) {
          const entry = noteMap.get(k);
          u.note = entry.body;
          u.noteAt = entry.createdAt;
        } else {
          u.note = "";
          u.noteAt = null;
        }
      }
    } catch (e) {
      if (!/Invalid object name/i.test(String(e?.message || ""))) throw e;
      /* notes table not yet migrated; just leave note empty */
    }
  }

  res.json({ units, erpStaticLink });
}

function tenantCodeMatchSql() {
  return `AND (
    (@tenantCode IS NULL OR LTRIM(RTRIM(CAST(@tenantCode AS NVARCHAR(400)))) = N'')
      AND (dt.${TC} IS NULL OR LTRIM(RTRIM(CAST(dt.${TC} AS NVARCHAR(400)))) = N'')
    OR (
      @tenantCode IS NOT NULL AND LTRIM(RTRIM(CAST(@tenantCode AS NVARCHAR(400)))) <> N''
      AND LTRIM(RTRIM(CAST(dt.${TC} AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(@tenantCode AS NVARCHAR(400))))
    )
  )`;
}

function baseRowInputs(companyId, property, unit, name, tenantCode) {
  const tc = tenantCode != null ? String(tenantCode).trim() : "";
  return {
    companyId: { type: sql.Int, value: companyId },
    property: { type: sql.NVarChar(400), value: String(property ?? "").trim() },
    unit: { type: sql.NVarChar(400), value: String(unit ?? "").trim() },
    name: { type: sql.NVarChar(400), value: String(name ?? "").trim() },
    tenantCode: { type: sql.NVarChar(200), value: tc === "" ? null : tc }
  };
}

async function patchUnitRow(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;

  const b = req.body || {};
  const property = b.property != null ? String(b.property).trim() : "";
  const unit = b.unit != null ? String(b.unit).trim() : "";
  const name = b.name != null ? String(b.name).trim() : "";
  if (!property || !unit || !name) {
    return res.status(400).json({ error: "property, unit, and name are required" });
  }
  if (!memberCanAccessProperty(ctx, property)) {
    return res.status(403).json({ error: "No access to this property." });
  }

  const hasNf = Object.prototype.hasOwnProperty.call(b, "nextFollowUp");
  const hasTf = Object.prototype.hasOwnProperty.call(b, "tenantFollowUp");
  const hasLs = Object.prototype.hasOwnProperty.call(b, "legalStatus");
  if (!hasNf && !hasTf && !hasLs) {
    return res.status(400).json({ error: "Provide nextFollowUp, tenantFollowUp, and/or legalStatus" });
  }

  const inputs = baseRowInputs(companyId, property, unit, name, b.tenantCode);
  const tmatch = tenantCodeMatchSql();

  let oldLegal = null;
  if (hasLs) {
    const cur = await query(
      `SELECT TOP 1 CAST(dt.${LS} AS NVARCHAR(400)) AS ls
       FROM dbo.DataTbl dt
       WHERE dt.${CC} = @companyId AND dt.${PR} = @property AND dt.${U} = @unit AND dt.${N} = @name ${tmatch}`,
      inputs
    );
    oldLegal = cur.recordset[0]?.ls != null ? String(cur.recordset[0].ls) : "";
  }

  const sets = [];
  if (hasNf) {
    const v = b.nextFollowUp;
    if (v === null || v === "") {
      sets.push(`dt.${NF} = NULL`);
    } else {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "nextFollowUp must be a valid date or empty" });
      }
      sets.push(`dt.${NF} = @nextFollowUp`);
      inputs.nextFollowUp = { type: sql.DateTime2, value: d };
    }
  }
  if (hasTf) {
    const v = b.tenantFollowUp;
    if (v === null || v === "") {
      sets.push(`dt.${TF} = NULL`);
    } else {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "tenantFollowUp must be a valid date or empty" });
      }
      sets.push(`dt.${TF} = @tenantFollowUp`);
      inputs.tenantFollowUp = { type: sql.DateTime2, value: d };
    }
  }
  if (hasLs) {
    const ls = b.legalStatus === null || b.legalStatus === "" ? null : String(b.legalStatus).trim().slice(0, 400);
    sets.push(`dt.${LS} = @legalStatus`);
    inputs.legalStatus = { type: sql.NVarChar(400), value: ls };
  }

  const setSql = sets.join(", ");
  const result = await query(
    `UPDATE dt SET ${setSql}
     FROM dbo.DataTbl dt
     WHERE dt.${CC} = @companyId AND dt.${PR} = @property AND dt.${U} = @unit AND dt.${N} = @name ${tmatch}`,
    inputs
  );
  const n = result.rowsAffected != null ? result.rowsAffected[0] : 0;
  if (!n) {
    return res.status(404).json({ error: "No matching unit row (check property, unit, name, tenant code)" });
  }

  if (hasLs) {
    const newLs = b.legalStatus === null || b.legalStatus === "" ? "" : String(b.legalStatus).trim();
    const oldStr = oldLegal != null ? String(oldLegal) : "";
    if (oldStr !== newLs) {
      try {
        await query(
          `INSERT INTO dbo.UnitLegalStatusHistory (
             CompanyId, PropertyName, Unit, TenantName, TenantCode, OldStatus, NewStatus
           ) VALUES (
             @companyId, @property, @unit, @name, @tenantCodeHist, @oldStatus, @newStatus
           )`,
          {
            companyId: inputs.companyId,
            property: inputs.property,
            unit: inputs.unit,
            name: inputs.name,
            tenantCodeHist: {
              type: sql.NVarChar(200),
              value:
                inputs.tenantCode && inputs.tenantCode.value != null && String(inputs.tenantCode.value).trim() !== ""
                  ? String(inputs.tenantCode.value).trim()
                  : null
            },
            oldStatus: { type: sql.NVarChar(400), value: oldStr || null },
            newStatus: { type: sql.NVarChar(400), value: newLs || "" }
          }
        );
      } catch (e) {
        if (!/Invalid object name/i.test(String(e?.message || ""))) throw e;
      }
    }
  }

  res.json({ ok: true });
}

async function getUnitNotes(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;
  const property = req.query.property ? String(req.query.property).trim() : "";
  const unit = req.query.unit ? String(req.query.unit).trim() : "";
  const name = req.query.name ? String(req.query.name).trim() : "";
  if (!property || !unit || !name) {
    return res.status(400).json({ error: "property, unit, and name query params are required" });
  }
  if (!memberCanAccessProperty(ctx, property)) {
    return res.status(403).json({ error: "No access to this property." });
  }
  const inputs = baseRowInputs(companyId, property, unit, name, req.query.tenantCode);
  inputs.tenantCodeQ = inputs.tenantCode;
  delete inputs.tenantCode;

  try {
    const result = await query(
      `SELECT Id, Body, IsPinned, IsHighlighted, CreatedAt, CreatedByName, NoteSource
       FROM dbo.UnitDetailNote
       WHERE CompanyId = @companyId AND PropertyName = @property AND Unit = @unit AND TenantName = @name
         AND (
           (@tenantCodeQ IS NULL OR LTRIM(RTRIM(CAST(@tenantCodeQ AS NVARCHAR(400)))) = N'')
             AND (TenantCode IS NULL OR LTRIM(RTRIM(CAST(TenantCode AS NVARCHAR(400)))) = N'')
           OR (
             @tenantCodeQ IS NOT NULL AND LTRIM(RTRIM(CAST(@tenantCodeQ AS NVARCHAR(400)))) <> N''
             AND LTRIM(RTRIM(CAST(TenantCode AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(@tenantCodeQ AS NVARCHAR(400))))
           )
         )
       ORDER BY IsPinned DESC, CreatedAt DESC`,
      inputs
    );
    const notes = (result.recordset || []).map((r) => ({
      id: r.Id ?? r.id,
      body: r.Body ?? r.body ?? "",
      isPinned: Boolean(r.IsPinned ?? r.isPinned),
      isHighlighted: Boolean(r.IsHighlighted ?? r.isHighlighted),
      createdByName: r.CreatedByName != null ? String(r.CreatedByName).trim() : "",
      noteSource: String(r.NoteSource ?? r.noteSource ?? "manual").toLowerCase() === "auto" ? "auto" : "manual",
      createdAt:
        r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : r.CreatedAt != null ? String(r.CreatedAt) : null
    }));
    res.json({ notes });
  } catch (err) {
    if (/Invalid object name/i.test(String(err?.message || ""))) {
      return res.json({ notes: [] });
    }
    if (/NoteSource/i.test(String(err?.message || "")) && /Invalid column name/i.test(String(err?.message || ""))) {
      return res.status(503).json({
        error: "Run backend/scripts/migrate-unit-detail-note-source.sql on the database."
      });
    }
    throw err;
  }
}

async function postUnitNote(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;
  const b = req.body || {};
  const property = b.property != null ? String(b.property).trim() : "";
  const unit = b.unit != null ? String(b.unit).trim() : "";
  const name = b.name != null ? String(b.name).trim() : "";
  const bodyText = b.body != null ? String(b.body).trim() : "";
  if (!property || !unit || !name || !bodyText) {
    return res.status(400).json({ error: "property, unit, name, and body are required" });
  }
  if (!memberCanAccessProperty(ctx, property)) {
    return res.status(403).json({ error: "No access to this property." });
  }
  if (bodyText.length > 4000) {
    return res.status(400).json({ error: "body is too long (max 4000)" });
  }
  const inputs = baseRowInputs(companyId, property, unit, name, b.tenantCode);
  inputs.body = { type: sql.NVarChar(4000), value: bodyText };
  inputs.isPinned = { type: sql.Bit, value: Boolean(b.isPinned) };
  inputs.isHighlighted = { type: sql.Bit, value: Boolean(b.isHighlighted) };
  const authorRaw = b.createdByName != null ? String(b.createdByName).trim() : "";
  const author = authorRaw.slice(0, 256);
  inputs.createdByName = { type: sql.NVarChar(256), value: author === "" ? null : author };
  let noteSource = b.noteSource != null ? String(b.noteSource).trim().toLowerCase() : "manual";
  if (noteSource !== "manual" && noteSource !== "auto") noteSource = "manual";
  inputs.noteSource = { type: sql.NVarChar(16), value: noteSource };

  try {
    const result = await query(
      `INSERT INTO dbo.UnitDetailNote (
         CompanyId, PropertyName, Unit, TenantName, TenantCode, Body, IsPinned, IsHighlighted, CreatedByName, NoteSource
       ) OUTPUT INSERTED.Id, INSERTED.Body, INSERTED.IsPinned, INSERTED.IsHighlighted, INSERTED.CreatedAt, INSERTED.CreatedByName, INSERTED.NoteSource
       VALUES (
         @companyId, @property, @unit, @name,
         CASE WHEN @tenantCode IS NULL OR LTRIM(RTRIM(CAST(@tenantCode AS NVARCHAR(400)))) = N'' THEN NULL ELSE LTRIM(RTRIM(CAST(@tenantCode AS NVARCHAR(400)))) END,
         @body, @isPinned, @isHighlighted, @createdByName, @noteSource
       )`,
      inputs
    );
    const r = result.recordset[0];
    res.status(201).json({
      note: {
        id: r.Id ?? r.id,
        body: r.Body ?? r.body,
        isPinned: Boolean(r.IsPinned ?? r.isPinned),
        isHighlighted: Boolean(r.IsHighlighted ?? r.isHighlighted),
        createdByName: r.CreatedByName != null ? String(r.CreatedByName).trim() : "",
        noteSource: String(r.NoteSource ?? r.noteSource ?? "manual").toLowerCase() === "auto" ? "auto" : "manual",
        createdAt: r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt)
      }
    });
  } catch (err) {
    if (/Invalid object name/i.test(String(err?.message || ""))) {
      return res.status(503).json({
        error: "Run backend/scripts/migrate-unit-detail-row-extras.sql on the database."
      });
    }
    if (/CreatedByName/i.test(String(err?.message || "")) && /Invalid column name/i.test(String(err?.message || ""))) {
      return res.status(503).json({
        error: "Run backend/scripts/migrate-unit-detail-note-author.sql on the database (adds note author column)."
      });
    }
    if (/NoteSource/i.test(String(err?.message || "")) && /Invalid column name/i.test(String(err?.message || ""))) {
      return res.status(503).json({
        error: "Run backend/scripts/migrate-unit-detail-note-source.sql on the database (adds note source column)."
      });
    }
    throw err;
  }
}

async function patchUnitNote(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid note id" });
  }
  const b = req.body || {};
  const inputs = { id: { type: sql.Int, value: id }, companyId: { type: sql.Int, value: companyId } };
  const pre = await query(
    `SELECT PropertyName AS pn, CAST(NoteSource AS NVARCHAR(16)) AS src
     FROM dbo.UnitDetailNote WHERE Id = @id AND CompanyId = @companyId`,
    inputs
  );
  const row0 = pre.recordset[0];
  const pn = row0?.pn ?? row0?.Pn;
  if (pn == null) {
    return res.status(404).json({ error: "not found" });
  }
  if (!memberCanAccessProperty(ctx, pn)) {
    return res.status(403).json({ error: "No access to this note." });
  }

  const sets = [];
  if (Object.prototype.hasOwnProperty.call(b, "isPinned")) {
    sets.push("IsPinned = @isPinned");
    inputs.isPinned = { type: sql.Bit, value: Boolean(b.isPinned) };
  }
  if (Object.prototype.hasOwnProperty.call(b, "isHighlighted")) {
    sets.push("IsHighlighted = @isHighlighted");
    inputs.isHighlighted = { type: sql.Bit, value: Boolean(b.isHighlighted) };
  }
  if (Object.prototype.hasOwnProperty.call(b, "body")) {
    const src = String(row0?.src ?? "manual").toLowerCase();
    if (src === "auto") {
      return res.status(400).json({ error: "Automatic notes cannot be edited" });
    }
    const t = b.body != null ? String(b.body).trim() : "";
    if (!t) {
      return res.status(400).json({ error: "body cannot be empty" });
    }
    if (t.length > 4000) {
      return res.status(400).json({ error: "body is too long (max 4000)" });
    }
    sets.push("Body = @body");
    inputs.body = { type: sql.NVarChar(4000), value: t };
  }
  if (!sets.length) {
    return res.status(400).json({ error: "Provide body, isPinned, and/or isHighlighted" });
  }

  const result = await query(
    `UPDATE dbo.UnitDetailNote SET ${sets.join(", ")}
     OUTPUT INSERTED.Id, INSERTED.Body, INSERTED.IsPinned, INSERTED.IsHighlighted, INSERTED.CreatedAt, INSERTED.CreatedByName, INSERTED.NoteSource
     WHERE Id = @id AND CompanyId = @companyId`,
    inputs
  );
  if (!result.recordset?.length) {
    return res.status(404).json({ error: "not found" });
  }
  const r = result.recordset[0];
  res.json({
    note: {
      id: r.Id ?? r.id,
      body: r.Body ?? r.body,
      isPinned: Boolean(r.IsPinned ?? r.isPinned),
      isHighlighted: Boolean(r.IsHighlighted ?? r.isHighlighted),
      createdByName: r.CreatedByName != null ? String(r.CreatedByName).trim() : "",
      noteSource: String(r.NoteSource ?? r.noteSource ?? "manual").toLowerCase() === "auto" ? "auto" : "manual",
      createdAt: r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt)
    }
  });
}

async function deleteUnitNote(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid note id" });
  }
  const inputs = { id: { type: sql.Int, value: id }, companyId: { type: sql.Int, value: companyId } };
  const pre = await query(
    `SELECT PropertyName AS pn, CAST(NoteSource AS NVARCHAR(16)) AS src
     FROM dbo.UnitDetailNote WHERE Id = @id AND CompanyId = @companyId`,
    inputs
  );
  const row0 = pre.recordset[0];
  const pn = row0?.pn ?? row0?.Pn;
  if (pn == null) {
    return res.status(404).json({ error: "not found" });
  }
  if (!memberCanAccessProperty(ctx, pn)) {
    return res.status(403).json({ error: "No access to this note." });
  }
  const src = String(row0?.src ?? "manual").toLowerCase();
  if (src === "auto") {
    return res.status(400).json({ error: "Automatic notes cannot be deleted" });
  }

  const result = await query(
    `DELETE FROM dbo.UnitDetailNote OUTPUT DELETED.Id WHERE Id = @id AND CompanyId = @companyId`,
    inputs
  );
  const n = result.rowsAffected != null ? result.rowsAffected[0] : 0;
  if (!n) {
    return res.status(404).json({ error: "not found" });
  }
  res.status(204).end();
}

async function getUnitLegalHistory(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;
  const property = req.query.property ? String(req.query.property).trim() : "";
  const unit = req.query.unit ? String(req.query.unit).trim() : "";
  const name = req.query.name ? String(req.query.name).trim() : "";
  if (!property || !unit || !name) {
    return res.status(400).json({ error: "property, unit, and name query params are required" });
  }
  if (!memberCanAccessProperty(ctx, property)) {
    return res.status(403).json({ error: "No access to this property." });
  }
  const inputs2 = baseRowInputs(companyId, property, unit, name, req.query.tenantCode);
  inputs2.tenantCodeQ = inputs2.tenantCode;
  delete inputs2.tenantCode;

  try {
    const result = await query(
      `SELECT TOP 100 Id, OldStatus, NewStatus, ChangedAt
       FROM dbo.UnitLegalStatusHistory
       WHERE CompanyId = @companyId AND PropertyName = @property AND Unit = @unit AND TenantName = @name
         AND (
           (@tenantCodeQ IS NULL OR LTRIM(RTRIM(CAST(@tenantCodeQ AS NVARCHAR(400)))) = N'')
             AND (TenantCode IS NULL OR LTRIM(RTRIM(CAST(TenantCode AS NVARCHAR(400)))) = N'')
           OR (
             @tenantCodeQ IS NOT NULL AND LTRIM(RTRIM(CAST(@tenantCodeQ AS NVARCHAR(400)))) <> N''
             AND LTRIM(RTRIM(CAST(TenantCode AS NVARCHAR(400)))) = LTRIM(RTRIM(CAST(@tenantCodeQ AS NVARCHAR(400))))
           )
         )
       ORDER BY ChangedAt DESC`,
      inputs2
    );
    res.json({
      entries: (result.recordset || []).map((r) => ({
        id: r.Id ?? r.id,
        oldStatus: r.OldStatus ?? r.oldStatus ?? "",
        newStatus: r.NewStatus ?? r.newStatus ?? "",
        changedAt: r.ChangedAt instanceof Date ? r.ChangedAt.toISOString() : String(r.ChangedAt ?? "")
      }))
    });
  } catch (err) {
    if (/Invalid object name/i.test(String(err?.message || ""))) {
      return res.json({ entries: [] });
    }
    throw err;
  }
}

async function getUserUnitDetailColumnPrefs(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const firebaseUid = String(ctx.userId || "").trim();
  if (!firebaseUid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await query(
      `SELECT PrefsJson AS prefs
       FROM dbo.UserUnitDetailColumnPrefs
       WHERE FirebaseUid = @firebaseUid`,
      { firebaseUid: { type: sql.NVarChar(128), value: firebaseUid } }
    );
    const row = result.recordset[0];
    const parsed = parsePrefsJson(row?.prefs ?? row?.Prefs);
    const normalized = normalizeUnitDetailColumnPrefs(parsed || {});
    return res.json({
      columnOrder: normalized.columnOrder,
      hidden: normalized.hidden
    });
  } catch (err) {
    if (/Invalid object name/i.test(String(err?.message || ""))) {
      const normalized = normalizeUnitDetailColumnPrefs({});
      return res.json({
        columnOrder: normalized.columnOrder,
        hidden: normalized.hidden
      });
    }
    throw err;
  }
}

async function putUserUnitDetailColumnPrefs(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const firebaseUid = String(ctx.userId || "").trim();
  if (!firebaseUid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const normalized = normalizeUnitDetailColumnPrefs(req.body || {});
  const json = JSON.stringify({
    columnOrder: normalized.columnOrder,
    hidden: normalized.hidden
  });
  if (json.length > 4000) {
    return res.status(400).json({ error: "Column preferences JSON is too large (max 4000 characters)." });
  }

  try {
    await query(
      `MERGE dbo.UserUnitDetailColumnPrefs AS t
       USING (SELECT @firebaseUid AS FirebaseUid) AS s ON t.FirebaseUid = s.FirebaseUid
       WHEN MATCHED THEN
         UPDATE SET PrefsJson = @prefsJson, UpdatedAt = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (FirebaseUid, PrefsJson) VALUES (@firebaseUid, @prefsJson);`,
      {
        firebaseUid: { type: sql.NVarChar(128), value: firebaseUid },
        prefsJson: { type: sql.NVarChar(4000), value: json }
      }
    );
  } catch (err) {
    if (/Invalid column name/i.test(String(err?.message || ""))) {
      return res.status(503).json({
        error:
          "Table UserUnitDetailColumnPrefs is missing. Run backend/scripts/migrate-user-unit-detail-column-prefs.sql"
      });
    }
    throw err;
  }

  res.json({
    columnOrder: normalized.columnOrder,
    hidden: normalized.hidden
  });
}

module.exports = {
  getRegions,
  getPortfolios,
  getProperties,
  getSummary,
  getUnits,
  patchUnitRow,
  getUnitNotes,
  postUnitNote,
  patchUnitNote,
  deleteUnitNote,
  getUnitLegalHistory,
  getUserUnitDetailColumnPrefs,
  putUserUnitDetailColumnPrefs
};
