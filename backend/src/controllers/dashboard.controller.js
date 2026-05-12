const { sql, query } = require("../db");
const col = require("../helpers/columnMap");
const {
  readCompanyContext,
  intersectRequestedProperties,
  dataTblPropertyScopeSql,
  propertiesTableScopeSql,
  memberCanAccessProperty
} = require("../helpers/companyContext");

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
const LPD = q("lastPaymentDate");
const LPA = q("lastPaymentAmount");
const PH = q("phone");
const EM = q("email");
const TC = q("tenantCode");
/** Row balance/rent as DECIMAL with 0 fallback — avoids NULL in comparisons (SUM was silently dropping rows). */
const DT_BAL = `ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0)`;
const DT_RENT = `ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0)`;

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

/** NextFollowUp blank (Power Apps IsBlank) */
const NF_BLANK = `(dt.${NF} IS NULL OR LTRIM(RTRIM(CAST(dt.${NF} AS NVARCHAR(400)))) = N'')`;

/**
 * Missing follow up — same logic as Power Apps; thresholds from dbo.CompanyCollectionSettings (per CompanyId).
 */
const MISSING_FOLLOWUP_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND ${NF_BLANK}
    AND (
      (
        ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0) > ISNULL(TRY_CAST(cs.FollowupAmount AS DECIMAL(18,4)), 0)
        AND DAY(GETDATE()) > ISNULL(TRY_CAST(cs.FollowupDays AS INT), 9999)
      )
      OR (
        ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0)
          >= ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0)
             * ISNULL(TRY_CAST(cs.FollowupMonths AS DECIMAL(18,4)), 0)
      )
    )
  THEN 1 ELSE 0
END`;

/** Past due follow up — Power Apps: Rent>0, !IsBlank(NextFollowUp), NextFollowUp < Today() */
const PAST_DUE_FOLLOWUP_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND NOT (${NF_BLANK})
    AND TRY_CONVERT(DATE, dt.${NF}) IS NOT NULL
    AND TRY_CONVERT(DATE, dt.${NF}) < CAST(GETDATE() AS DATE)
  THEN 1 ELSE 0
END`;

/** Due today follow up — Power Apps: Rent>0, !IsBlank(NextFollowUp), NextFollowUp = Today() */
const DUE_TODAY_FOLLOWUP_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
    AND NOT (${NF_BLANK})
    AND TRY_CONVERT(DATE, dt.${NF}) IS NOT NULL
    AND TRY_CONVERT(DATE, dt.${NF}) = CAST(GETDATE() AS DATE)
  THEN 1 ELSE 0
END`;

/** LegalStatus blank or exactly "Case Closed" (Power Apps IsBlank || = "Case Closed") */
const LEGAL_STATUS_OPEN_FOR_ESCALATION = `(
  dt.${LS} IS NULL
  OR LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) = N''
  OR LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) = N'Case Closed'
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

/** Remove legal — Power Apps: Balance<=0, !IsBlank(LegalStatus), LegalStatus <> "Case Closed" */
const LEGAL_STATUS_NOT_BLANK = `NOT (
  dt.${LS} IS NULL OR LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) = N''
)`;
const REMOVE_LEGAL_CASE = `CASE
  WHEN ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0) <= 0
    AND ${LEGAL_STATUS_NOT_BLANK}
    AND LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) <> N'Case Closed'
  THEN 1 ELSE 0
END`;

/**
 * Delinquent tenant buckets (Power Apps "Number of Delinquent Tenants" style).
 * Zero balance: Balance <= 0 (any row; matches large PA counts even when Rent is blank).
 * Other bands: Rent > 0; middle column [Rent, 3×Rent); 3+ uses >= 3×Rent.
 */
const DLQ_ZERO_BALANCE = `CASE WHEN ${DT_BAL} <= 0 THEN 1 ELSE 0 END`;

const DLQ_LESS_THAN_ONE_MONTH = `CASE
  WHEN ${DT_RENT} > 0 AND ${DT_BAL} > 0 AND ${DT_BAL} < ${DT_RENT}
  THEN 1 ELSE 0 END`;

const DLQ_ONE_TO_UNDER_THREE_MONTHS = `CASE
  WHEN ${DT_RENT} > 0 AND ${DT_BAL} >= ${DT_RENT} AND ${DT_BAL} < 3 * ${DT_RENT}
  THEN 1 ELSE 0 END`;

const DLQ_THREE_PLUS_MONTHS = `CASE
  WHEN ${DT_RENT} > 0 AND ${DT_BAL} >= 3 * ${DT_RENT}
  THEN 1 ELSE 0 END`;

const DLQ_IN_LEGAL = `CASE
  WHEN ${LEGAL_STATUS_NOT_BLANK}
    AND LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) <> N'Case Closed'
  THEN 1 ELSE 0 END`;

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
  const text = `
    SELECT
      po.Name AS portfolio,
      dt.${PR} AS property,
      SUM(ISNULL(CAST(dt.${B} AS DECIMAL(18,2)), 0)) AS collection,
      SUM(${MISSING_FOLLOWUP_CASE}) AS alertsMissingFollowUp,
      SUM(${PAST_DUE_FOLLOWUP_CASE}) AS alertsPastDueFollowUp,
      SUM(${DUE_TODAY_FOLLOWUP_CASE}) AS alertsDueTodayFollowUp,
      SUM(${REQUIRES_LEGAL_CASE}) AS alertsRequiresLegal,
      SUM(${REMOVE_LEGAL_CASE}) AS alertsRemoveLegal,
      SUM(${DLQ_ZERO_BALANCE}) AS dq0,
      SUM(${DLQ_LESS_THAN_ONE_MONTH}) AS dqLt1,
      SUM(${DLQ_ONE_TO_UNDER_THREE_MONTHS}) AS dqMid,
      SUM(${DLQ_THREE_PLUS_MONTHS}) AS dq3p,
      SUM(${DLQ_IN_LEGAL}) AS dqLeg,
      MAX(ISNULL(occ.occupiedUnits, 0)) AS occupiedUnits,
      SUM(
        CASE
          WHEN ISNULL(TRY_CAST(dt.${RT} AS DECIMAL(18,4)), 0) > 0
            AND ISNULL(TRY_CAST(dt.${B} AS DECIMAL(18,4)), 0)
              < TRY_CAST(dt.${RT} AS DECIMAL(18,4))
          THEN 1 ELSE 0 END
      ) AS collectionLt1Count,
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
        AND ISNULL(TRY_CAST(d_occ.${RT} AS DECIMAL(18,4)), 0) > 0
      GROUP BY d_occ.${CC}, LTRIM(RTRIM(CAST(d_occ.${PR} AS NVARCHAR(400))))
    ) occ ON occ.occCompanyId = dt.${CC}
      AND occ.occPropNorm = LTRIM(RTRIM(CAST(dt.${PR} AS NVARCHAR(400))))
    LEFT JOIN dbo.CompanyCollectionSettings cs ON cs.CompanyId = dt.${CC}
    WHERE dt.${CC} = @companyId
      AND reg.Name = @region
      AND dt.${PR} IS NOT NULL
      ${propScope}
    GROUP BY po.Name, dt.${PR}
    HAVING po.Name IS NOT NULL AND dt.${PR} IS NOT NULL
    ORDER BY po.Name, dt.${PR}
  `;
  const result = await query(text, inputs);
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
    const lt1Pct = denom === 0 ? 0 : Math.round((100 * lt1) / denom);
    const ge1Pct = denom === 0 ? 0 : Math.round((100 * ge1) / denom);
    const missingFu =
      Number(
        row.alertsMissingFollowUp ??
          row.alertsmissingfollowup ??
          row.AlertsMissingFollowUp
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
        missingFollowUp: missingFu,
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
  "missingFollowUp",
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
  const occRaw = req.query.occupied ? String(req.query.occupied).trim().toLowerCase() : "";
  const occupiedOnly = occRaw === "1" || occRaw === "true";

  const inPlaceholders = allowed.map((_, i) => `@prop${i}`).join(", ");
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
      dt.${LPD} AS lastPaymentDate,
      dt.${LPA} AS lastPaymentAmount,
      dt.${PH} AS phone,
      dt.${EM} AS email,
      NULLIF(LTRIM(RTRIM(CAST(dt.[TenantCode] AS NVARCHAR(400)))), N'') AS tenantCode,
      (SELECT TOP 1 CAST(csErp.ErpStaticLink AS NVARCHAR(2000))
       FROM dbo.CompanyCollectionSettings csErp
       WHERE csErp.CompanyId = @companyId) AS companyErpStaticLink
    FROM dbo.DataTbl dt
    LEFT JOIN dbo.CompanyCollectionSettings cs ON cs.CompanyId = dt.${CC}
    WHERE dt.${CC} = @companyId AND dt.${PR} IN (${inPlaceholders})
  `;
  const inputs = { companyId: { type: sql.Int, value: companyId } };
  allowed.forEach((name, i) => {
    inputs[`prop${i}`] = { type: sql.NVarChar(400), value: name };
  });
  if (nameSearch) {
    text += ` AND CAST(dt.${N} AS NVARCHAR(400)) LIKE @namePat`;
    inputs.namePat = { type: sql.NVarChar(400), value: `%${nameSearch}%` };
  }
  if (unitSearch) {
    text += ` AND CAST(dt.${U} AS NVARCHAR(400)) LIKE @unitPat`;
    inputs.unitPat = { type: sql.NVarChar(400), value: `%${unitSearch}%` };
  }
  if (legalStatus) {
    text += ` AND dt.${LS} = @legalStatus`;
    inputs.legalStatus = { type: sql.NVarChar(400), value: legalStatus };
  }

  if (collection === "lt1") {
    text += ` AND ${DT_RENT} > 0 AND ${DT_BAL} < ${DT_RENT}`;
  } else if (collection === "ge1") {
    text += ` AND ${DT_RENT} > 0 AND ${DT_BAL} >= ${DT_RENT}`;
  } else if (alert === "missingFollowUp") {
    text += ` AND (${MISSING_FOLLOWUP_CASE}) = 1`;
  } else if (alert === "pastDueFollowUp") {
    text += ` AND (${PAST_DUE_FOLLOWUP_CASE}) = 1`;
  } else if (alert === "dueTodayFollowUp") {
    text += ` AND (${DUE_TODAY_FOLLOWUP_CASE}) = 1`;
  } else if (alert === "requiresLegal") {
    text += ` AND (${REQUIRES_LEGAL_CASE}) = 1`;
  } else if (alert === "removeLegal") {
    text += ` AND (${REMOVE_LEGAL_CASE}) = 1`;
  } else if (delinq === "zeroBalance") {
    text += ` AND ${DT_BAL} <= 0`;
  } else if (delinq === "lessThanOneMonth") {
    text += ` AND ${DT_RENT} > 0 AND ${DT_BAL} > 0 AND ${DT_BAL} < ${DT_RENT}`;
  } else if (delinq === "oneToUnderThreeMonths") {
    text += ` AND ${DT_RENT} > 0 AND ${DT_BAL} >= ${DT_RENT} AND ${DT_BAL} < 3 * ${DT_RENT}`;
  } else if (delinq === "threePlusMonths") {
    text += ` AND ${DT_RENT} > 0 AND ${DT_BAL} >= 3 * ${DT_RENT}`;
  } else if (delinq === "inLegal") {
    text += ` AND ${LEGAL_STATUS_NOT_BLANK}
      AND LTRIM(RTRIM(CAST(dt.${LS} AS NVARCHAR(400)))) <> N'Case Closed'`;
  } else if (occupiedOnly) {
    text += ` AND ${DT_RENT} > 0`;
  }

  text += ` ORDER BY dt.${PR}, dt.${U}, dt.${N}`;
  const result = await query(text, inputs);
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
  const hasLs = Object.prototype.hasOwnProperty.call(b, "legalStatus");
  if (!hasNf && !hasLs) {
    return res.status(400).json({ error: "Provide nextFollowUp and/or legalStatus" });
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
    `SELECT PropertyName AS pn FROM dbo.UnitDetailNote WHERE Id = @id AND CompanyId = @companyId`,
    inputs
  );
  const pn = pre.recordset[0]?.pn ?? pre.recordset[0]?.Pn;
  if (pn == null) {
    return res.status(404).json({ error: "not found" });
  }
  if (!memberCanAccessProperty(ctx, pn)) {
    return res.status(403).json({ error: "No access to this note." });
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
  getUnitLegalHistory
};
