import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  GitBranch,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import { api } from "../api/apiClient";
import DataflowTransformWizardStep from "./DataflowTransformWizardStep.jsx";
import DataflowTransformToolbar from "./DataflowTransformToolbar.jsx";
import { validatePipelineText, summarizeValidation } from "@collectease/transformation-ops";
import { parsePipelineText, appendStep, stringifyPipeline } from "../lib/dataflowPipelineUtils.js";
import {
  acquireGraphFilesAccessToken,
  getExcelDownloadUrl,
  isExcelGraphItem,
  isGraphFilesBrowseConfigured,
  listDriveItemChildren,
  listDriveRootChildren,
  listMeDriveRootChildren,
  resolveSharePointSiteDrive
} from "../microsoft/msGraphFiles.js";

const STEPS = [
  { id: 1, title: "Dataflow info", short: "Info" },
  { id: 2, title: "Excel preview", short: "Excel" },
  { id: 3, title: "Transform builder", short: "Transform" },
  { id: 4, title: "Output preview", short: "Output" },
  { id: 5, title: "Column mapping", short: "Map" },
  { id: 6, title: "Unique key", short: "Key" },
  { id: 7, title: "Schedule & run", short: "Schedule" },
  { id: 8, title: "Review & save", short: "Review" }
];

const WIZARD_LAST_STEP = STEPS.length;

const DEFAULT_PIPELINE_SAFE = `{
  "version": 1,
  "steps": []
}`;

/** Match backend preview cap (see excelSourceReader readExcelWorkbookPreview). */
const READ_SOURCE_MAX_ROWS_PER_SHEET = 500_000;

function formatExcelPreviewCell(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Excel-like grid (not an HTML table): gutter + bordered cells. */
function DataflowsExcelSheetPreview({ columns, columnTypes, rows, gridPreview, compact, declaredRowCount }) {
  const grid = gridPreview && Array.isArray(gridPreview.rows) && gridPreview.rows.length ? gridPreview : null;
  if (grid) {
    const letters = Array.isArray(grid.columnLetters) ? grid.columnLetters : [];
    const gridRows = grid.rows;
    const colTpl = letters.length ? `2.75rem repeat(${letters.length}, minmax(7rem, max-content))` : "1fr";
    const meta = compact
      ? `${gridRows.length} row${gridRows.length === 1 ? "" : "s"} (Excel rows ${grid.startRow || 1}–${
          gridRows[gridRows.length - 1]?.rowNumber ?? "?"
        }) — same layout as the file`
      : `${gridRows.length} rows — exact sheet layout (column letters A, B, C…).`;

    return (
      <div
        className={`dataflows-excel-preview${compact ? " dataflows-excel-preview--compact" : ""} dataflows-excel-preview--raw`}
        role="region"
        aria-label="Excel sheet preview"
      >
        <p className="dataflows-excel-meta text-muted">{meta}</p>
        <div className="dataflows-excel-scroll">
          <div className="dataflows-excel-sheet">
            <div className="dataflows-excel-row dataflows-excel-row--header" style={{ gridTemplateColumns: colTpl }}>
              <div className="dataflows-excel-gutter" aria-hidden />
              {letters.map((letter) => (
                <div key={letter} className="dataflows-excel-cell dataflows-excel-cell--header">
                  <span className="dataflows-excel-hname">{letter}</span>
                </div>
              ))}
            </div>
            {gridRows.map((row) => (
              <div
                key={row.rowNumber}
                className="dataflows-excel-row dataflows-excel-row--data"
                style={{ gridTemplateColumns: colTpl }}
              >
                <div className="dataflows-excel-gutter">{row.rowNumber}</div>
                {(row.cells || []).map((cell, ci) => (
                  <div key={`${row.rowNumber}-${ci}`} className="dataflows-excel-cell">
                    {cell}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const cols = Array.isArray(columns) ? columns : [];
  const data = Array.isArray(rows) ? rows : [];
  const colTpl = cols.length ? `2.75rem repeat(${cols.length}, minmax(7rem, max-content))` : "1fr";
  const meta = compact
    ? data.length
      ? `${data.length} row${data.length === 1 ? "" : "s"} in preview${
          declaredRowCount != null && declaredRowCount !== data.length ? ` · engine row count ${declaredRowCount}` : ""
        }`
      : declaredRowCount != null
        ? `No rows in this preview sample · engine row count ${declaredRowCount}`
        : "No preview rows yet — fix JSON or run when the pipeline returns data."
    : `${data.length} row${data.length === 1 ? "" : "s"} in preview (up to server limit).`;

  return (
    <div
      className={`dataflows-excel-preview${compact ? " dataflows-excel-preview--compact" : ""}`}
      role="region"
      aria-label="Excel sheet preview"
    >
      <p className="dataflows-excel-meta text-muted">{meta}</p>
      <div className="dataflows-excel-scroll">
        <div className="dataflows-excel-sheet">
          <div className="dataflows-excel-row dataflows-excel-row--header" style={{ gridTemplateColumns: colTpl }}>
            <div className="dataflows-excel-gutter" aria-hidden />
            {cols.map((c) => (
              <div key={c} className="dataflows-excel-cell dataflows-excel-cell--header">
                <span className="dataflows-excel-hname">{c}</span>
                {(columnTypes || {})[c] ? <span className="dataflows-excel-htype">{(columnTypes || {})[c]}</span> : null}
              </div>
            ))}
          </div>
          {data.map((row, ri) => (
            <div key={ri} className="dataflows-excel-row dataflows-excel-row--data" style={{ gridTemplateColumns: colTpl }}>
              <div className="dataflows-excel-gutter">{ri + 1}</div>
              {cols.map((c) => (
                <div key={c} className="dataflows-excel-cell">
                  {formatExcelPreviewCell(row[c])}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function emptyForm() {
  return {
    name: "",
    description: "",
    sourceType: "local_path",
    sourcePath: "",
    sheetName: "",
    excelTableName: "",
    transformationScript: DEFAULT_PIPELINE_SAFE,
    destinationTable: "",
    uniqueKeyColumn: "",
    upsertMode: "insert_update",
    scheduleType: "manual",
    scheduleValue: "",
    isEnabled: true,
    mappings: []
  };
}

function validateStep(step, ctx) {
  const { form, workbook, transformOk, transformOutput, savedDataflowId } = ctx;
  switch (step) {
    case 1:
      if (!String(form.name || "").trim()) return "Enter a dataflow name.";
      if (!ctx.effectiveCompanyId) return "Select a company.";
      if (!String(form.sourcePath || "").trim()) return "Enter the Excel file path or URL.";
      return "";
    case 2:
      if (!workbook || workbook.error) return workbook?.error || "Excel must load successfully before continuing.";
      return "";
    case 3: {
      const pc = ctx.pipelineCheck;
      if (!pc || !pc.ok) return "Fix transformation pipeline validation errors before continuing.";
      if (!ctx.transformOk) return "Run the transformation preview successfully before continuing.";
      return "";
    }
    case 4:
      if (!transformOutput?.columns?.length) return "Confirm the output preview (re-run transform if needed).";
      return "";
    case 5:
      if (!String(form.destinationTable || "").trim()) return "Enter or select a destination SQL table.";
      return "";
    case 6:
      if (!String(form.uniqueKeyColumn || "").trim()) return "Choose the unique key (upsert) column.";
      if (
        !form.mappings.some(
          (m) => m.isMapped !== false && String(m.destinationColumn).trim() === String(form.uniqueKeyColumn).trim()
        )
      )
        return "The unique key column must be mapped from a source column.";
      return "";
    case 7:
      if (form.scheduleType === "interval_minutes") {
        const n = Number(String(form.scheduleValue || "").trim());
        if (!Number.isFinite(n) || n < 1) return "Enter interval in minutes (1 or more).";
      }
      if (form.scheduleType === "daily") {
        if (!/^\d{1,2}:\d{2}$/.test(String(form.scheduleValue || "").trim())) return "Daily schedule needs time as HH:mm.";
      }
      if (form.scheduleType === "weekly") {
        if (!ctx.weeklyTime || !ctx.weeklyWeekday) return "Pick weekday and time for weekly schedule.";
      }
      return "";
    case 8:
      return "";
    default:
      return "";
  }
}

export default function CompanyDataflowsPanel({ workspaceCompanyId, companies = [], isSuperAdmin = false }) {
  const [view, setView] = useState("list");
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listErr, setListErr] = useState("");
  const [wizardStep, setWizardStep] = useState(1);
  const [effectiveCompanyId, setEffectiveCompanyId] = useState(workspaceCompanyId);
  const [form, setForm] = useState(emptyForm);
  const [savedDataflowId, setSavedDataflowId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [workbook, setWorkbook] = useState(null);
  const [workbookErr, setWorkbookErr] = useState("");
  const [transformErr, setTransformErr] = useState("");
  const [transformOk, setTransformOk] = useState(false);
  const [transformOutput, setTransformOutput] = useState(null);
  const [transformPreviewBusy, setTransformPreviewBusy] = useState(false);
  const [transformServerErrors, setTransformServerErrors] = useState([]);
  const [transformUiWarnings, setTransformUiWarnings] = useState([]);
  const [sqlTables, setSqlTables] = useState([]);
  const [destSchema, setDestSchema] = useState([]);
  const [runs, setRuns] = useState([]);
  const [runDetail, setRunDetail] = useState(null);
  const [runErrors, setRunErrors] = useState([]);
  const [weeklyWeekday, setWeeklyWeekday] = useState(1);
  const [weeklyTime, setWeeklyTime] = useState("09:00");

  const [graphPickerOpen, setGraphPickerOpen] = useState(false);
  const [graphPickerMode, setGraphPickerMode] = useState("onedrive");
  const [graphPickerStack, setGraphPickerStack] = useState([]);
  const [graphPickerItems, setGraphPickerItems] = useState([]);
  const [graphPickerLoading, setGraphPickerLoading] = useState(false);
  const [graphPickerErr, setGraphPickerErr] = useState("");
  const [graphSitePath, setGraphSitePath] = useState("");

  const graphPickerStackKey = useMemo(() => JSON.stringify(graphPickerStack), [graphPickerStack]);

  useEffect(() => {
    setEffectiveCompanyId(workspaceCompanyId);
  }, [workspaceCompanyId]);

  /** Microsoft Graph folder listing for OneDrive / SharePoint library picker */
  useEffect(() => {
    if (!graphPickerOpen || graphPickerStack.length === 0) return;
    let cancelled = false;
    (async () => {
      setGraphPickerLoading(true);
      setGraphPickerErr("");
      try {
        const token = await acquireGraphFilesAccessToken();
        const last = graphPickerStack[graphPickerStack.length - 1];
        let data;
        if (last.kind === "me") {
          data = await listMeDriveRootChildren(token);
        } else if (last.kind === "driveRoot") {
          data = await listDriveRootChildren(token, last.driveId);
        } else if (last.kind === "driveFolder") {
          data = await listDriveItemChildren(token, last.driveId, last.itemId);
        } else {
          data = { value: [] };
        }
        if (!cancelled) setGraphPickerItems(data.value || []);
      } catch (e) {
        if (!cancelled) {
          setGraphPickerErr(e.message || "Could not list folder");
          setGraphPickerItems([]);
        }
      } finally {
        if (!cancelled) setGraphPickerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graphPickerOpen, graphPickerStackKey]);

  const cid = effectiveCompanyId;

  const pipelineCheck = useMemo(
    () =>
      validatePipelineText(form.transformationScript || "", {
        sheetNames: workbook?.sheetNames || []
      }),
    [form.transformationScript, workbook?.sheetNames]
  );

  const loadList = useCallback(async () => {
    if (workspaceCompanyId == null) return;
    setLoadingList(true);
    setListErr("");
    try {
      const data = await api.listCompanyDataflows(workspaceCompanyId);
      setList(data.dataflows || []);
    } catch (e) {
      setListErr(e.message || "Failed to load dataflows");
      setList([]);
    } finally {
      setLoadingList(false);
    }
  }, [workspaceCompanyId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadSqlTables = useCallback(async () => {
    try {
      const data = await api.getSqlTables();
      setSqlTables(data.tables || []);
    } catch {
      setSqlTables([]);
    }
  }, []);

  useEffect(() => {
    if (view === "wizard") void loadSqlTables();
  }, [view, loadSqlTables]);

  const loadDestSchema = useCallback(async (table) => {
    const t = String(table || "").trim();
    if (!t) {
      setDestSchema([]);
      return;
    }
    try {
      const data = await api.getSqlTableSchema(t);
      setDestSchema(data.columns || []);
    } catch {
      setDestSchema([]);
    }
  }, []);

  useEffect(() => {
    if (view === "wizard" && wizardStep >= 5) void loadDestSchema(form.destinationTable);
  }, [view, wizardStep, form.destinationTable, loadDestSchema]);

  const loadRuns = useCallback(async (dataflowId) => {
    if (!dataflowId) return;
    try {
      const data = await api.getDataflowRuns(dataflowId, { limit: 30 });
      setRuns(data.runs || []);
    } catch {
      setRuns([]);
    }
  }, []);

  function resetWizard() {
    setWizardStep(1);
    setForm(emptyForm());
    setSavedDataflowId(null);
    setWorkbook(null);
    setWorkbookErr("");
    setTransformErr("");
    setTransformOk(false);
    setTransformOutput(null);
    setTransformPreviewBusy(false);
    setTransformServerErrors([]);
    setTransformUiWarnings([]);
    setMsg("");
    setRunDetail(null);
    setRunErrors([]);
    setWeeklyWeekday(1);
    setWeeklyTime("09:00");
  }

  function openCreateWizard() {
    resetWizard();
    setEffectiveCompanyId(workspaceCompanyId);
    setView("wizard");
  }

  async function openEditWizard(id) {
    resetWizard();
    setBusy(true);
    setView("wizard");
    try {
      const data = await api.getDataflow(id);
      const row = data.dataflow;
      setSavedDataflowId(row.id);
      setEffectiveCompanyId(row.companyId);
      setForm({
        name: row.name ?? "",
        description: row.description ?? "",
        sourceType: row.sourceType ?? "local_path",
        sourcePath: row.sourcePath ?? "",
        sheetName: row.sheetName ?? "",
        excelTableName: row.excelTableName ?? "",
        transformationScript: row.transformationScript || DEFAULT_PIPELINE_SAFE,
        destinationTable: row.destinationTable ?? "",
        uniqueKeyColumn: row.uniqueKeyColumn ?? "",
        upsertMode: row.upsertMode ?? "insert_update",
        scheduleType: row.scheduleType ?? "manual",
        scheduleValue: row.scheduleValue ?? "",
        isEnabled: row.isEnabled !== false,
        mappings: (data.mappings || []).map((m) => ({
          sourceColumn: m.sourceColumn,
          destinationColumn: m.destinationColumn,
          destinationDataType: m.destinationDataType,
          isRequired: !!m.isRequired,
          isMapped: m.isMapped !== false,
          defaultValue: m.defaultValue ?? "",
          expression: m.expression ?? ""
        }))
      });
      if (row.scheduleType === "weekly" && row.scheduleValue) {
        try {
          const o = JSON.parse(row.scheduleValue);
          if (o.weekday != null) setWeeklyWeekday(Number(o.weekday) || 1);
          if (o.time) setWeeklyTime(String(o.time));
        } catch {
          /* ignore */
        }
      }
      void loadRuns(row.id);
    } catch (e) {
      setMsg(e.message || "Failed to load dataflow");
      setView("list");
    } finally {
      setBusy(false);
    }
  }

  function closeGraphPicker() {
    setGraphPickerOpen(false);
    setGraphPickerErr("");
    setGraphPickerItems([]);
    setGraphPickerStack([]);
    setGraphSitePath("");
    setGraphPickerLoading(false);
  }

  function setGraphPickerTab(mode) {
    setGraphPickerMode(mode);
    setGraphPickerErr("");
    if (mode === "onedrive") {
      setGraphPickerStack([{ kind: "me", label: "OneDrive" }]);
    } else {
      setGraphPickerStack([]);
      setGraphPickerItems([]);
    }
  }

  function openGraphPicker() {
    if (!isGraphFilesBrowseConfigured()) {
      setMsg("Set VITE_MS_CLIENT_ID (same Azure app as Microsoft mail) and add Graph permissions Files.Read.All and Sites.Read.All.");
      return;
    }
    setGraphPickerOpen(true);
    setGraphPickerTab("onedrive");
  }

  async function connectSharePointSiteLibrary() {
    const p = String(graphSitePath || "").trim();
    if (!p) {
      setGraphPickerErr("Paste your SharePoint site URL (from the browser) or host:path.");
      return;
    }
    setGraphPickerLoading(true);
    setGraphPickerErr("");
    try {
      const token = await acquireGraphFilesAccessToken();
      const { driveId, label } = await resolveSharePointSiteDrive(token, p);
      setGraphPickerStack([{ kind: "driveRoot", driveId, label }]);
    } catch (e) {
      setGraphPickerErr(e.message || "Could not open site");
    } finally {
      setGraphPickerLoading(false);
    }
  }

  function graphPickerEnterFolder(item) {
    if (!item?.folder || !item.parentReference?.driveId) return;
    setGraphPickerStack((s) => [
      ...s,
      {
        kind: "driveFolder",
        driveId: item.parentReference.driveId,
        itemId: item.id,
        label: item.name || "Folder"
      }
    ]);
  }

  function graphPickerGotoCrumb(i) {
    setGraphPickerStack((s) => s.slice(0, i + 1));
  }

  async function graphPickerSelectExcel(item) {
    if (!isExcelGraphItem(item) || !item.parentReference?.driveId) return;
    setGraphPickerLoading(true);
    setGraphPickerErr("");
    try {
      const token = await acquireGraphFilesAccessToken();
      const url = await getExcelDownloadUrl(token, item.parentReference.driveId, item.id);
      if (!url) throw new Error("No download URL returned. Check permissions or try another file.");
      setForm((f) => ({ ...f, sourceType: "url", sourcePath: url }));
      setMsg(
        "Path filled from Microsoft 365. Graph download links expire after about an hour — use a stable URL or server path for scheduled sync."
      );
      closeGraphPicker();
    } catch (e) {
      setGraphPickerErr(e.message || "Could not resolve file");
    } finally {
      setGraphPickerLoading(false);
    }
  }

  /** Load workbook when entering step 2 (first sheet default; all sheets for transforms). */
  useEffect(() => {
    if (view !== "wizard" || wizardStep !== 2 || cid == null) return;
    const path = String(form.sourcePath || "").trim();
    if (!path) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setWorkbookErr("");
      setWorkbook(null);
      try {
        const meta = await api.postDataflowReadSource({
          companyId: cid,
          sourceType: form.sourceType,
          sourcePath: form.sourcePath,
          maxRowsPerSheet: READ_SOURCE_MAX_ROWS_PER_SHEET
        });
        if (!cancelled) {
          setWorkbook(meta);
          setWorkbookErr("");
        }
      } catch (e) {
        if (!cancelled) {
          setWorkbook(null);
          setWorkbookErr(e.message || "Could not read Excel file.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, wizardStep, cid, form.sourcePath, form.sourceType]);

  const setTransformationScript = useCallback((next) => {
    setForm((f) => ({
      ...f,
      transformationScript: typeof next === "function" ? next(f.transformationScript) : next
    }));
    setTransformOk(false);
  }, []);

  const onValidateTransformOnly = useCallback(() => {
    const pc = validatePipelineText(form.transformationScript || "", {
      sheetNames: workbook?.sheetNames || []
    });
    if (pc.ok) setMsg("Client validation passed. Run preview to confirm with live data.");
    else setMsg(summarizeValidation(pc.errors, pc.warnings) || "Invalid pipeline.");
  }, [form.transformationScript, workbook?.sheetNames]);

  const runTransformPreview = useCallback(
    async (mode = "manual") => {
      if (cid == null) return;
      const debounced = mode === "debounced";

      const pc = validatePipelineText(form.transformationScript || "", {
        sheetNames: workbook?.sheetNames || []
      });
      if (!pc.ok) {
        setTransformOk(false);
        setTransformServerErrors([]);
        setTransformUiWarnings([]);
        setTransformErr("");
        if (!debounced) setTransformOutput(null);
        if (debounced) setTransformPreviewBusy(false);
        return;
      }

      if (debounced) {
        setTransformErr("");
        setTransformOk(false);
      } else {
        setTransformErr("");
        setTransformOk(false);
        setTransformOutput(null);
      }

      if (debounced) setTransformPreviewBusy(true);
      else setBusy(true);
      setTransformServerErrors([]);
      try {
        const out = await api.postDataflowPreview({
          companyId: cid,
          sourceType: form.sourceType,
          sourcePath: form.sourcePath,
          transformationScript: form.transformationScript,
          maxRows: 4000
        });
        setTransformErr("");
        setTransformOk(true);
        setTransformOutput({ columns: out.columns, rows: out.rows, rowCount: out.rowCount });
        setTransformUiWarnings(Array.isArray(out.warnings) ? out.warnings : []);
        setTransformServerErrors([]);
      } catch (e) {
        setTransformErr(e.message || "Preview failed.");
        setTransformOk(false);
        setTransformServerErrors(Array.isArray(e.validationErrors) ? e.validationErrors : []);
        setTransformUiWarnings(Array.isArray(e.warnings) ? e.warnings : []);
        if (!debounced) setTransformOutput(null);
      } finally {
        if (debounced) setTransformPreviewBusy(false);
        else setBusy(false);
      }
    },
    [cid, form.transformationScript, form.sourceType, form.sourcePath, workbook?.sheetNames]
  );

  const pipelineStepCount = useMemo(() => {
    const p = parsePipelineText(form.transformationScript);
    return p?.steps?.length ?? 0;
  }, [form.transformationScript]);

  const addPipelineStep = useCallback(
    (step) => {
      setForm((f) => {
        const base = parsePipelineText(f.transformationScript) || { version: 1, steps: [] };
        return { ...f, transformationScript: stringifyPipeline(appendStep(base, step)) };
      });
      setTransformOk(false);
      window.setTimeout(() => void runTransformPreview("manual"), 0);
    },
    [runTransformPreview]
  );

  const setPipelineFromString = useCallback(
    (text) => {
      setTransformationScript(text);
      setTransformOk(false);
      window.setTimeout(() => void runTransformPreview("manual"), 0);
    },
    [setTransformationScript, runTransformPreview]
  );

  /** Re-run transform preview while editing JSON (step 3). */
  useEffect(() => {
    if (view !== "wizard" || wizardStep !== 3 || cid == null) return;
    if (!String(form.sourcePath || "").trim()) return;
    const t = window.setTimeout(() => {
      void runTransformPreview("debounced");
    }, 750);
    return () => window.clearTimeout(t);
  }, [view, wizardStep, cid, form.transformationScript, form.sourcePath, form.sourceType, runTransformPreview]);

  async function onAutoMap() {
    if (cid == null) return;
    const srcCols = (transformOutput?.columns || []).map((name) => ({ name }));
    if (!form.destinationTable || !srcCols.length) {
      setMsg("Set destination table and complete output preview first.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const data = await api.postDataflowAutoMap({
        companyId: cid,
        destinationTable: form.destinationTable,
        sourceColumns: srcCols
      });
      const sugg = data.suggestions || [];
      const destCols = data.destinationColumns || [];
      const byDest = new Map(form.mappings.map((m) => [m.destinationColumn, { ...m }]));
      for (const s of sugg) {
        const dt = destCols.find((c) => c.column === s.destinationColumn)?.dataType || "";
        byDest.set(s.destinationColumn, {
          sourceColumn: s.sourceColumn,
          destinationColumn: s.destinationColumn,
          destinationDataType: dt,
          isRequired: byDest.get(s.destinationColumn)?.isRequired || false,
          isMapped: true,
          defaultValue: byDest.get(s.destinationColumn)?.defaultValue || "",
          expression: byDest.get(s.destinationColumn)?.expression || ""
        });
      }
      for (const dc of destCols) {
        if (dc.isIdentity || dc.isComputed) continue;
        if (!byDest.has(dc.column)) {
          byDest.set(dc.column, {
            sourceColumn: "",
            destinationColumn: dc.column,
            destinationDataType: dc.dataType || "",
            isRequired: false,
            isMapped: false,
            defaultValue: "",
            expression: ""
          });
        }
      }
      setForm((f) => ({
        ...f,
        mappings: Array.from(byDest.values()).sort((a, b) => a.destinationColumn.localeCompare(b.destinationColumn))
      }));
      setMsg(`Auto-mapped ${sugg.length} column(s).`);
    } catch (e) {
      setMsg(e.message || "Auto-map failed");
    } finally {
      setBusy(false);
    }
  }

  function buildSchedulePayload() {
    if (form.scheduleType === "weekly") {
      return JSON.stringify({ weekday: weeklyWeekday, time: weeklyTime });
    }
    return form.scheduleValue;
  }

  async function saveDataflowFromWizard() {
    if (cid == null) return;
    setBusy(true);
    setMsg("");
    try {
      const body = {
        ...form,
        scheduleValue: buildSchedulePayload(),
        mappings: form.mappings
      };
      if (savedDataflowId) {
        await api.putDataflow(savedDataflowId, body);
        setMsg("Saved.");
        await loadRuns(savedDataflowId);
      } else {
        const data = await api.postCompanyDataflow(cid, body);
        const newId = data.dataflow.id;
        setSavedDataflowId(newId);
        setMsg("Saved. You can run a test below.");
        await loadRuns(newId);
      }
      await loadList();
    } catch (e) {
      setMsg(e.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onTestRun() {
    if (!savedDataflowId) return;
    setBusy(true);
    setMsg("");
    try {
      const data = await api.postDataflowRun(savedDataflowId);
      setMsg(
        `Test run: ${data.summary?.status} — inserted ${data.summary?.inserted ?? 0}, updated ${data.summary?.updated ?? 0}, skipped ${data.summary?.skipped ?? 0}, failed ${data.summary?.failed ?? 0}.`
      );
      await loadList();
      await loadRuns(savedDataflowId);
    } catch (e) {
      setMsg(e.message || "Test run failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteFromList(id) {
    if (!window.confirm("Delete this dataflow?")) return;
    setBusy(true);
    try {
      await api.deleteDataflow(id);
      await loadList();
    } catch (e) {
      setListErr(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function openRun(rid) {
    setRunDetail(null);
    setRunErrors([]);
    try {
      const [r, er] = await Promise.all([api.getDataflowRun(rid), api.getDataflowRunErrors(rid, { limit: 200 })]);
      setRunDetail(r.run);
      setRunErrors(er.errors || []);
    } catch (e) {
      setMsg(e.message || "Run detail failed");
    }
  }

  const stepCtx = useMemo(
    () => ({
      form,
      workbook: workbook && !workbookErr ? workbook : null,
      workbookErr,
      transformOk,
      transformOutput,
      savedDataflowId,
      effectiveCompanyId: cid,
      weeklyTime,
      weeklyWeekday,
      pipelineCheck
    }),
    [form, workbook, workbookErr, transformOk, transformOutput, savedDataflowId, cid, weeklyTime, weeklyWeekday, pipelineCheck]
  );

  const stepError = validateStep(wizardStep, stepCtx);

  function goNext() {
    const err = validateStep(wizardStep, stepCtx);
    if (err) {
      setMsg(err);
      return;
    }
    setMsg("");
    setWizardStep((s) => Math.min(WIZARD_LAST_STEP, s + 1));
  }

  function goBack() {
    setMsg("");
    setWizardStep((s) => Math.max(1, s - 1));
  }

  function addMappingRow() {
    setForm((f) => ({
      ...f,
      mappings: [
        ...f.mappings,
        {
          sourceColumn: "",
          destinationColumn: "",
          destinationDataType: "",
          isRequired: false,
          isMapped: true,
          defaultValue: "",
          expression: ""
        }
      ]
    }));
  }

  if (workspaceCompanyId == null) {
    return <p className="text-muted">Select a company to manage dataflows.</p>;
  }

  if (view === "list") {
    return (
      <div className="admin-page-panel dataflows-admin-fullwidth" role="tabpanel" id="admin-panel-dataflows">
        <div className="dataflows-list-page">
          <div className="dataflows-list-page__head">
            <h3 className="dataflows-list-page__title">
              <GitBranch size={20} aria-hidden /> Company dataflows
            </h3>
            <button type="button" className="btn btn-primary" onClick={openCreateWizard} disabled={busy}>
              <Plus size={18} aria-hidden /> New dataflow
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void loadList()} disabled={busy}>
              <RefreshCw size={18} aria-hidden /> Refresh
            </button>
          </div>
          {loadingList ? (
            <p className="text-muted">Loading…</p>
          ) : listErr ? (
            <p className="text-danger">{listErr}</p>
          ) : list.length === 0 ? (
            <p className="text-muted">No dataflows yet. Create one to import Excel into SQL Server.</p>
          ) : (
            <table className="dataflows-list-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Destination</th>
                  <th>Schedule</th>
                  <th>Last run</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <button type="button" className="btn btn-ghost dataflows-link" onClick={() => void openEditWizard(d.id)}>
                        {d.name || "(unnamed)"}
                      </button>
                    </td>
                    <td>{d.destinationTable || "—"}</td>
                    <td>{d.scheduleType || "—"}</td>
                    <td>{d.lastRunAt ? `${d.lastRunStatus || ""} ${new Date(d.lastRunAt).toLocaleString()}` : "—"}</td>
                    <td>
                      <button type="button" className="btn btn-ghost" title="Delete" onClick={() => void onDeleteFromList(d.id)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page-panel dataflows-wizard-shell dataflows-admin-fullwidth" role="tabpanel" id="admin-panel-dataflows-wizard">
      <div className="dataflows-wizard-top">
        <button type="button" className="btn btn-ghost" onClick={() => setView("list")}>
          <ChevronLeft size={18} /> Back to list
        </button>
        {msg ? <span className="dataflows-wizard-banner">{msg}</span> : null}
      </div>

      <div className="dataflows-wizard">
        <nav className="dataflows-wizard__steps" aria-label="Dataflow wizard steps">
          {STEPS.map((s) => (
            <div
              key={s.id}
              className={`dataflows-wizard__step${wizardStep === s.id ? " is-active" : ""}${wizardStep > s.id ? " is-done" : ""}`}
            >
              <span className="dataflows-wizard__step-num">{wizardStep > s.id ? <Check size={14} /> : s.id}</span>
              <span className="dataflows-wizard__step-text">{s.short}</span>
            </div>
          ))}
        </nav>

        <div className="dataflows-wizard__body card-like">
          <h3 className="dataflows-wizard__title">{STEPS[wizardStep - 1]?.title}</h3>
          {stepError && wizardStep < 7 ? <p className="dataflows-wizard-hint text-muted">Complete this step: {stepError}</p> : null}

          {wizardStep === 1 ? (
            <div className="dataflows-wizard-grid">
              {isSuperAdmin && companies.length ? (
                <label className="dataflows-field">
                  <span>Company</span>
                  <select
                    value={String(effectiveCompanyId ?? "")}
                    onChange={(e) => setEffectiveCompanyId(Number(e.target.value) || null)}
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="dataflows-field dataflows-field--wide">
                <span>Dataflow name</span>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="dataflows-field dataflows-field--wide">
                <span>Description (optional)</span>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </label>
              <label className="dataflows-field">
                <span>Source type</span>
                <select value={form.sourceType} onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}>
                  <option value="local_path">Local / server path</option>
                  <option value="url">HTTPS URL</option>
                  <option value="sharepoint">Cloud / SharePoint (stored type; browse fills URL)</option>
                </select>
              </label>
              <label className="dataflows-field dataflows-field--wide">
                <span>Excel file path or URL</span>
                <div className="dataflows-path-row">
                  <input
                    value={form.sourcePath}
                    onChange={(e) => setForm((f) => ({ ...f, sourcePath: e.target.value }))}
                    placeholder="Path under allowed folders, or https://…/file.xlsx"
                  />
                  <button type="button" className="btn btn-ghost dataflows-browse-graph" onClick={openGraphPicker} title="Pick from OneDrive or SharePoint">
                    <Folder size={16} aria-hidden /> Browse…
                  </button>
                </div>
              </label>
              <p className="dataflows-field dataflows-field--wide text-muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                Use <strong>Browse</strong> to sign in with Microsoft and pick an Excel file from OneDrive or a SharePoint document library (requires Azure app permissions{" "}
                <code>Files.Read.All</code> and <code>Sites.Read.All</code>). The API stores a short-lived download URL — for scheduled sync prefer a permanent link or a path on the
                server. The next step reads the workbook automatically (first sheet preview; all sheets in transforms via <code>useSheet</code> / <code>appendSheet</code>).
              </p>
            </div>
          ) : null}

          {wizardStep === 2 ? (
            <div className="dataflows-wizard-grid">
              {busy && !workbook ? (
                <p>
                  <Loader2 className="dataflows-spin" size={18} /> Reading workbook…
                </p>
              ) : null}
              {workbookErr || workbook?.error ? (
                <div className="dataflows-alert dataflows-alert--err" role="alert">
                  <AlertCircle size={18} /> {workbookErr || workbook?.error}
                </div>
              ) : null}
              {workbook ? (
                <>
                  <p className="text-muted" style={{ fontSize: "0.88rem", margin: 0 }}>
                    Default sheet: <strong>{workbook.defaultSheet}</strong> · Other: {(workbook.sheetNames || []).join(", ") || "—"}.
                    Preview below matches the Excel file row-for-row (A, B, C…). For reports with title rows (e.g. Collection Report), use{" "}
                    <strong>Transform</strong> → template <em>Collection report</em> or add{" "}
                    <em>Remove top 5 rows</em> then <em>First row as column names</em>.
                  </p>
                  <DataflowTransformToolbar
                    columns={workbook.defaultPreview?.columns || []}
                    onAddStep={addPipelineStep}
                    disabled={busy || transformPreviewBusy}
                  />
                  {transformOutput?.columns?.length && pipelineStepCount > 0 ? (
                    <>
                      <p className="text-muted" style={{ fontSize: "0.82rem", margin: "0.5rem 0 0" }}>
                        <strong>Transformed preview</strong> (first 50 rows)
                      </p>
                      <DataflowsExcelSheetPreview
                        compact
                        declaredRowCount={transformOutput.rowCount}
                        columns={transformOutput.columns}
                        columnTypes={null}
                        rows={(transformOutput.rows || []).slice(0, 50)}
                      />
                    </>
                  ) : (
                    <>
                      <p className="text-muted" style={{ fontSize: "0.82rem", margin: "0.5rem 0 0" }}>
                        <strong>Sheet preview</strong> (exact Excel layout — first 80 rows)
                      </p>
                      <DataflowsExcelSheetPreview
                        compact
                        gridPreview={{
                          ...(workbook.defaultPreview?.gridPreview || {}),
                          rows: (workbook.defaultPreview?.gridPreview?.rows || []).slice(0, 80)
                        }}
                      />
                    </>
                  )}
                </>
              ) : null}
            </div>
          ) : null}

          {wizardStep === 3 ? (
            <DataflowTransformWizardStep
              transformationScript={form.transformationScript}
              onTransformationScriptChange={setTransformationScript}
              onPipelineChange={setPipelineFromString}
              onAddStep={addPipelineStep}
              workbook={workbook && !workbookErr ? workbook : null}
              transformErr={transformErr}
              transformOk={transformOk}
              transformOutput={transformOutput}
              transformPreviewBusy={transformPreviewBusy}
              transformWarnings={transformUiWarnings}
              clientValidation={pipelineCheck}
              serverValidationErrors={transformServerErrors}
              onRunPreview={runTransformPreview}
              onValidateOnly={onValidateTransformOnly}
              busy={busy}
              defaultPipelineText={DEFAULT_PIPELINE_SAFE}
            />
          ) : null}

          {wizardStep === 4 ? (
            <div className="dataflows-wizard-grid">
              <p className="text-muted" style={{ margin: 0 }}>
                Confirm the transformed columns and rows before mapping to SQL (same preview as the Transform step).
              </p>
              {transformOutput?.columns?.length ? (
                <DataflowsExcelSheetPreview
                  compact
                  declaredRowCount={transformOutput.rowCount}
                  columns={transformOutput.columns}
                  columnTypes={null}
                  rows={(transformOutput.rows || []).slice(0, 100)}
                />
              ) : (
                <p className="text-danger">No preview — go back to Transform and fix the pipeline.</p>
              )}
            </div>
          ) : null}

          {wizardStep === 5 ? (
            <div className="dataflows-wizard-grid">
              <label className="dataflows-field">
                <span>Destination table (dbo)</span>
                <input
                  list="df-sqltables"
                  value={form.destinationTable}
                  onChange={(e) => setForm((f) => ({ ...f, destinationTable: e.target.value }))}
                />
                <datalist id="df-sqltables">
                  {sqlTables.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <div className="dataflows-field dataflows-field--wide">
                <div className="dataflows-mappings-head">
                  <span>Column mappings</span>
                  <button type="button" className="btn btn-ghost" onClick={() => void onAutoMap()} disabled={busy}>
                    Auto-map
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={addMappingRow}>
                    Add row
                  </button>
                </div>
                <div className="dataflows-mappings">
                  <table className="dataflows-map-table">
                    <thead>
                      <tr>
                        <th>Source (output col)</th>
                        <th>SQL column</th>
                        <th>Mapped</th>
                        <th>Required</th>
                        <th>Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.mappings.map((m, idx) => (
                        <tr key={idx}>
                          <td>
                            <input
                              list="df-src"
                              value={m.sourceColumn}
                              onChange={(e) => {
                                const v = e.target.value;
                                setForm((f) => {
                                  const next = [...f.mappings];
                                  next[idx] = { ...next[idx], sourceColumn: v };
                                  return { ...f, mappings: next };
                                });
                              }}
                            />
                          </td>
                          <td>
                            <input
                              list="df-dst"
                              value={m.destinationColumn}
                              onChange={(e) => {
                                const v = e.target.value;
                                setForm((f) => {
                                  const next = [...f.mappings];
                                  next[idx] = { ...next[idx], destinationColumn: v };
                                  return { ...f, mappings: next };
                                });
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={m.isMapped !== false}
                              onChange={(e) => {
                                const v = e.target.checked;
                                setForm((f) => {
                                  const next = [...f.mappings];
                                  next[idx] = { ...next[idx], isMapped: v };
                                  return { ...f, mappings: next };
                                });
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={!!m.isRequired}
                              onChange={(e) => {
                                const v = e.target.checked;
                                setForm((f) => {
                                  const next = [...f.mappings];
                                  next[idx] = { ...next[idx], isRequired: v };
                                  return { ...f, mappings: next };
                                });
                              }}
                            />
                          </td>
                          <td>
                            <input
                              value={m.defaultValue || ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setForm((f) => {
                                  const next = [...f.mappings];
                                  next[idx] = { ...next[idx], defaultValue: v };
                                  return { ...f, mappings: next };
                                });
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <datalist id="df-src">
                    {(transformOutput?.columns || []).map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <datalist id="df-dst">
                    {destSchema.map((c) => (
                      <option key={c.column} value={c.column} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>
          ) : null}

          {wizardStep === 6 ? (
            <div className="dataflows-wizard-grid">
              <p className="text-muted" style={{ margin: 0 }}>
                Choose the SQL column used to match rows for upsert (must be mapped on the previous step).
              </p>
              <label className="dataflows-field">
                <span>Unique key column (SQL)</span>
                <input
                  list="df-uk"
                  value={form.uniqueKeyColumn}
                  onChange={(e) => setForm((f) => ({ ...f, uniqueKeyColumn: e.target.value }))}
                />
                <datalist id="df-uk">
                  {destSchema.map((c) => (
                    <option key={c.column} value={c.column} />
                  ))}
                </datalist>
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!form.uniqueKeyColumn || !transformOutput?.rows?.length}
                onClick={() => {
                  const uk = String(form.uniqueKeyColumn).trim();
                  const mapped = form.mappings.find(
                    (m) => m.isMapped !== false && String(m.destinationColumn).trim() === uk
                  );
                  const srcCol = mapped?.sourceColumn;
                  if (!srcCol) {
                    setMsg("Map the unique key column from a source column first.");
                    return;
                  }
                  const seen = new Map();
                  const dups = [];
                  for (const row of transformOutput.rows || []) {
                    const k = String(row[srcCol] ?? "").trim();
                    if (!k) continue;
                    if (seen.has(k)) dups.push(k);
                    else seen.set(k, true);
                  }
                  if (dups.length) setMsg(`Warning: ${dups.length} duplicate key value(s) in preview, e.g. "${dups[0]}".`);
                  else setMsg("No duplicate keys found in preview sample.");
                }}
              >
                Check duplicates in preview
              </button>
            </div>
          ) : null}

          {wizardStep === 7 ? (
            <div className="dataflows-wizard-grid">
              <label className="dataflows-field">
                <span>Upsert mode</span>
                <select value={form.upsertMode} onChange={(e) => setForm((f) => ({ ...f, upsertMode: e.target.value }))}>
                  <option value="insert_update">Insert + update (merge)</option>
                  <option value="insert_only">Insert only</option>
                  <option value="update_only">Update only</option>
                </select>
              </label>
              <label className="dataflows-field">
                <span>Sync frequency</span>
                <select
                  value={form.scheduleType}
                  onChange={(e) => setForm((f) => ({ ...f, scheduleType: e.target.value, scheduleValue: "" }))}
                >
                  <option value="manual">Manual only</option>
                  <option value="hourly">Hourly</option>
                  <option value="interval_minutes">Every N minutes</option>
                  <option value="daily">Daily at time (server local)</option>
                  <option value="weekly">Weekly (server local)</option>
                </select>
              </label>
              {form.scheduleType === "interval_minutes" ? (
                <label className="dataflows-field">
                  <span>Minutes</span>
                  <input
                    value={form.scheduleValue}
                    onChange={(e) => setForm((f) => ({ ...f, scheduleValue: e.target.value }))}
                    placeholder="e.g. 30"
                  />
                </label>
              ) : null}
              {form.scheduleType === "daily" ? (
                <label className="dataflows-field">
                  <span>Time (HH:mm)</span>
                  <input
                    value={form.scheduleValue}
                    onChange={(e) => setForm((f) => ({ ...f, scheduleValue: e.target.value }))}
                    placeholder="08:30"
                  />
                </label>
              ) : null}
              {form.scheduleType === "weekly" ? (
                <>
                  <label className="dataflows-field">
                    <span>Weekday (1=Mon … 7=Sun)</span>
                    <select value={weeklyWeekday} onChange={(e) => setWeeklyWeekday(Number(e.target.value))}>
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="dataflows-field">
                    <span>Time</span>
                    <input value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} placeholder="09:00" />
                  </label>
                </>
              ) : null}
              <label className="dataflows-field dataflows-field--check">
                <input
                  type="checkbox"
                  checked={form.isEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                />
                <span>Dataflow enabled for scheduled sync</span>
              </label>
            </div>
          ) : null}

          {wizardStep === 8 ? (
            <div className="dataflows-wizard-grid">
              <dl className="dataflows-summary">
                <dt>Name</dt>
                <dd>{form.name}</dd>
                <dt>Company ID</dt>
                <dd>{cid}</dd>
                <dt>Source</dt>
                <dd>
                  {form.sourceType} — {form.sourcePath}
                </dd>
                <dt>Destination</dt>
                <dd>{form.destinationTable}</dd>
                <dt>Unique key</dt>
                <dd>{form.uniqueKeyColumn}</dd>
                <dt>Schedule</dt>
                <dd>
                  {form.scheduleType}
                  {form.scheduleType === "weekly" ? ` — ${buildSchedulePayload()}` : form.scheduleValue ? ` — ${form.scheduleValue}` : ""}
                </dd>
                <dt>Upsert</dt>
                <dd>{form.upsertMode}</dd>
                <dt>Transform steps</dt>
                <dd>{pipelineStepCount}</dd>
                <dt>Mappings</dt>
                <dd>{form.mappings.filter((m) => m.isMapped !== false).length} active</dd>
              </dl>
              <div className="dataflows-actions">
                <button type="button" className="btn btn-primary" onClick={() => void saveDataflowFromWizard()} disabled={busy}>
                  {savedDataflowId ? "Update configuration" : "Save dataflow"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void onTestRun()} disabled={busy || !savedDataflowId}>
                  <Play size={16} /> Test run
                </button>
              </div>
              {savedDataflowId ? (
                <div className="dataflows-field dataflows-field--wide">
                  <span>Run history</span>
                  <ul className="dataflows-runs">
                    {runs.map((r) => (
                      <li key={r.id}>
                        <button type="button" className="btn btn-ghost" onClick={() => void openRun(r.id)}>
                          {r.startedAt ? new Date(r.startedAt).toLocaleString() : r.id} — {r.status}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {runDetail ? (
                    <div className="dataflows-run-detail">
                      <p>
                        <strong>Run {runDetail.id}</strong> {runDetail.status} — in {runDetail.insertedRows}/up {runDetail.updatedRows}
                        /skip {runDetail.skippedRows}/fail {runDetail.failedRows}
                      </p>
                      {runErrors.length ? (
                        <div className="dataflows-preview-wrap">
                          <table className="dataflows-preview">
                            <thead>
                              <tr>
                                <th>Row</th>
                                <th>Key</th>
                                <th>Error</th>
                              </tr>
                            </thead>
                            <tbody>
                              {runErrors.slice(0, 40).map((e) => (
                                <tr key={e.id}>
                                  <td>{e.rowNumber ?? "—"}</td>
                                  <td>{e.uniqueKeyValue ?? "—"}</td>
                                  <td>{e.errorMessage}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="dataflows-wizard__nav">
            <button type="button" className="btn btn-ghost" onClick={goBack} disabled={wizardStep <= 1 || busy}>
              <ChevronLeft size={18} /> Back
            </button>
            {wizardStep < WIZARD_LAST_STEP ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={goNext}
                disabled={busy || validateStep(wizardStep, stepCtx) !== ""}
              >
                Next <ChevronRight size={18} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {graphPickerOpen ? (
        <div
          className="dataflows-graph-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!graphPickerLoading) closeGraphPicker();
          }}
        >
          <div
            className="dataflows-graph-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="graph-picker-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dataflows-graph-modal__head">
              <h4 id="graph-picker-title" className="dataflows-graph-modal__title">
                Browse OneDrive / SharePoint
              </h4>
              <button
                type="button"
                className="btn btn-ghost dataflows-graph-modal__close"
                aria-label="Close"
                disabled={graphPickerLoading}
                onClick={closeGraphPicker}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dataflows-graph-modal__tabs">
              <button
                type="button"
                className={`btn btn-ghost${graphPickerMode === "onedrive" ? " is-active" : ""}`}
                onClick={() => setGraphPickerTab("onedrive")}
              >
                OneDrive
              </button>
              <button
                type="button"
                className={`btn btn-ghost${graphPickerMode === "site" ? " is-active" : ""}`}
                onClick={() => setGraphPickerTab("site")}
              >
                SharePoint site
              </button>
            </div>
            {graphPickerMode === "site" && graphPickerStack.length === 0 ? (
              <div className="dataflows-graph-modal__site-connect">
                <label className="dataflows-field dataflows-field--wide">
                  <span>SharePoint site</span>
                  <input
                    value={graphSitePath}
                    onChange={(e) => setGraphSitePath(e.target.value)}
                    placeholder="https://collectease360.sharepoint.com/sites/CollectEase3609"
                  />
                </label>
                <button type="button" className="btn btn-primary" onClick={() => void connectSharePointSiteLibrary()} disabled={graphPickerLoading}>
                  {graphPickerLoading ? <Loader2 className="dataflows-spin" size={16} /> : null} Open library
                </button>
              </div>
            ) : null}
            {graphPickerStack.length > 0 ? (
              <nav className="dataflows-graph-modal__crumbs" aria-label="Folder path">
                {graphPickerStack.map((cr, i) => (
                  <span key={`${cr.kind}-${i}-${cr.label || ""}`}>
                    {i > 0 ? <span className="dataflows-graph-modal__crumb-sep"> / </span> : null}
                    <button type="button" className="btn btn-ghost dataflows-graph-crumb" onClick={() => graphPickerGotoCrumb(i)}>
                      {cr.label || (cr.kind === "me" ? "OneDrive" : "Library")}
                    </button>
                  </span>
                ))}
              </nav>
            ) : null}
            {graphPickerErr ? (
              <div className="dataflows-alert dataflows-alert--err" role="alert">
                <AlertCircle size={18} /> {graphPickerErr}
              </div>
            ) : null}
            {graphPickerMode === "onedrive" || graphPickerStack.length > 0 ? (
              <div className="dataflows-graph-modal__list-wrap">
                {graphPickerLoading ? (
                  <p className="text-muted">
                    <Loader2 className="dataflows-spin" size={18} /> Loading…
                  </p>
                ) : (
                  <ul className="dataflows-graph-modal__list">
                    {[...graphPickerItems]
                      .sort((a, b) => {
                        const af = a.folder ? 0 : 1;
                        const bf = b.folder ? 0 : 1;
                        if (af !== bf) return af - bf;
                        return String(a.name || "").localeCompare(String(b.name || ""));
                      })
                      .map((item) => (
                        <li key={item.id}>
                          {item.folder ? (
                            <button type="button" className="dataflows-graph-item dataflows-graph-item--folder" onClick={() => graphPickerEnterFolder(item)}>
                              <Folder size={16} aria-hidden /> {item.name}
                            </button>
                          ) : isExcelGraphItem(item) ? (
                            <button type="button" className="dataflows-graph-item dataflows-graph-item--file" onClick={() => void graphPickerSelectExcel(item)}>
                              {item.name}
                            </button>
                          ) : (
                            <span className="dataflows-graph-item dataflows-graph-item--muted">{item.name}</span>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ) : null}
            <p className="dataflows-graph-modal__hint text-muted">
              Sign in with Microsoft if prompted. Admin consent may be required for <code>Files.Read.All</code> and <code>Sites.Read.All</code> on the app registration.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
