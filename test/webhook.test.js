// The post-call webhook: signatures, duplicates, missed calls, re-checks.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as db from "../src/db.js";
import { seed } from "../src/seed.js";
import { createApp } from "../server.js";
import { signWebhook } from "../src/elevenlabs.js";
import { processCall } from "../src/calls.js";

process.env.ELEVENLABS_WEBHOOK_SECRET = "test-secret";
delete process.env.MAKE_WEBHOOK_URL;
delete process.env.COPILOT_GITHUB_TOKEN;
delete process.env.ELEVENLABS_API_KEY;

let server, url, arcade;
const sample = JSON.parse(await readFile(new URL("./sample-webhook.json", import.meta.url), "utf8"));

function payload(overrides = {}, results = {}) {
  const p = structuredClone(sample);
  p.data.conversation_id = overrides.conversation_id || `conv_${Math.random().toString(36).slice(2)}`;
  p.data.conversation_initiation_client_data.dynamic_variables.business_id = arcade.id;
  for (const [k, v] of Object.entries(results)) p.data.analysis.data_collection_results[k] = { value: v };
  return p;
}

before(async () => {
  server = createApp().listen(0);
  url = `http://localhost:${server.address().port}`;
});
after(() => server.close());
beforeEach(async () => {
  db._reset();
  await seed();
  arcade = await db.getBusinessBySlug("pixel-palace");
});

test("a webhook with a bad signature is rejected", async () => {
  const body = JSON.stringify(payload());
  const r = await fetch(`${url}/webhook/elevenlabs`, { method: "POST", body, headers: { "elevenlabs-signature": signWebhook(body, "wrong-secret") } });
  assert.equal(r.status, 401);
  const none = await fetch(`${url}/webhook/elevenlabs`, { method: "POST", body });
  assert.equal(none.status, 401);
});

test("a signed webhook creates a confirmed booking", async () => {
  const body = JSON.stringify(payload());
  const r = await fetch(`${url}/webhook/elevenlabs`, { method: "POST", body, headers: { "elevenlabs-signature": signWebhook(body, "test-secret") } });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 100));
  const bookings = await db.listBookings(arcade.id);
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].status, "confirmed");
  assert.equal(bookings[0].service, "Party room");
});

test("the same call sent twice creates one booking", async () => {
  const p = payload({ conversation_id: "conv_same" });
  const first = await processCall(p); await first.done;
  const second = await processCall(p);
  assert.equal(first.status, "confirmed");
  assert.equal(second.status, "duplicate");
  assert.equal((await db.listBookings(arcade.id)).length, 1);
});

test("a call without a confirmed booking is saved as missed", async () => {
  const r = await processCall(payload({}, { booking_confirmed: false }));
  await r.done;
  assert.equal(r.status, "missed");
  assert.equal(r.booking.status, "missed");
});

test("a booking the server can't confirm is flagged, not double-booked", async () => {
  // The private session has capacity 1, so the second identical booking must be flagged.
  const res = { service: "Private arcade session", group_size: 4 };
  const one = await processCall(payload({}, res)); await one.done;
  const two = await processCall(payload({}, { ...res, customer_phone: "5035550199" })); await two.done;
  assert.equal(one.status, "confirmed");
  assert.equal(two.status, "needs_attention");
  assert.match(two.booking.problem, /fully booked/);
});

test("one phone number can't flood a business", async () => {
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const r = await processCall(payload({}, { start_time: `2030-06-1${i}T15:00:00` }));
    await r.done; statuses.push(r.status);
  }
  assert.deepEqual(statuses, ["confirmed", "confirmed", "confirmed", "needs_attention"]);
});

test("the availability tool answers for a seeded business", async () => {
  const r = await fetch(`${url}/api/tools/check-availability`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ business_id: arcade.id, service: "party room", start_time: "2030-06-15T15:00:00", group_size: 12 }) });
  const j = await r.json();
  assert.equal(j.available, true);
  assert.equal(j.readable_time, "Sat, Jun 15 at 3:00 PM");
});

test("the manager page needs the right key", async () => {
  assert.equal((await fetch(`${url}/b/pixel-palace/manage?key=wrong`)).status, 404);
  assert.equal((await fetch(`${url}/b/pixel-palace/manage?key=${arcade.owner_key}`)).status, 200);
});

test("a new business isn't bookable until verified", async () => {
  const r = await fetch(`${url}/api/businesses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    name: "Dog Spa", description: "Grooming for dogs.", owner_email: "owner@example.com",
    services: "Bath, 60 minutes, 1 dog, 2 at a time", faq: "Do you do cats? No, dogs only.",
    hours: { days: [1, 2, 3], open: "09:00", close: "17:00" } }) });
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${url}/b/dog-spa`)).status, 404);
  const dog = (await db.listBusinesses({ verifiedOnly: false })).find((b) => b.slug === "dog-spa");
  assert.equal((await fetch(`${url}/verify/${dog.verify_token}`)).status, 200);
  assert.equal((await fetch(`${url}/b/dog-spa`)).status, 200);
});
