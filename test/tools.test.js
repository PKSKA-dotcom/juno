// Copilot's tools: scoped to one business, validated, undoable, and
// unable to touch a customer without the owner's approval.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as db from "../src/db.js";
import { managerTools, undoChange } from "../src/tools.js";

let a, b, bookingB;
const tool = (businessId, name) => managerTools(businessId).find((t) => t.name === name).handler;

beforeEach(async () => {
  db._reset();
  const base = { verified: true, description: "x", hours: { days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00" }, faq: [], extra_questions: "" };
  a = await db.createBusiness({ ...base, slug: "a", name: "A", services: [{ name: "Cut", minutes: 30, max_group: 1, capacity: 1 }] });
  b = await db.createBusiness({ ...base, slug: "b", name: "B", services: [{ name: "Room", minutes: 60, max_group: 6, capacity: 1 }] });
  bookingB = await db.saveBooking({ business_id: b.id, conversation_id: "c1", status: "confirmed", service: "Room", customer_name: "Sam", start_time: "2030-01-07T10:00:00", end_time: "2030-01-07T11:00:00", readable_time: "Mon, Jan 7 at 10:00 AM" });
});

test("tools refuse another business's booking", async () => {
  for (const name of ["cancel_booking", "notify_customer", "reschedule_booking"]) {
    const r = await tool(a.id, name)({ booking_id: bookingB.id, message: "hi", start_time: "2030-01-08T10:00:00" });
    assert.equal(r.ok, false, name);
    assert.match(r.error, /No booking/);
  }
  assert.equal((await db.listPendingActions(a.id)).length, 0);
});

test("invalid hours are refused and nothing changes", async () => {
  const r = await tool(a.id, "update_hours")({ days: [1], open: "18:00", close: "09:00" });
  assert.equal(r.ok, false);
  assert.equal((await db.getBusinessById(a.id)).hours.open, "09:00");
});

test("customer-facing tools only create pending actions", async () => {
  const r1 = await tool(b.id, "cancel_booking")({ booking_id: bookingB.id, reason: "closed" });
  const r2 = await tool(b.id, "notify_customer")({ booking_id: bookingB.id, message: "Running late" });
  assert.equal(r1.requires_approval, true);
  assert.equal(r2.requires_approval, true);
  assert.equal((await db.getBooking(bookingB.id)).status, "confirmed");
  assert.equal((await db.listPendingActions(b.id)).length, 2);
});

test("reschedule checks availability before proposing", async () => {
  const bad = await tool(b.id, "reschedule_booking")({ booking_id: bookingB.id, start_time: "2030-01-05T10:00:00" }); // Saturday, closed
  assert.equal(bad.ok, false);
  const good = await tool(b.id, "reschedule_booking")({ booking_id: bookingB.id, start_time: "2030-01-08T10:00:00" });
  assert.equal(good.requires_approval, true);
});

test("profile changes are logged and can be undone", async () => {
  await tool(a.id, "add_service")({ name: "Beard trim", minutes: 15 });
  assert.equal((await db.getBusinessById(a.id)).services.length, 2);
  const [change] = await db.listChanges(a.id);
  assert.match(change.description, /Beard trim/);
  await undoChange(a.id, change.id);
  assert.equal((await db.getBusinessById(a.id)).services.length, 1);
  assert.equal(await undoChange(b.id, change.id), null, "another business can't undo it");
});

test("blocking time can be undone", async () => {
  const r = await tool(a.id, "block_time")({ start: "2030-01-07T00:00:00", end: "2030-01-08T00:00:00", reason: "holiday" });
  assert.equal(r.ok, true);
  assert.equal((await db.listBlocks(a.id)).length, 1);
  const [change] = await db.listChanges(a.id);
  await undoChange(a.id, change.id);
  assert.equal((await db.listBlocks(a.id)).length, 0);
});

test("FAQ answers are length-limited", async () => {
  const r = await tool(a.id, "update_faq")({ question: "Parking?", answer: "x".repeat(500) });
  assert.equal(r.ok, false);
  const ok = await tool(a.id, "update_faq")({ question: "Parking?", answer: "Free lot out back." });
  assert.equal(ok.ok, true);
  assert.equal((await db.getBusinessById(a.id)).faq[0].answer, "Free lot out back.");
});
