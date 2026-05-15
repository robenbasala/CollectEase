"use strict";

const repo = require("./dataflowsRepo");
const { executeDataflowRun } = require("./dataflowRunExecutor");

const POLL_MS = Number(process.env.DATAFLOW_SCHEDULER_POLL_MS || 60000);

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

/** @returns {{ weekday: number, hh: number, mm: number }|null} weekday 1=Mon … 7=Sun (matches wizard) */
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

/** JS getDay(): 0=Sun … 6=Sat — map from wizard 1=Mon … 7=Sun */
function jsWeekdayFromWizard(wd) {
  return wd === 7 ? 0 : wd;
}

/**
 * @param {object} df CompanyDataflow row
 * @param {Date} now
 */
function shouldRunScheduled(df, now) {
  if (df.IsEnabled !== true && df.IsEnabled !== 1) return false;
  const st = String(df.ScheduleType || "").toLowerCase();
  if (st === "manual") return false;
  const last = df.LastRunAt ? new Date(df.LastRunAt) : null;

  if (st === "interval_minutes") {
    const mins = parseMinutes(df.ScheduleValue);
    if (!mins) return false;
    if (!last) return true;
    return now.getTime() - last.getTime() >= mins * 60 * 1000;
  }

  if (st === "hourly") {
    if (!last) return true;
    return now.getTime() - last.getTime() >= 60 * 60 * 1000;
  }

  if (st === "daily") {
    const t = parseDailyTime(df.ScheduleValue);
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
    const w = parseWeeklySchedule(df.ScheduleValue);
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

function startDataflowScheduler() {
  if (process.env.DATAFLOW_SCHEDULER_DISABLED === "true") {
    console.log("[dataflow-scheduler] disabled via DATAFLOW_SCHEDULER_DISABLED");
    return;
  }
  setInterval(async () => {
    try {
      const flows = await repo.listEnabledScheduledDataflows();
      const now = new Date();
      for (const df of flows) {
        if (!shouldRunScheduled(df, now)) continue;
        try {
          await executeDataflowRun(df.CompanyId, df.Id);
        } catch (e) {
          console.error(`[dataflow-scheduler] run failed dataflow ${df.Id}`, e?.message || e);
        }
      }
    } catch (e) {
      console.error("[dataflow-scheduler] poll error", e?.message || e);
    }
  }, POLL_MS);
}

module.exports = { startDataflowScheduler };
