// Fake a finished call without phoning Juno: posts test/sample-webhook.json,
// signed with ELEVENLABS_WEBHOOK_SECRET, to a running server.
//
//   node test/post-webhook.js <business_id> [server_url]
//
// Find a business id on its manager page URL, or in the server's start-up log.
// Each run uses a new conversation id, so it creates a new booking.

import { readFile } from "node:fs/promises";
import { signWebhook } from "../src/elevenlabs.js";

const [businessId, server = process.env.PUBLIC_URL || "http://localhost:3000"] = process.argv.slice(2);
const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
if (!businessId || !secret) {
  console.error("Usage: ELEVENLABS_WEBHOOK_SECRET=... node test/post-webhook.js <business_id> [server_url]");
  process.exit(1);
}
const payload = JSON.parse(await readFile(new URL("./sample-webhook.json", import.meta.url), "utf8"));
payload.data.conversation_id = `conv_test_${Date.now()}`;
payload.data.conversation_initiation_client_data.dynamic_variables.business_id = businessId;
const body = JSON.stringify(payload);
const res = await fetch(`${server}/webhook/elevenlabs`, { method: "POST", body, headers: { "content-type": "application/json", "elevenlabs-signature": signWebhook(body, secret) } });
console.log(res.status, await res.text());
