// Every business in this demo is in Pacific time. Times are handled as
// "naive" wall-clock values (no zone) and stored as ISO strings like
// 2026-11-21T15:00:00. Internally we parse them as if they were UTC so
// that date arithmetic never shifts with the server's own time zone.

export const TIME_ZONE = "America/Los_Angeles";

// Parse "2026-11-21T15:00:00" (or with seconds missing) into a Date whose UTC fields hold the wall-clock time.
export function parseNaive(str) {
  if (typeof str !== "string") return null;
  const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  return isNaN(d) ? null : d;
}

// Format a naive Date back to "YYYY-MM-DDTHH:MM:SS".
export function formatNaive(d) {
  return d.toISOString().slice(0, 19);
}

// The current wall-clock time in Pacific, as a naive Date.
export function nowNaive(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}

export function addMinutes(d, minutes) {
  return new Date(d.getTime() + minutes * 60000);
}

// "Sat, Nov 21 at 3:00 PM"
export function readable(d) {
  const day = d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

// "Saturday, November 21st at 3 PM" (for Juno to say out loud)
export function spoken(d) {
  const day = d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const hour12 = ((h + 11) % 12) + 1, ampm = h < 12 ? "AM" : "PM";
  const time = m ? `${hour12}:${String(m).padStart(2, "0")} ${ampm}` : `${hour12} ${ampm}`;
  return `${day} at ${time}`;
}

// Minutes since midnight for an "HH:MM" string.
export function hhmmToMinutes(s) {
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return v >= 0 && v <= 24 * 60 ? v : null;
}

export function minutesOfDay(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function dateKey(d) {
  return d.toISOString().slice(0, 10);
}
