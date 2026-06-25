import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../api/apiClient";
import { getActiveCompanyId } from "../config/company.js";
import Spinner from "./Spinner";

const STEPS = [
  { id: 1, title: "Dataverse connection", short: "Connect" },
  { id: 2, title: "Source table", short: "Source" },
  { id: 3, title: "SQL destination", short: "SQL" },
  { id: 4, title: "Column mapping", short: "Map" },
  { id: 5, title: "Keys & import mode", short: "Keys" },
  { id: 6, title: "Review & run", short: "Run" }
];

function formatPreviewColumnLabel(col) {
  return String(col || "")
    .replace(/@OData\.Community\.Display\.V1\.FormattedValue$/i, "")
    .replace(/^cr\d+_/i, "")
    .replace(/^new_/i, "");
}

function formatPreviewCell(value) {
  if (value == null || value === "") return "—";
  const s = String(value);
  if (s.length > 48) return `${s.slice(0, 47)}…`;
  return s;
}

const DEFAULT_SOURCE_COMPANY_FILTER = { enabled: true, useWorkspaceId: true, sourceValue: null };

function getSourceCompanyFilter(map) {
  const scf = map?.sourceCompanyFilter || DEFAULT_SOURCE_COMPANY_FILTER;
  return {
    enabled: scf.enabled !== false,
    useWorkspaceId: scf.useWorkspaceId !== false,
    sourceValue: scf.sourceValue ?? null
  };
}

function previewFilterQuery(map) {
  const scf = getSourceCompanyFilter(map);
  const q = {};
  if (!scf.enabled) q.sourceCompanyFilterEnabled = "0";
  return q;
}

const PREVIEW_PAGE_SIZE = 75;

function isImportRunning(status) {
  return /^running$/i.test(String(status || ""));
}

function mergeLogIntoList(logs, log) {
  if (!log?.Id) return logs;
  const i = logs.findIndex((l) => l.Id === log.Id);
  if (i === -1) return [log, ...logs];
  const next = [...logs];
  next[i] = { ...next[i], ...log };
  return next;
}

function EtlRunLivePanel({ log, details }) {
  if (!log) return null;
  const running = isImportRunning(log.Status);
  const errList = details || [];
  if (!running && errList.length === 0) return null;
  return (
    <div className="etl-run-live card-like">
      {running ? <p className="etl-run-live__label">Import in progress…</p> : null}
      <div className="etl-run-live__stats">
        <span>
          Read: <strong>{log.TotalRead ?? 0}</strong>
        </span>
        <span>
          Inserted: <strong>{log.TotalInserted ?? 0}</strong>
        </span>
        <span>
          Updated: <strong>{log.TotalUpdated ?? 0}</strong>
        </span>
        <span>
          Skipped: <strong>{log.TotalSkipped ?? 0}</strong>
        </span>
        <span>
          Errors: <strong>{log.TotalErrors ?? 0}</strong>
        </span>
      </div>
      {errList.length > 0 ? (
        <details className="etl-run-live__errors" open={running}>
          <summary>Row errors ({errList.length})</summary>
          <ul className="etl-run-live__error-list">
            {errList.slice(0, 25).map((d) => (
              <li key={d.Id}>
                Row {d.RowNumber}
                {d.SourceRecordId ? ` · ${d.SourceRecordId}` : ""}: {d.ErrorMessage || "Error"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const TRANSFORM_OPTIONS = [
  { id: "trim", label: "Trim text" },
  { id: "cleanInvalidChars", label: "Clean invalid characters" },
  { id: "convertDate", label: "Convert date" },
  { id: "convertNumber", label: "Convert number" },
  { id: "convertBoolean", label: "Convert boolean" },
  { id: "maxLengthTruncate", label: "Truncate to max length" }
];

/** @typedef {'list' | 'flow' | 'wizard'} EtlPage */

export default function DataverseEtlWizard() {
  const [page, setPage] = useState(/** @type {EtlPage} */ ("list"));
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [connForm, setConnForm] = useState({
    name: "Dataverse",
    environmentUrl: "",
    tenantId: "",
    clientId: "",
    clientSecret: ""
  });
  const [envDefaults, setEnvDefaults] = useState(null);

  const [tables, setTables] = useState([]);
  const [tableLogical, setTableLogical] = useState("");
  const [tableManual, setTableManual] = useState("");
  const [entitySetName, setEntitySetName] = useState("");
  const [sourceColumns, setSourceColumns] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewCols, setPreviewCols] = useState([]);
  const [previewTotalCount, setPreviewTotalCount] = useState(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageCache, setPreviewPageCache] = useState({});
  const [previewAfterCursors, setPreviewAfterCursors] = useState({});
  const [previewHasNext, setPreviewHasNext] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewCompanyScope, setPreviewCompanyScope] = useState(null);
  const [previewCompanyDistribution, setPreviewCompanyDistribution] = useState(null);
  const sourceStepBootRef = useRef("");
  const workspaceCompanyId = getActiveCompanyId();

  const [destColumns, setDestColumns] = useState([]);
  const [mapping, setMapping] = useState({
    columnMappings: [],
    defaultValues: {},
    sourceCompanyFilter: { ...DEFAULT_SOURCE_COMPANY_FILTER }
  });
  const [warnings, setWarnings] = useState([]);
  const [uniqueKey, setUniqueKey] = useState([]);
  const [importMode, setImportMode] = useState("upsert");
  const [mappingName, setMappingName] = useState("Dataverse import");
  const [savedMappingId, setSavedMappingId] = useState(null);
  const [scheduleType, setScheduleType] = useState("interval_minutes");
  const [scheduleValue, setScheduleValue] = useState("240");
  const [flowEnabled, setFlowEnabled] = useState(true);
  const [savedFlows, setSavedFlows] = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState(null);
  const [flowLogs, setFlowLogs] = useState([]);
  const [flowLogsLoading, setFlowLogsLoading] = useState(false);

  const [importLogId, setImportLogId] = useState(null);
  const [importLog, setImportLog] = useState(null);
  const [importLogDetails, setImportLogDetails] = useState([]);

  const effectiveTable = (tableManual.trim() || tableLogical).trim();
  const activeConnection = connections.find((c) => String(c.id) === String(connectionId)) || null;

  const loadConnections = useCallback(async () => {
    const data = await api.listEtlConnections();
    setConnections(data.connections || []);
  }, []);

  const refreshFlows = useCallback(async () => {
    const d = await api.listEtlMappings();
    setSavedFlows(d.mappings || []);
    return d.mappings || [];
  }, []);

  const loadFlowLogs = useCallback(async (mappingId, opts = {}) => {
    const { silent = false } = opts;
    if (!mappingId) {
      setFlowLogs([]);
      return [];
    }
    if (!silent) setFlowLogsLoading(true);
    try {
      const d = await api.listEtlMappingLogs(mappingId);
      const logs = d.logs || [];
      setFlowLogs(logs);
      return logs;
    } catch {
      if (!silent) setFlowLogs([]);
      return [];
    } finally {
      if (!silent) setFlowLogsLoading(false);
    }
  }, []);

  const pollImportProgress = useCallback(
    async (logId) => {
      if (!logId) return null;
      const { log, details } = await api.getEtlImportLog(logId);
      setImportLog(log);
      setImportLogDetails(details || []);
      if (page === "flow") {
        setFlowLogs((prev) => mergeLogIntoList(prev, log));
      }
      return log;
    },
    [page]
  );

  const loadSavedFlow = useCallback(async (id) => {
    const m = await api.getEtlMapping(id);
    setSavedMappingId(m.id);
    setMappingName(m.name || "Dataverse import");
    setConnectionId(String(m.connectionId));
    setTableLogical(m.sourceTableLogicalName || "");
    setTableManual("");
    setEntitySetName(m.sourceEntitySetName || "");
    setUniqueKey(m.uniqueKey || []);
    setMapping({
      ...(m.mapping || { columnMappings: [], defaultValues: {} }),
      sourceCompanyFilter: {
        enabled: m.mapping?.sourceCompanyFilter?.enabled !== false,
        useWorkspaceId: true,
        sourceValue: null
      }
    });
    setImportMode(m.importMode || "upsert");
    setScheduleType(m.scheduleType || "manual");
    setScheduleValue(m.scheduleValue != null ? String(m.scheduleValue) : "");
    setFlowEnabled(m.isEnabled !== false);
    if (m.sourceTableLogicalName && m.connectionId) {
      void api.getEtlTableColumns(m.connectionId, m.sourceTableLogicalName).then((colRes) => {
        setSourceColumns(colRes.columns || []);
      });
    }
  }, []);

  useEffect(() => {
    void loadConnections().catch(() => {});
    void refreshFlows().catch(() => {});
    void api
      .getEtlConnectionDefaults()
      .then((d) => {
        const defaults = {
          name: d.name || "CollectEase360",
          environmentUrl: d.environmentUrl || "",
          tenantId: d.tenantId || "",
          clientId: d.clientId || "",
          hasEnvSecret: Boolean(d.hasEnvSecret)
        };
        setEnvDefaults(defaults);
        if (!connectionId) {
          setConnForm({
            name: defaults.name,
            environmentUrl: defaults.environmentUrl,
            tenantId: defaults.tenantId,
            clientId: defaults.clientId,
            clientSecret: ""
          });
        }
      })
      .catch(() => {});
  }, [loadConnections, connectionId, refreshFlows]);

  function formatFlowSchedule(f) {
    const st = String(f.scheduleType || "manual").toLowerCase();
    if (st === "manual") return "Manual";
    if (st === "hourly") return "Hourly";
    if (st === "interval_minutes") return `Every ${f.scheduleValue || "?"} min`;
    return st;
  }

  async function openFlow(id) {
    setError("");
    setMessage("");
    setSelectedFlowId(id);
    setSavedMappingId(id);
    setPage("flow");
    await loadFlowLogs(id);
  }

  async function editFlow(id, e) {
    e?.stopPropagation?.();
    setBusy(true);
    setError("");
    try {
      await loadSavedFlow(id);
      setSelectedFlowId(id);
      setStep(1);
      setPage("wizard");
      setMessage("");
    } catch (err) {
      setError(err.message || "Failed to load flow");
    } finally {
      setBusy(false);
    }
  }

  async function removeFlow(id, e) {
    e?.stopPropagation?.();
    const f = savedFlows.find((x) => x.id === id);
    const label = f?.name || `#${id}`;
    if (!window.confirm(`Delete flow "${label}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteEtlMapping(id);
      if (selectedFlowId === id) {
        setSelectedFlowId(null);
        setFlowLogs([]);
        setSavedMappingId(null);
        setPage("list");
      }
      await refreshFlows();
      setMessage("");
    } catch (err) {
      setError(err.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  function startNewFlow() {
    setSelectedFlowId(null);
    setSavedMappingId(null);
    setFlowLogs([]);
    setMappingName("Dataverse import");
    setTableLogical("");
    setTableManual("");
    setEntitySetName("");
    setSourceColumns([]);
    setPreviewRows([]);
    setPreviewCols([]);
    setMapping({ columnMappings: [], defaultValues: {}, sourceCompanyFilter: { ...DEFAULT_SOURCE_COMPANY_FILTER } });
    setUniqueKey([]);
    setImportMode("upsert");
    setScheduleType("interval_minutes");
    setScheduleValue("240");
    setFlowEnabled(true);
    setStep(1);
    setPage("wizard");
    setError("");
    setMessage("");
  }

  function goToList() {
    setError("");
    setMessage("");
    setPage("list");
  }

  function wizardBack() {
    setMessage("");
    if (step > 1) {
      setStep((s) => s - 1);
      return;
    }
    setPage(selectedFlowId ? "flow" : "list");
  }

  async function runFlowNow() {
    if (!savedMappingId) return;
    setBusy(true);
    setError("");
    setImportLog(null);
    try {
      const { logId } = await api.runEtlImport({ mappingId: savedMappingId, importMode });
      setImportLogId(logId);
      setMessage("Import started.");
      void loadFlowLogs(savedMappingId);
    } catch (e) {
      setError(e.message || "Import failed to start");
    } finally {
      setBusy(false);
    }
  }

  function applyEnvDefaultsToForm() {
    if (!envDefaults) return;
    setConnForm({
      name: envDefaults.name,
      environmentUrl: envDefaults.environmentUrl,
      tenantId: envDefaults.tenantId,
      clientId: envDefaults.clientId,
      clientSecret: ""
    });
  }

  useEffect(() => {
    const needsPoll =
      importLogId ||
      (page === "flow" && flowLogs.some((l) => isImportRunning(l.Status)));
    if (!needsPoll) return undefined;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      let logId = importLogId;
      if (!logId && page === "flow") {
        const running = flowLogs.find((l) => isImportRunning(l.Status));
        logId = running?.Id ?? null;
      }
      if (!logId) return;

      try {
        const log = await pollImportProgress(logId);
        if (!log || cancelled) return;
        if (!isImportRunning(log.Status)) {
          if (selectedFlowId) await loadFlowLogs(selectedFlowId, { silent: true });
          if (importLogId === logId) setImportLogId(null);
        }
      } catch {
        /* ignore poll errors */
      }
    };

    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [
    importLogId,
    page,
    flowLogs,
    selectedFlowId,
    pollImportProgress,
    loadFlowLogs
  ]);

  function connectionPayload() {
    const { clientSecret, ...rest } = connForm;
    const payload = { ...rest };
    if (clientSecret.trim()) payload.clientSecret = clientSecret.trim();
    return payload;
  }

  async function testConnection() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = connectionId
        ? { connectionId: Number(connectionId) }
        : connectionPayload();
      await api.testEtlConnection(body);
      setMessage("Connection test passed.");
    } catch (e) {
      setMessage("");
      const msg = String(e.message || "Connection failed");
      setError(
        /EtlDataverseConnections/i.test(msg)
          ? "Dataverse connection works, but the database is missing ETL tables. Ask your admin to run backend/scripts/migrate-etl-dataverse.sql, then try again."
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveConnection() {
    if (connectionId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await api.createEtlConnection(connectionPayload());
      setConnectionId(String(created.id));
      await loadConnections();
      setMessage("Connection added.");
    } catch (e) {
      setMessage("");
      const msg = String(e.message || "Save failed");
      setError(
        /EtlDataverseConnections/i.test(msg)
          ? "Could not save — run backend/scripts/migrate-etl-dataverse.sql on the database first."
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeConnection() {
    if (!connectionId) return;
    const c = connections.find((x) => String(x.id) === String(connectionId));
    const label = c ? `${c.name} (${c.environmentUrl})` : "this connection";
    if (!window.confirm(`Remove saved connection?\n\n${label}`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.deleteEtlConnection(Number(connectionId));
      setConnectionId("");
      await loadConnections();
      setMessage("Connection removed.");
    } catch (e) {
      setError(e.message || "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadTables() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api.listEtlTables(Number(connectionId));
      setTables(data.tables || []);
      return true;
    } catch (e) {
      setError(e.message || "Failed to load tables");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function resetPreviewPaging() {
    setPreviewPage(1);
    setPreviewPageCache({});
    setPreviewAfterCursors({});
    setPreviewHasNext(false);
    setPreviewLoaded(false);
    setPreviewCompanyScope(null);
    setPreviewCompanyDistribution(null);
  }

  function updateSourceCompanyFilter(patch) {
    setMapping((prev) => ({
      ...prev,
      sourceCompanyFilter: { ...getSourceCompanyFilter(prev), ...patch }
    }));
    sourceStepBootRef.current = "";
    resetPreviewPaging();
  }

  function applyPreviewResponse(pageNum, prevRes) {
    setPreviewRows(prevRes.rows || []);
    if (prevRes.columns?.length) setPreviewCols(prevRes.columns);
    if (prevRes.totalCount != null) setPreviewTotalCount(prevRes.totalCount);
    if (prevRes.entitySetName) setEntitySetName(prevRes.entitySetName);
    if (prevRes.companyScope) setPreviewCompanyScope(prevRes.companyScope);
    setPreviewCompanyDistribution(prevRes.companyDistribution || null);
    setPreviewPage(pageNum);
    setPreviewHasNext(Boolean(prevRes.hasNext));
    setPreviewLoaded(true);
    const cursor = prevRes.nextCursor || prevRes.nextLink;
    if (cursor) {
      setPreviewAfterCursors((prev) => ({ ...prev, [pageNum + 1]: cursor }));
    }
    setPreviewPageCache((prev) => ({
      ...prev,
      [pageNum]: {
        rows: prevRes.rows || [],
        columns: prevRes.columns || [],
        hasNext: Boolean(prevRes.hasNext),
        afterCursor: cursor || null
      }
    }));
  }

  async function loadPreviewPage(page, logical, entitySet) {
    const ln = (logical || effectiveTable).trim();
    if (!ln || !connectionId) return false;
    const pageNum = Math.max(1, Number(page) || 1);
    const cached = previewPageCache[pageNum];
    if (cached) {
      setPreviewRows(cached.rows);
      if (cached.columns?.length) setPreviewCols(cached.columns);
      setPreviewPage(pageNum);
      setPreviewHasNext(Boolean(cached.hasNext ?? previewAfterCursors[pageNum + 1]));
      setError("");
      return true;
    }
    setBusy(true);
    setError("");
    try {
      const query = {
        ...previewFilterQuery(mapping),
        entitySet: entitySet ?? (entitySetName || undefined),
        top: PREVIEW_PAGE_SIZE,
        page: pageNum
      };
      if (pageNum > 1) {
        const cursor = previewAfterCursors[pageNum];
        if (!cursor) {
          setError("Load the previous pages first.");
          return false;
        }
        if (String(cursor).startsWith("http")) query.nextLink = cursor;
        else query.afterId = cursor;
      }
      const prevRes = await api.previewEtlTable(Number(connectionId), ln, query);
      applyPreviewResponse(pageNum, prevRes);
      return true;
    } catch (e) {
      setError(e.message || "Failed to load preview");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function selectTable(logical, entitySet) {
    setTableLogical(logical);
    setEntitySetName(entitySet || "");
    setPreviewRows([]);
    setPreviewCols([]);
    setPreviewTotalCount(null);
    resetPreviewPaging();
    setBusy(true);
    setError("");
    try {
      const [colRes, prevRes] = await Promise.all([
        api.getEtlTableColumns(Number(connectionId), logical),
        api.previewEtlTable(Number(connectionId), logical, {
          ...previewFilterQuery(mapping),
          entitySet,
          top: PREVIEW_PAGE_SIZE,
          page: 1
        })
      ]);
      setSourceColumns(colRes.columns || []);
      setPreviewCols(prevRes.columns || (prevRes.rows?.[0] ? Object.keys(prevRes.rows[0]) : []));
      applyPreviewResponse(1, prevRes);
      if (prevRes.entitySetName) setEntitySetName(prevRes.entitySetName);
      return (colRes.columns || []).length > 0;
    } catch (e) {
      setError(e.message || "Failed to load table");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loadDestination() {
    setBusy(true);
    setError("");
    try {
      const data = await api.getEtlDataTblColumns();
      setDestColumns(data.columns || []);
      return (data.columns || []).length > 0;
    } catch (e) {
      setError(e.message || "Failed to load SQL columns");
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    sourceStepBootRef.current = "";
    resetPreviewPaging();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset source preview when table/connection changes
  }, [connectionId, effectiveTable]);

  useEffect(() => {
    if (page !== "wizard" || step !== 2 || !connectionId || !effectiveTable.trim()) return;
    const scf = getSourceCompanyFilter(mapping);
    const bootKey = `${connectionId}|${effectiveTable}|${entitySetName || ""}|${scf.enabled}|${workspaceCompanyId}`;
    if (sourceStepBootRef.current === bootKey) return;
    sourceStepBootRef.current = bootKey;

    let cancelled = false;
    void (async () => {
      if (tables.length === 0) {
        await loadTables();
      }
      if (cancelled) return;
      await selectTable(tableLogical || effectiveTable, entitySetName || undefined);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot source step when table/connection/filter set
  }, [page, step, connectionId, effectiveTable, tableLogical, entitySetName, tables.length, mapping.sourceCompanyFilter, workspaceCompanyId]);

  useEffect(() => {
    if (step !== 3 || destColumns.length > 0 || busy) return;
    void loadDestination();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when SQL step opens
  }, [step]);

  async function runAutoMap() {
    setBusy(true);
    setError("");
    try {
      const data = await api.etlAutoMap({ sourceColumns });
      setMapping({
        ...(data.mapping || { columnMappings: [], defaultValues: {} }),
        sourceCompanyFilter: getSourceCompanyFilter(mapping)
      });
      setWarnings(data.warnings || []);
      return true;
    } catch (e) {
      setError(e.message || "Auto-map failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function updateMappingRow(idx, patch) {
    setMapping((prev) => {
      const columnMappings = [...(prev.columnMappings || [])];
      columnMappings[idx] = { ...columnMappings[idx], ...patch };
      return { ...prev, columnMappings };
    });
  }

  function buildMappingPayload() {
    return {
      name: mappingName,
      connectionId: Number(connectionId),
      sourceTableLogicalName: effectiveTable,
      sourceEntitySetName: entitySetName || null,
      destinationTable: "DataTbl",
      uniqueKey,
      mapping: {
        ...mapping,
        sourceCompanyFilter: {
          enabled: getSourceCompanyFilter(mapping).enabled,
          useWorkspaceId: true,
          sourceValue: null
        }
      },
      importMode,
      batchSize: 500,
      scheduleType,
      scheduleValue: scheduleType === "manual" ? null : scheduleValue,
      isEnabled: flowEnabled
    };
  }

  async function saveMapping() {
    setBusy(true);
    setError("");
    try {
      const payload = buildMappingPayload();
      let id = savedMappingId;
      if (id) {
        await api.updateEtlMapping(id, payload);
      } else {
        const created = await api.createEtlMapping(payload);
        id = created.id;
        setSavedMappingId(id);
      }
      setMessage("Flow saved for this company.");
      const flows = await refreshFlows();
      setSelectedFlowId(id);
      setSavedMappingId(id);
      await loadFlowLogs(id);
      setPage("flow");
      return id;
    } catch (e) {
      setError(e.message || "Save failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError("");
    setImportLog(null);
    try {
      const mappingId = await saveMapping();
      if (!mappingId) return;
      const { logId } = await api.runEtlImport({ mappingId, importMode });
      setImportLogId(logId);
      setMessage("Import started.");
      if (savedMappingId) void loadFlowLogs(savedMappingId);
    } catch (e) {
      setError(e.message || "Import failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function goNext() {
    setError("");
    setMessage("");
    let canAdvance = true;

    if (step === 1) {
      if (!connectionId) {
        setError("Select a saved connection, or add a new one (Test, then Add).");
        return;
      }
      canAdvance = await loadTables();
    } else if (step === 2) {
      if (!effectiveTable) {
        setError("Select or enter a source table.");
        return;
      }
      if (!previewLoaded || previewCols.length === 0) {
        canAdvance = await selectTable(effectiveTable, entitySetName || undefined);
        if (!canAdvance) return;
      }
      canAdvance = await loadDestination();
    } else if (step === 3) {
      if (destColumns.length === 0) {
        canAdvance = await loadDestination();
        if (!canAdvance) return;
      }
      if (!(mapping.columnMappings || []).length) {
        canAdvance = await runAutoMap();
      }
    } else if (step === 4) {
      const mapped = (mapping.columnMappings || []).filter((m) => m.destinationColumn);
      if (!mapped.length) {
        setError("Map at least one column.");
        return;
      }
    } else if (step === 5) {
      if (!uniqueKey.length) {
        setError("Select at least one unique key column.");
        return;
      }
      if (scheduleType === "interval_minutes" && !(Number(scheduleValue) > 0)) {
        setError("Enter schedule interval in minutes.");
        return;
      }
      canAdvance = Boolean(await saveMapping());
    }

    if (!canAdvance) return;
    setStep((s) => Math.min(STEPS.length, s + 1));
  }

  const mappedCount = (mapping.columnMappings || []).filter((m) => m.destinationColumn).length;

  const previewTotalPages =
    previewTotalCount != null ? Math.max(1, Math.ceil(previewTotalCount / PREVIEW_PAGE_SIZE)) : null;
  const previewRowFrom =
    previewRows.length > 0 ? (previewPage - 1) * PREVIEW_PAGE_SIZE + 1 : 0;
  const previewRowTo = previewRowFrom ? previewRowFrom + previewRows.length - 1 : 0;
  const previewDisplayCols =
    previewCols.length > 0
      ? previewCols
      : (sourceColumns || []).map((c) => c.logicalName).filter(Boolean);
  const selectedFlow = savedFlows.find((f) => f.id === selectedFlowId) || null;
  const activeRunningLog =
    (importLog && isImportRunning(importLog.Status) ? importLog : null) ||
    flowLogs.find((l) => isImportRunning(l.Status)) ||
    null;

  return (
    <div className="admin-page-panel etl-admin-shell">
      {page === "list" ? (
      <section className="etl-page card-like">
        <div className="etl-page__head">
          <h2 className="etl-page__title">Dataverse flows</h2>
          <div className="etl-page__actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void refreshFlows()}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={startNewFlow}>
              <Plus size={14} /> New flow
            </button>
          </div>
        </div>
        {savedFlows.length === 0 ? (
          <p className="etl-flows-panel__empty text-muted">No saved flows for this company yet.</p>
        ) : (
          <ul className="etl-flows-list">
            {savedFlows.map((f) => (
              <li key={f.id}>
                <button type="button" className="etl-flows-list__item" onClick={() => void openFlow(f.id)}>
                  <span className="etl-flows-list__name">{f.name}</span>
                  <span className="etl-flows-list__meta">
                    {f.sourceTableLogicalName} · {formatFlowSchedule(f)}
                    {f.isEnabled === false ? " · paused" : ""}
                  </span>
                  {f.lastRunAt ? (
                    <span className="etl-flows-list__run text-muted">
                      Last: {new Date(f.lastRunAt).toLocaleString()}
                      {f.lastRunStatus ? ` (${f.lastRunStatus})` : ""}
                    </span>
                  ) : null}
                  <ChevronRight size={16} className="etl-flows-list__chevron" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {page === "flow" && selectedFlow ? (
      <section className="etl-page card-like">
        <div className="etl-page__head">
          <button type="button" className="btn btn-ghost btn-sm etl-page__back" disabled={busy} onClick={goToList}>
            <ChevronLeft size={16} /> All flows
          </button>
          <div className="etl-page__head-main">
            <h2 className="etl-page__title">{selectedFlow.name}</h2>
            <p className="etl-page__subtitle text-muted">
              {selectedFlow.sourceTableLogicalName} · {formatFlowSchedule(selectedFlow)}
              {selectedFlow.isEnabled === false ? " · paused" : ""}
              {selectedFlow.lastRunAt
                ? ` · Last run: ${new Date(selectedFlow.lastRunAt).toLocaleString()}${selectedFlow.lastRunStatus ? ` (${selectedFlow.lastRunStatus})` : ""}`
                : ""}
            </p>
          </div>
          <div className="etl-page__actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || flowLogsLoading} onClick={() => void loadFlowLogs(selectedFlow.id)}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void runFlowNow()}>
              <Play size={14} /> Run now
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void editFlow(selectedFlow.id)}>
              <Pencil size={14} /> Edit
            </button>
            <button type="button" className="btn btn-ghost btn-sm etl-wizard-btn-danger" disabled={busy} onClick={() => void removeFlow(selectedFlow.id)}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
        {error ? (
          <p className="dataflows-alert dataflows-alert--err" role="alert">
            {error}
          </p>
        ) : null}
        {message && !error ? <p className="etl-wizard-banner text-success">{message}</p> : null}
        <EtlRunLivePanel log={activeRunningLog} details={importLogDetails} />
        <div className="etl-flow-logs">
          <h3 className="etl-flow-logs__title">Run history</h3>
          {flowLogsLoading ? <Spinner /> : null}
          {!flowLogsLoading && flowLogs.length === 0 ? (
            <p className="text-muted etl-flow-logs__empty">No runs yet for this flow.</p>
          ) : null}
          {!flowLogsLoading && flowLogs.length > 0 ? (
            <div className="table-wrap table-wrap--etl-preview">
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>Id</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th>Read</th>
                    <th>Ins</th>
                    <th>Upd</th>
                    <th>Err</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {flowLogs.map((l) => (
                    <tr key={l.Id} className={isImportRunning(l.Status) ? "etl-log-row--running" : undefined}>
                      <td>{l.Id}</td>
                      <td>{l.TriggerType || "manual"}</td>
                      <td>
                        {isImportRunning(l.Status) ? (
                          <span className="etl-log-status-running">
                            <Loader2 size={14} className="etl-spin" aria-hidden /> Running
                          </span>
                        ) : (
                          l.Status
                        )}
                      </td>
                      <td>{l.TotalRead}</td>
                      <td>{l.TotalInserted}</td>
                      <td>{l.TotalUpdated}</td>
                      <td>{l.TotalErrors}</td>
                      <td>{l.StartedAt ? new Date(l.StartedAt).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {page === "wizard" ? (
      <div className="etl-wizard-page">
        <div className="etl-page__head etl-wizard-page__head">
          <button type="button" className="btn btn-ghost btn-sm etl-page__back" disabled={busy} onClick={wizardBack}>
            <ChevronLeft size={16} /> {selectedFlowId ? "Back to flow" : "All flows"}
          </button>
          <h2 className="etl-page__title">{savedMappingId ? `Edit: ${mappingName}` : "New flow"}</h2>
        </div>

      <div className="dataflows-wizard">
        <nav className="dataflows-wizard__steps" aria-label="ETL steps">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`dataflows-wizard__step${step === s.id ? " is-active" : ""}${step > s.id ? " is-done" : ""}`}
              disabled={s.id > step}
              onClick={() => s.id < step && setStep(s.id)}
            >
              <span className="dataflows-wizard__step-num">
                {step > s.id ? <Check size={14} /> : s.id}
              </span>
              <span className="dataflows-wizard__step-text">{s.short}</span>
            </button>
          ))}
        </nav>

        <div className="dataflows-wizard__body card-like">
          <div className="dataflows-wizard__content">
          {step !== 2 ? <h3 className="dataflows-wizard__title">{STEPS[step - 1]?.title}</h3> : null}

          {error && step !== 2 ? (
            <p className="dataflows-alert dataflows-alert--err" role="alert">
              {error}
            </p>
          ) : null}
          {message && !error && step !== 2 ? (
            <p className="etl-wizard-banner text-success">{message}</p>
          ) : null}

          {step === 1 && (
            <div className="dataflows-wizard-grid etl-wizard-grid">
          {connections.length > 0 && (
            <label className="dataflows-field dataflows-field--wide">
              <span>Saved connection</span>
              <select
                value={connectionId}
                onChange={(e) => {
                  const id = e.target.value;
                  setConnectionId(id);
                  setError("");
                  setMessage("");
                  if (!id) applyEnvDefaultsToForm();
                }}
              >
                <option value="">— New connection —</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} #{c.id} — {c.environmentUrl}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!connectionId && (
            <div className="etl-wizard-connect-form">
              <label className="dataflows-field">
                <span>Name</span>
                <input value={connForm.name} onChange={(e) => setConnForm({ ...connForm, name: e.target.value })} />
              </label>
              <label className="dataflows-field dataflows-field--wide">
                <span>Environment URL</span>
                <input
                  placeholder="https://yourorg.crm.dynamics.com"
                  value={connForm.environmentUrl}
                  onChange={(e) => setConnForm({ ...connForm, environmentUrl: e.target.value })}
                />
              </label>
              <label className="dataflows-field">
                <span>Tenant ID</span>
                <input
                  value={connForm.tenantId}
                  onChange={(e) => setConnForm({ ...connForm, tenantId: e.target.value })}
                />
              </label>
              <label className="dataflows-field">
                <span>Client ID</span>
                <input
                  value={connForm.clientId}
                  onChange={(e) => setConnForm({ ...connForm, clientId: e.target.value })}
                />
              </label>
              <label className="dataflows-field dataflows-field--wide">
                <span>Client secret</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={
                    envDefaults?.hasEnvSecret ? "Leave blank to use DATAVERSE_CLIENT_SECRET from .env" : ""
                  }
                  value={connForm.clientSecret}
                  onChange={(e) => setConnForm({ ...connForm, clientSecret: e.target.value })}
                />
              </label>
              {envDefaults ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={applyEnvDefaultsToForm}>
                  Reset to .env defaults
                </button>
              ) : null}
            </div>
          )}
          <div className="etl-wizard-toolbar etl-wizard-toolbar--connect">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void testConnection()}>
              {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
              Test
            </button>
            {!connectionId ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveConnection()}>
                {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                Add
              </button>
            ) : null}
            {connectionId ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm etl-wizard-btn-danger"
                disabled={busy}
                onClick={() => void removeConnection()}
              >
                <Trash2 size={16} /> Remove
              </button>
            ) : null}
          </div>
            </div>
          )}

          {step === 2 && (
            <div className="dataflows-wizard-grid etl-wizard-grid etl-wizard-grid--source">
              {error ? (
                <p className="etl-wizard-source-err" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="etl-wizard-source-bar">
                <label className="etl-wizard-source-field">
                  <span className="etl-wizard-source-field__label">Dataverse table</span>
                  <select
                    className="dataflows-select etl-wizard-source-field__control"
                    value={tableLogical}
                    disabled={busy}
                    onChange={(e) => {
                      const t = tables.find((x) => x.logicalName === e.target.value);
                      void selectTable(e.target.value, t?.entitySetName);
                    }}
                  >
                    <option value="">Select table…</option>
                    {tables.map((t) => (
                      <option key={t.logicalName} value={t.logicalName} title={t.logicalName}>
                        {t.displayName || t.logicalName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="etl-wizard-source-field etl-wizard-source-field--manual">
                  <span className="etl-wizard-source-field__label">Logical name</span>
                  <input
                    className="dataflows-input etl-wizard-source-field__control"
                    value={tableManual}
                    disabled={busy}
                    onChange={(e) => setTableManual(e.target.value)}
                    placeholder="cr668_example"
                    spellCheck={false}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm etl-wizard-source-refresh"
                  disabled={busy}
                  title="Refresh table list"
                  onClick={() => void loadTables()}
                >
                  <RefreshCw size={15} aria-hidden />
                  <span className="sr-only">Refresh tables</span>
                </button>
              </div>
              {activeConnection?.environmentUrl ? (
                <p className="etl-wizard-source-hint text-muted">
                  Dataverse environment: <code>{activeConnection.environmentUrl}</code> — confirm this matches the
                  environment where you see CompanyId {workspaceCompanyId} in Power Apps.
                </p>
              ) : null}
              <div className="etl-wizard-source-filter">
                <label className="dataflows-field dataflows-field--check">
                  <input
                    type="checkbox"
                    checked={getSourceCompanyFilter(mapping).enabled}
                    disabled={busy}
                    onChange={(e) => updateSourceCompanyFilter({ enabled: e.target.checked, useWorkspaceId: true, sourceValue: null })}
                  />
                  <span>
                    Filter Dataverse rows where <strong>CompanyId</strong> = workspace company ({workspaceCompanyId})
                  </span>
                </label>
              </div>
              {previewCompanyDistribution?.values?.length ? (
                <div className="etl-wizard-source-hint text-muted">
                  <strong>No rows match CompanyId {workspaceCompanyId} in Dataverse.</strong> Column{" "}
                  <code>{previewCompanyDistribution.column}</code> values:{" "}
                  {previewCompanyDistribution.values
                    .slice(0, 6)
                    .map((v) => `${v.value} (${v.count.toLocaleString()})`)
                    .join(", ")}
                  {previewCompanyDistribution.values.length > 6 ? "…" : ""}. In this environment, Legacy Residential data
                  may still be tagged as CompanyId <strong>1</strong> ({previewCompanyDistribution.values.find((v) => v.value === "1")?.count?.toLocaleString() ?? "?"} rows).
                  If Power Apps shows CompanyId 3 with thousands of rows, verify both tools use the same Dataverse
                  environment URL, or bulk-update <code>{previewCompanyDistribution.column}</code> in Dataverse.
                </div>
              ) : null}
              {previewCompanyScope?.filtered && previewTotalCount != null ? (
                <p className="etl-wizard-source-hint text-muted">
                  Filter: <code>{previewCompanyScope.filter}</code> — {previewTotalCount.toLocaleString()} row
                  {previewTotalCount === 1 ? "" : "s"} in Dataverse for CompanyId {workspaceCompanyId}.
                </p>
              ) : null}
              {previewLoaded && previewDisplayCols.length > 0 && (
                <div className="etl-preview-block">
                  <div className="table-wrap table-wrap--etl-preview-dense">
                    <table className="data-table data-table--etl-dense">
                      <thead>
                        <tr>
                          {previewDisplayCols.map((c) => (
                            <th key={c} title={c}>
                              {formatPreviewColumnLabel(c)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.length === 0 ? (
                          <tr>
                            <td colSpan={previewDisplayCols.length} className="text-muted">
                              {previewCompanyScope?.filtered && previewCompanyScope?.companyId
                                ? `No rows for company ID ${previewCompanyScope.companyId}${
                                    previewCompanyScope.column ? ` (${previewCompanyScope.column})` : ""
                                  }. Check the Dataverse company column or map CompanyId on step 4.`
                                : "No preview rows returned for this table."}
                            </td>
                          </tr>
                        ) : (
                          previewRows.map((row, i) => (
                            <tr key={i}>
                              {previewDisplayCols.map((c) => (
                                <td key={c} title={row[c] != null ? String(row[c]) : ""}>
                                  {formatPreviewCell(row[c])}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {previewRows.length > 0 ? (
                  <div className="etl-preview-pager">
                    <div className="etl-preview-pager__nav">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm etl-icon-btn"
                        disabled={busy || previewPage <= 1}
                        title="First"
                        onClick={() => void loadPreviewPage(1)}
                      >
                        «
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm etl-icon-btn"
                        disabled={busy || previewPage <= 1}
                        title="Previous"
                        onClick={() => void loadPreviewPage(previewPage - 1)}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span className="etl-preview-pager__page">
                        {previewPage}/{previewTotalPages?.toLocaleString() ?? "?"}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm etl-icon-btn"
                        disabled={busy || !previewHasNext}
                        title="Next page"
                        onClick={() => void loadPreviewPage(previewPage + 1)}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                    <span className="etl-preview-pager__meta text-muted">
                      {previewRowFrom.toLocaleString()}–{previewRowTo.toLocaleString()}
                      {previewTotalCount != null ? ` · ${previewTotalCount.toLocaleString()} rows` : ""}
                    </span>
                  </div>
                  ) : null}
                </div>
              )}
              {busy && !previewLoaded && effectiveTable ? (
                <p className="text-muted etl-wizard-source-loading">
                  <Spinner /> Loading preview…
                </p>
              ) : null}
            </div>
          )}

          {step === 3 && (
            <div className="etl-wizard-grid etl-wizard-grid--sql">
              <div className="etl-wizard-sql-head">
                <p className="etl-wizard-sql-head__title">
                  Destination: <code>dbo.DataTbl</code>
                </p>
                <p className="etl-wizard-sql-head__meta text-muted">
                  {busy && destColumns.length === 0 ? "Loading columns…" : `${destColumns.length} columns`}
                </p>
              </div>
              <div className="table-wrap table-wrap--etl-preview table-wrap--report etl-wizard-sql-table">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Nullable</th>
                  <th>Max length</th>
                </tr>
              </thead>
              <tbody>
                {destColumns.length === 0 && !busy ? (
                  <tr>
                    <td colSpan={4} className="text-muted">
                      No columns loaded. Go back and try Next again.
                    </td>
                  </tr>
                ) : null}
                {destColumns.map((c) => (
                  <tr key={c.column}>
                    <td>
                      <code>{c.column}</code>
                    </td>
                    <td>{c.dataType}</td>
                    <td>{c.isNullable ? "Yes" : "No"}</td>
                    <td>{c.maxLength ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </div>
          )}

          {step === 4 && (
            <div className="etl-wizard-grid etl-wizard-grid--map">
          <div className="etl-wizard-toolbar">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void runAutoMap()}>
              Auto map
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setMapping({
                  columnMappings: [],
                  defaultValues: {},
                  sourceCompanyFilter: getSourceCompanyFilter(mapping)
                })
              }
            >
              Clear mapping
            </button>
          </div>
          {warnings.length > 0 && (
            <ul className="text-warn" style={{ color: "var(--color-warning)", fontSize: "0.85rem" }}>
              {warnings.map((w, i) => (
                <li key={i}>
                  {w.source} → {w.destination}: {w.message}
                </li>
              ))}
            </ul>
          )}
          <div className="table-wrap table-wrap--etl-preview table-wrap--report etl-wizard-scroll-table">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Dataverse column</th>
                  <th>→ SQL column</th>
                  <th>Transforms</th>
                </tr>
              </thead>
              <tbody>
                {sourceColumns.map((sc, idx) => {
                  const m =
                    (mapping.columnMappings || []).find((x) => x.sourceColumn === sc.logicalName) || {};
                  const mi = (mapping.columnMappings || []).findIndex((x) => x.sourceColumn === sc.logicalName);
                  const rowIdx = mi >= 0 ? mi : idx;
                  return (
                    <tr key={sc.logicalName}>
                      <td>
                        <strong>{sc.logicalName}</strong>
                        <br />
                        <span className="text-muted">{sc.dataType}</span>
                      </td>
                      <td>
                        <select
                          value={m.destinationColumn || ""}
                          onChange={(e) => {
                            const dest = e.target.value;
                            const columnMappings = [...(mapping.columnMappings || [])];
                            const existing = columnMappings.findIndex((x) => x.sourceColumn === sc.logicalName);
                            const entry = {
                              sourceColumn: sc.logicalName,
                              destinationColumn: dest || null,
                              transforms: m.transforms || ["trim", "cleanInvalidChars"],
                              defaultValue: null
                            };
                            if (existing >= 0) columnMappings[existing] = entry;
                            else columnMappings.push(entry);
                            setMapping({ ...mapping, columnMappings });
                          }}
                        >
                          <option value="">— Unmapped —</option>
                          {destColumns.map((d) => (
                            <option key={d.column} value={d.column}>
                              {d.column}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          multiple
                          size={2}
                          value={m.transforms || []}
                          onChange={(e) => {
                            const transforms = [...e.target.selectedOptions].map((o) => o.value);
                            updateMappingRow(rowIdx, { sourceColumn: sc.logicalName, transforms });
                          }}
                          style={{ minWidth: "10rem" }}
                        >
                          {TRANSFORM_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            </div>
          )}

          {step === 5 && (
            <div className="dataflows-wizard-grid etl-wizard-grid etl-wizard-grid--keys etl-wizard-grid--scroll">
          <label className="dataflows-field">
            <span>Unique key columns (SQL)</span>
            <select
              multiple
              value={uniqueKey}
              onChange={(e) => setUniqueKey([...e.target.selectedOptions].map((o) => o.value))}
              style={{ minHeight: "6rem" }}
            >
              {destColumns.map((c) => (
                <option key={c.column} value={c.column}>
                  {c.column}
                </option>
              ))}
            </select>
          </label>
          <label className="dataflows-field">
            <span>Import mode</span>
            <select value={importMode} onChange={(e) => setImportMode(e.target.value)}>
              <option value="upsert">Update existing + insert new (default)</option>
              <option value="insert_only">Insert only</option>
              <option value="delete_reload">Delete company rows then reload</option>
            </select>
          </label>
          <label className="dataflows-field">
            <span>Flow name</span>
            <input value={mappingName} onChange={(e) => setMappingName(e.target.value)} />
          </label>
          <label className="dataflows-field">
            <span>Schedule</span>
            <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
              <option value="manual">Manual only</option>
              <option value="interval_minutes">Every N minutes</option>
              <option value="hourly">Hourly</option>
            </select>
          </label>
          {scheduleType === "interval_minutes" ? (
            <label className="dataflows-field">
              <span>Minutes</span>
              <input
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                placeholder="e.g. 240 (4 hours)"
              />
            </label>
          ) : null}
          <label className="dataflows-field dataflows-field--check">
            <input
              type="checkbox"
              checked={flowEnabled}
              onChange={(e) => setFlowEnabled(e.target.checked)}
            />
            <span>Enable scheduled runs</span>
          </label>
            </div>
          )}

          {step === 6 && (
            <div className="etl-wizard-grid etl-wizard-grid--run">
          <ul className="dataflows-review-list">
            <li>
              <strong>Source:</strong> {effectiveTable}
            </li>
            <li>
              <strong>Destination:</strong> dbo.DataTbl
            </li>
            <li>
              <strong>Mapped columns:</strong> {mappedCount}
            </li>
            <li>
              <strong>Unique key:</strong> {uniqueKey.join(", ") || "—"}
            </li>
            <li>
              <strong>Mode:</strong> {importMode}
            </li>
            <li>
              <strong>Schedule:</strong>{" "}
              {scheduleType === "manual"
                ? "Manual"
                : scheduleType === "hourly"
                  ? "Hourly"
                  : `Every ${scheduleValue} min`}
              {flowEnabled && scheduleType !== "manual" ? " (enabled)" : scheduleType !== "manual" ? " (paused)" : ""}
            </li>
            {savedMappingId ? (
              <li>
                <strong>Saved flow id:</strong> {savedMappingId}
              </li>
            ) : null}
          </ul>
          <div className="etl-wizard-toolbar">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void saveMapping()}>
              Save flow
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void runImport()}>
              <Play size={16} /> Run now
            </button>
          </div>
          {busy && <Spinner />}
          <EtlRunLivePanel log={importLog} details={importLogDetails} />
            </div>
          )}

          </div>

          <div className="dataflows-wizard__nav">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                setMessage("");
                wizardBack();
              }}
            >
              <ChevronLeft size={18} /> Back
            </button>
            {step < STEPS.length ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void goNext()}>
                Next <ChevronRight size={18} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      </div>
      ) : null}

    </div>
  );
}
