"use strict";

const etlRepo = require("./etlRepo");
const etlImportEngine = require("./etlImportEngine");

const POLL_MS = Number(process.env.ETL_SCHEDULER_POLL_MS || process.env.DATAFLOW_SCHEDULER_POLL_MS || 60000);

function parseMinutes(scheduleValue) {
  const n = Number(String(scheduleValue || "").trim());
  return Number.isFinite(n) && n > 0 ? Math.min(n, 24 * 60) : null;
}

function parseDailyTime(scheduleValue) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(scheduleValue || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function minutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseWeeklySchedule(scheduleValue) {
  try {
    const o = JSON.parse(String(scheduleValue || "{}"));
    const wd = Number(o.weekday);
    const t = parseDailyTime(String(o.time || "").trim());
    if (!Number.isInteger(wd) || wd < 1 || wd > 7 || !t) return null;
    return { weekday: wd, hh: t.hh, mm: t.mm };
  } catch {
    return null;
  }
}

function jsWeekdayFromWizard(wd) {
  return wd === 7 ? 0 : wd;
}

function shouldRunScheduled(row, now) {
  if (row.IsEnabled !== true && row.IsEnabled !== 1) return false;
  const st = String(row.ScheduleType || "").toLowerCase();
  if (st === "manual") return false;
  const last = row.LastRunAt ? new Date(row.LastRunAt) : null;

  if (st === "interval_minutes") {
    const mins = parseMinutes(row.ScheduleValue);
    if (!mins) return false;
    if (!last) return true;
    return now.getTime() - last.getTime() >= mins * 60 * 1000;
  }

  if (st === "hourly") {
    if (!last) return true;
    return now.getTime() - last.getTime() >= 60 * 60 * 1000;
  }

  if (st === "daily") {
    const t = parseDailyTime(row.ScheduleValue);
    if (!t) return false;
    const cur = minutesSinceMidnight(now);
    const target = t.hh * 60 + t.mm;
    if (cur < target) return false;
    if (!last) return true;
    const lastD = new Date(last);
    if (lastD.toDateString() === now.toDateString() && minutesSinceMidnight(lastD) >= target) {
      return false;
    }
    return true;
  }

  if (st === "weekly") {
    const w = parseWeeklySchedule(row.ScheduleValue);
    if (!w) return false;
    const jsWd = jsWeekdayFromWizard(w.weekday);
    if (now.getDay() !== jsWd) return false;
    const cur = minutesSinceMidnight(now);
    const target = w.hh * 60 + w.mm;
    if (cur < target) return false;
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), w.hh, w.mm, 0, 0);
    if (!last) return true;
    return last.getTime() < slot.getTime();
  }

  return false;
}

function startEtlScheduler() {
  if (process.env.ETL_SCHEDULER_DISABLED === "true") {
    console.log("[etl-scheduler] disabled via ETL_SCHEDULER_DISABLED");
    return;
  }
  setInterval(async () => {
    try {
      const flows = await etlRepo.listEnabledScheduledMappings();
      const now = new Date();
      for (const row of flows) {
        if (!shouldRunScheduled(row, now)) continue;
        try {
          await etlImportEngine.runMappingImport(row.CompanyId, row.Id, {
            triggerType: "scheduled",
            createdBy: "scheduler"
          });
        } catch (e) {
          console.error(`[etl-scheduler] run failed mapping ${row.Id}`, e?.message || e);
        }
      }
    } catch (e) {
      console.error("[etl-scheduler] poll error", e?.message || e);
    }
  }, POLL_MS);
  console.log(`[etl-scheduler] started (poll ${POLL_MS}ms)`);
}

module.exports = { startEtlScheduler, shouldRunScheduled };
