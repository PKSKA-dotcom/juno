// Every booking rule, one test each. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAvailability, matchService } from "../src/availability.js";
import { parseNaive } from "../src/time.js";

// Thursday 2030-01-03 at 09:00 is "now" for every test.
const NOW = parseNaive("2030-01-03T09:00:00");
const salon = {
  name: "Shear Studio", verified: true,
  services: [{ name: "Haircut", minutes: 45, max_group: 1, capacity: 2 }, { name: "Party room", minutes: 120, max_group: 20, capacity: 1 }],
  hours: { days: [2, 3, 4, 5, 6], open: "09:00", close: "18:00" }, // Tue-Sat
};
const check = (req, bookings = [], blocks = [], biz = salon) => checkAvailability(biz, bookings, blocks, req, NOW);

test("a free slot is available", () => {
  const r = check({ service: "haircut", start_time: "2030-01-04T10:00:00", group_size: 1 });
  assert.equal(r.available, true);
  assert.equal(r.service, "Haircut");
  assert.equal(r.end_time, "2030-01-04T10:45:00");
});

test("a time in the past is refused", () => {
  const r = check({ service: "Haircut", start_time: "2030-01-02T10:00:00" });
  assert.equal(r.available, false);
  assert.match(r.reason, /passed/);
});

test("a closed day is refused and alternatives are offered", () => {
  const r = check({ service: "Haircut", start_time: "2030-01-06T10:00:00" }); // Sunday
  assert.equal(r.available, false);
  assert.match(r.reason, /closed/);
  assert.equal(r.alternatives.length, 3);
});

test("outside opening hours is refused, including a service that would run past closing", () => {
  assert.equal(check({ service: "Haircut", start_time: "2030-01-04T08:00:00" }).available, false);
  assert.equal(check({ service: "Haircut", start_time: "2030-01-04T17:30:00" }).available, false);
  assert.equal(check({ service: "Haircut", start_time: "2030-01-04T17:15:00" }).available, true);
});

test("a group that's too big is refused", () => {
  const r = check({ service: "Party room", start_time: "2030-01-04T10:00:00", group_size: 25 });
  assert.equal(r.available, false);
  assert.match(r.reason, /up to 20/);
});

test("an unknown service is refused and the real options are listed", () => {
  const r = check({ service: "Massage", start_time: "2030-01-04T10:00:00" });
  assert.equal(r.available, false);
  assert.match(r.reason, /Haircut/);
});

test("capacity: two haircuts can overlap, the third is refused", () => {
  const booked = (s) => ({ status: "confirmed", service: "Haircut", start_time: s, end_time: s.replace("10:00", "10:45") });
  const one = [booked("2030-01-04T10:00:00")];
  assert.equal(check({ service: "Haircut", start_time: "2030-01-04T10:15:00" }, one).available, true);
  const two = [booked("2030-01-04T10:00:00"), booked("2030-01-04T10:00:00")];
  const r = check({ service: "Haircut", start_time: "2030-01-04T10:15:00" }, two);
  assert.equal(r.available, false);
  assert.match(r.reason, /fully booked/);
  assert.ok(r.alternatives.length > 0);
});

test("cancelled bookings don't take up a slot", () => {
  const b = [{ status: "cancelled", service: "Party room", start_time: "2030-01-04T10:00:00", end_time: "2030-01-04T12:00:00" }];
  assert.equal(check({ service: "Party room", start_time: "2030-01-04T10:00:00", group_size: 5 }, b).available, true);
});

test("a blocked period is refused", () => {
  const blocks = [{ start: "2030-01-04T00:00:00", end: "2030-01-05T00:00:00", reason: "private event" }];
  const r = check({ service: "Haircut", start_time: "2030-01-04T11:00:00" }, [], blocks);
  assert.equal(r.available, false);
  assert.match(r.reason, /private event/);
  assert.ok(r.alternatives.every((a) => !a.includes("Jan 4")));
});

test("an unverified business takes no bookings", () => {
  assert.equal(check({ service: "Haircut", start_time: "2030-01-04T10:00:00" }, [], [], { ...salon, verified: false }).available, false);
});

test("service names are matched loosely", () => {
  assert.equal(matchService(salon, "a haircut please")?.name, "Haircut");
  assert.equal(matchService(salon, "party")?.name, "Party room");
  assert.equal(matchService(salon, "massage"), null);
});
