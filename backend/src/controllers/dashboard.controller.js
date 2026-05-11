const { sql, query } = require("../db");
const col = require("../helpers/columnMap");
const { readActiveCompanyId } = require("../config/activeCompany");

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
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const text = `
    SELECT Name AS value
    FROM dbo.Regions
    WHERE CompanyId = @companyId
      AND Name IS NOT NULL AND LTRIM(RTRIM(CAST(Name AS NVARCHAR(400)))) <> N''
    ORDER BY Name
  `;
  const result = await query(text, {
    companyId: { type: sql.Int, value: companyId }
  });
  res.json({ regions: result.recordset.map((r) => r.value) });
}

async function getPortfolios(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const region = req.query.region;
  if (!region) {
    return res.status(400).json({ error: "region is required" });
  }
  const text = `
    SELECT DISTINCT p.Name AS value
    FROM dbo.Portfolios p
    INNER JOIN dbo.Regions r ON r.Id = p.RegionId AND r.CompanyId = @companyId
    WHERE p.CompanyId = @companyId
      AND r.Name = @region
      AND p.Name IS NOT NULL AND LTRIM(RTRIM(CAST(p.Name AS NVARCHAR(400)))) <> N''
    ORDER BY value
  `;
  const result = await query(text, {
    companyId: { type: sql.Int, value: companyId },
    region: { type: sql.NVarChar(400), value: region }
  });
  res.json({ portfolios: result.recordset.map((r) => r.value) });
}

async function getProperties(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const region = req.query.region;
  const portfolio = req.query.portfolio;
  if (!region || !portfolio) {
    return res.status(400).json({ error: "region and portfolio are required" });
  }
  const text = `
    SELECT DISTINCT pr.Name AS value
    FROM dbo.Properties pr
    INNER JOIN dbo.Portfolios p ON p.Id = pr.PortfolioId AND p.CompanyId = @companyId
    INNER JOIN dbo.Regions r ON r.Id = p.RegionId AND r.CompanyId = @companyId
    WHERE pr.CompanyId = @companyId
      AND r.Name = @region
      AND p.Name = @portfolio
      AND pr.Name IS NOT NULL AND LTRIM(RTRIM(CAST(pr.Name AS NVARCHAR(400)))) <> N''
    ORDER BY value
  `;
  const result = await query(text, {
    companyId: { type: sql.Int, value: companyId },
    region: { type: sql.NVarChar(400), value: region },
    portfolio: { type: sql.NVarChar(400), value: portfolio }
  });
  res.json({ properties: result.recordset.map((r) => r.value) });
}

async function getSummary(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const region = req.query.region;
  if (!region) {
    return res.status(400).json({ error: "region is required" });
  }
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
    GROUP BY po.Name, dt.${PR}
    HAVING po.Name IS NOT NULL AND dt.${PR} IS NOT NULL
    ORDER BY po.Name, dt.${PR}
  `;
  const result = await query(text, {
    companyId: { type: sql.Int, value: companyId },
    region: { type: sql.NVarChar(400), value: region }
  });
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
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const propertyNames = parsePropertiesList(req);
  if (propertyNames.length === 0) {
    return res.status(400).json({ error: "property or properties is required" });
  }
  if (propertyNames.length > MAX_UNITS_PROPERTIES) {
    return res.status(400).json({ error: `At most ${MAX_UNITS_PROPERTIES} properties per request` });
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

  const inPlaceholders = propertyNames.map((_, i) => `@prop${i}`).join(", ");
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
  propertyNames.forEach((name, i) => {
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

module.exports = {
  getRegions,
  getPortfolios,
  getProperties,
  getSummary,
  getUnits
};
