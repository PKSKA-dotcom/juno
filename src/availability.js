// The booking rules. Juno calls this during the call (through the
// check_availability tool) and the server runs it again when the booking
// arrives, so a time is never confirmed that the rules would reject.

import { parseNaive, formatNaive, nowNaive, addMinutes, readable, minutesOfDay, hhmmToMinutes } from "./time.js";

const SEARCH_DAYS = 7;
const STEP_MINUTES = 30;

// Find the business's service whose name is closest to what the caller said.
export function matchService(business, name) {
  const services = business?.services || [];
  if (!name) return null;
  const wanted = String(name).trim().toLowerCase();
  let best = services.find((s) => s.name.toLowerCase() === wanted);
  if (best) return best;
  best = services.find((s) => s.name.toLowerCase().includes(wanted) || wanted.includes(s.name.toLowerCase()));
  if (best) return best;
  // Word overlap as a last resort.
  const words = new Set(wanted.split(/\W+/).filter((w) => w.length > 2));
  let score = 0;
  for (const s of services) {
    const n = s.name.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length;
    if (n > score) { score = n; best = s; }
  }
  return score > 0 ? best : null;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Why a given start can't be booked, or null if it can. Shared by the main check and the alternatives search.
function slotProblem(business, service, bookings, blocks, start, groupSize, now) {
  const end = addMinutes(start, service.minutes);
  if (start <= now) return "That time has already passed.";
  const hours = business.hours || {};
  const days = Array.isArray(hours.days) ? hours.days : [];
  if (!days.includes(start.getUTCDay())) return `${business.name} is closed that day.`;
  const open = hhmmToMinutes(hours.open), close = hhmmToMinutes(hours.close);
  if (open == null || close == null) return "Opening hours aren't set up yet.";
  if (minutesOfDay(start) < open || minutesOfDay(start) + service.minutes > close) {
    return `That's outside opening hours, which are ${hours.open} to ${hours.close}.`;
  }
  for (const b of blocks || []) {
    const bs = parseNaive(b.start), be = parseNaive(b.end);
    if (bs && be && overlaps(start, end, bs, be)) return b.reason ? `That time is unavailable: ${b.reason}.` : "That time is unavailable.";
  }
  const capacity = Math.max(1, Number(service.capacity) || 1);
  const sameService = (bookings || []).filter((bk) => bk.status === "confirmed" && bk.service === service.name);
  let clash = 0;
  for (const bk of sameService) {
    const s = parseNaive(bk.start_time), e = parseNaive(bk.end_time) || (s && addMinutes(s, service.minutes));
    if (s && e && overlaps(start, end, s, e)) clash++;
  }
  if (clash >= capacity) return "That time is already fully booked.";
  return null;
}

// Up to three free start times after the requested one, every 30 minutes over the next week.
function findAlternatives(business, service, bookings, blocks, from, groupSize, now) {
  const found = [];
  let t = new Date(from.getTime());
  // Round up to the next step boundary, and never start in the past.
  if (t <= now) t = new Date(now.getTime());
  const rem = minutesOfDay(t) % STEP_MINUTES;
  if (rem || t.getUTCSeconds()) t = addMinutes(new Date(Math.floor(t.getTime() / 60000) * 60000), STEP_MINUTES - rem);
  const limit = addMinutes(from, SEARCH_DAYS * 24 * 60);
  while (t < limit && found.length < 3) {
    if (!slotProblem(business, service, bookings, blocks, t, groupSize, now)) found.push(readable(t));
    t = addMinutes(t, STEP_MINUTES);
  }
  return found;
}

// The main check. `now` can be passed in by tests.
export function checkAvailability(business, bookings, blocks, { service, start_time, group_size }, now = nowNaive()) {
  const result = { available: false, service: null, start_time: null, end_time: null, readable_time: null, reason: "", alternatives: [] };
  if (!business) { result.reason = "That business isn't set up yet."; return result; }
  if (!business.verified) { result.reason = "This business isn't taking bookings yet."; return result; }
  const matched = matchService(business, service);
  if (!matched) {
    const names = (business.services || []).map((s) => s.name).join(", ");
    result.reason = names ? `We don't offer that. The options are: ${names}.` : "No services are set up yet.";
    return result;
  }
  result.service = matched.name;
  const size = Math.max(1, parseInt(group_size, 10) || 1);
  if (matched.max_group && size > matched.max_group) {
    result.reason = `${matched.name} is for up to ${matched.max_group} people.`;
    return result;
  }
  const start = parseNaive(start_time);
  if (!start) { result.reason = "I didn't catch the date and time."; return result; }
  result.start_time = formatNaive(start);
  result.end_time = formatNaive(addMinutes(start, matched.minutes));
  result.readable_time = readable(start);
  const problem = slotProblem(business, matched, bookings, blocks, start, size, now);
  if (problem) {
    result.reason = problem;
    result.alternatives = findAlternatives(business, matched, bookings, blocks, start, size, now);
    return result;
  }
  result.available = true;
  return result;
}
