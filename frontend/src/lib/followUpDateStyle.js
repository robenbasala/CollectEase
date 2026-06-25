/** True when the calendar day is today or before today (local time). */
export function isDateTodayOrPast(value) {
  if (value == null || value === "") return false;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return false;
  const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return day.getTime() <= today.getTime();
}

/** Same red as balance column (`text-danger` / `--color-danger`). */
export function dateDueTextClass(value) {
  return isDateTodayOrPast(value) ? "text-danger" : "";
}
